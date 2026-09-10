import { prisma } from '../config/prisma'

export async function hasActiveWhatsappConsent(normalizedPhone: string, scope = 'marketing'): Promise<boolean> {
  if (!normalizedPhone) return false

  const registry = prisma.whatsappConsent
  if (!registry) return false

  const consent = await registry.findUnique({
    where: { normalizedPhone_scope: { normalizedPhone, scope } },
    select: { consented: true, revokedAt: true, consentedAt: true },
  })

  return consent?.consented === true && consent.revokedAt === null && consent.consentedAt !== null
}
