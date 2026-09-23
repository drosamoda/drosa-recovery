import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { isValidBrazilianPhone } from '../helpers/phoneService'

type ConsentEvidence = { consented: boolean; consentedAt: Date | null; revokedAt: Date | null } | null | undefined

export type WhatsappConsentScope = 'marketing' | 'transactional'
type ConsentChoice = 'granted' | 'revoked'

const CONSENT_MARKER_VERSION = 'v1'
const CONSENT_MARKER_SOURCE = 'nuvemshop_checkout_whatsapp_optin'
const CONSENT_SCOPES: WhatsappConsentScope[] = ['marketing', 'transactional']

export function classifyWhatsappConsent(consent: ConsentEvidence): 'GRANTED' | 'REVOKED' | 'UNKNOWN' {
  if (!consent) return 'UNKNOWN'
  if (consent.revokedAt !== null || consent.consented === false) return 'REVOKED'
  if (consent.consented === true && consent.consentedAt !== null) return 'GRANTED'
  return 'UNKNOWN'
}

export async function hasActiveWhatsappConsent(
  normalizedPhone: string,
  scope: WhatsappConsentScope = 'marketing',
): Promise<boolean> {
  if (!normalizedPhone || !isValidBrazilianPhone(normalizedPhone)) return false

  const registry = prisma.whatsappConsent
  if (!registry) return false

  const consent = await registry.findUnique({
    where: { normalizedPhone_scope: { normalizedPhone, scope } },
    select: { consented: true, revokedAt: true, consentedAt: true },
  })

  return classifyWhatsappConsent(consent) === 'GRANTED'
}

function readConsentChoiceForScope(
  marker: Record<string, unknown>,
  scope: WhatsappConsentScope,
): ConsentChoice | null {
  const prefix = `drosa_whatsapp_${scope}`

  if (marker[`${prefix}_version`] !== CONSENT_MARKER_VERSION) return null
  if (marker[`${prefix}_store_id`] !== env.NUVEMSHOP_STORE_ID) return null
  if (marker[`${prefix}_source`] !== CONSENT_MARKER_SOURCE) return null
  if (marker[`${prefix}_scope`] !== scope) return null

  const choice = marker[`${prefix}_choice`]
  return choice === 'granted' || choice === 'revoked' ? choice : null
}

export function readConsentChoicesFromOrderExtra(
  extra: unknown,
): Partial<Record<WhatsappConsentScope, ConsentChoice>> {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return {}
  const marker = extra as Record<string, unknown>

  const result: Partial<Record<WhatsappConsentScope, ConsentChoice>> = {}
  for (const scope of CONSENT_SCOPES) {
    const choice = readConsentChoiceForScope(marker, scope)
    if (choice) result[scope] = choice
  }
  return result
}

async function upsertConsent(params: {
  normalizedPhone: string
  scope: WhatsappConsentScope
  choice: ConsentChoice
}): Promise<void> {
  const { normalizedPhone, scope, choice } = params
  const registry = prisma.whatsappConsent
  if (!registry) return

  const now = new Date()

  await registry.upsert({
    where: { normalizedPhone_scope: { normalizedPhone, scope } },
    create: {
      normalizedPhone,
      scope,
      source: CONSENT_MARKER_SOURCE,
      consented: choice === 'granted',
      consentedAt: choice === 'granted' ? now : null,
      revokedAt: choice === 'revoked' ? now : null,
    },
    update:
      choice === 'granted'
        ? { consented: true, source: CONSENT_MARKER_SOURCE, consentedAt: now, revokedAt: null }
        : { consented: false, source: CONSENT_MARKER_SOURCE, revokedAt: now },
  })
}

// Única via de escrita em whatsapp_consents. Cada escopo é fail-closed:
// marcador ausente/incompleto não cria nem altera consentimento daquele escopo.
export async function recordConsentFromNuvemshopOrderExtra(params: {
  normalizedPhone: string | null | undefined
  extra: unknown
  nuvemshopOrderId: string
}): Promise<void> {
  const { normalizedPhone, extra, nuvemshopOrderId } = params

  if (!normalizedPhone || !isValidBrazilianPhone(normalizedPhone)) {
    logger.info('[whatsappConsentService] pedido sem telefone normalizado valido, consentimento nao registrado', {
      nuvemshopOrderId,
    })
    return
  }

  const choices = readConsentChoicesFromOrderExtra(extra)
  const entries = Object.entries(choices) as Array<[WhatsappConsentScope, ConsentChoice]>
  if (entries.length === 0) return

  for (const [scope, choice] of entries) {
    await upsertConsent({ normalizedPhone, scope, choice })
  }

  logger.info('[whatsappConsentService] consentimento WhatsApp atualizado a partir do checkout', {
    nuvemshopOrderId,
    scopes: entries.map(([scope]) => scope),
  })
}
