import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../config/logger'

type ConsentEvidence = { consented: boolean; consentedAt: Date | null; revokedAt: Date | null } | null | undefined

export function classifyWhatsappConsent(consent: ConsentEvidence): 'GRANTED' | 'REVOKED' | 'UNKNOWN' {
  if (!consent) return 'UNKNOWN'
  if (consent.revokedAt !== null || consent.consented === false) return 'REVOKED'
  if (consent.consented === true && consent.consentedAt !== null) return 'GRANTED'
  return 'UNKNOWN'
}

export async function hasActiveWhatsappConsent(normalizedPhone: string, scope = 'marketing'): Promise<boolean> {
  if (!normalizedPhone) return false

  const registry = prisma.whatsappConsent
  if (!registry) return false

  const consent = await registry.findUnique({
    where: { normalizedPhone_scope: { normalizedPhone, scope } },
    select: { consented: true, revokedAt: true, consentedAt: true },
  })

  return classifyWhatsappConsent(consent) === 'GRANTED'
}

// Protocolo fixo gravado pela extensão NubeSDK em order.extra (checkout).
// Ver DROSA_CRM_HANDOFF_CLAUDE.md — nenhum outro valor é aceito.
const CONSENT_MARKER_VERSION = 'v1'
const CONSENT_MARKER_SOURCE = 'nuvemshop_checkout_whatsapp_optin'
const CONSENT_MARKER_SCOPE = 'marketing'

type ConsentChoice = 'granted' | 'revoked'

// Só reconhece o marcador exato do protocolo — qualquer campo divergente
// (versão, loja, source, scope) é tratado como ausente (fail closed).
function readConsentChoiceFromOrderExtra(extra: unknown): ConsentChoice | null {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null
  const marker = extra as Record<string, unknown>

  if (marker.drosa_whatsapp_marketing_version !== CONSENT_MARKER_VERSION) return null
  if (marker.drosa_whatsapp_marketing_store_id !== env.NUVEMSHOP_STORE_ID) return null
  if (marker.drosa_whatsapp_marketing_source !== CONSENT_MARKER_SOURCE) return null
  if (marker.drosa_whatsapp_marketing_scope !== CONSENT_MARKER_SCOPE) return null

  const choice = marker.drosa_whatsapp_marketing_choice
  return choice === 'granted' || choice === 'revoked' ? choice : null
}

// Única via de escrita em whatsapp_consents. Nunca aceita telefone ausente/
// inválido nem marcador incompleto — nesses casos o registro permanece UNKNOWN.
export async function recordConsentFromNuvemshopOrderExtra(params: {
  normalizedPhone: string | null | undefined
  extra: unknown
  nuvemshopOrderId: string
}): Promise<void> {
  const { normalizedPhone, extra, nuvemshopOrderId } = params

  if (!normalizedPhone) {
    logger.info('[whatsappConsentService] pedido sem telefone normalizado, consentimento nao registrado', {
      nuvemshopOrderId,
    })
    return
  }

  const choice = readConsentChoiceFromOrderExtra(extra)
  if (!choice) return

  const registry = prisma.whatsappConsent
  if (!registry) return

  const now = new Date()

  await registry.upsert({
    where: { normalizedPhone_scope: { normalizedPhone, scope: CONSENT_MARKER_SCOPE } },
    create: {
      normalizedPhone,
      scope: CONSENT_MARKER_SCOPE,
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

  logger.info('[whatsappConsentService] consentimento WhatsApp atualizado a partir do checkout', {
    nuvemshopOrderId,
    choice,
  })
}
