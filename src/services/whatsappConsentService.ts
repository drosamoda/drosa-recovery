import { prisma } from '../config/prisma'

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
