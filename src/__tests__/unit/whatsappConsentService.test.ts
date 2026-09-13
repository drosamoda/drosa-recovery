import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: { whatsappConsent: { findUnique: vi.fn() } },
}))

import { prisma } from '../../config/prisma'
import { classifyWhatsappConsent, hasActiveWhatsappConsent } from '../../services/whatsappConsentService'

describe('WhatsApp consent registry', () => {
  it.each([
    [null, 'UNKNOWN'],
    [{ consented: true, consentedAt: null, revokedAt: null }, 'UNKNOWN'],
    [{ consented: true, consentedAt: new Date('2026-09-10'), revokedAt: null }, 'GRANTED'],
    [{ consented: false, consentedAt: null, revokedAt: null }, 'REVOKED'],
    [{ consented: false, consentedAt: new Date('2026-09-10'), revokedAt: null }, 'REVOKED'],
    [{ consented: true, consentedAt: null, revokedAt: new Date('2026-09-11') }, 'REVOKED'],
    [{ consented: true, consentedAt: new Date('2026-09-10'), revokedAt: new Date('2026-09-11') }, 'REVOKED'],
    [{ consented: false, consentedAt: new Date('2026-09-10'), revokedAt: new Date('2026-09-11') }, 'REVOKED'],
  ] as const)('classifies consent evidence consistently: %j', async (record, expected) => {
    vi.mocked(prisma.whatsappConsent.findUnique).mockResolvedValue(record as never)
    expect(classifyWhatsappConsent(record)).toBe(expected)
    expect(await hasActiveWhatsappConsent('5531999999999')).toBe(expected === 'GRANTED')
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts only an explicit, active and timestamped consent record', async () => {
    vi.mocked(prisma.whatsappConsent.findUnique).mockResolvedValue({
      consented: true,
      consentedAt: new Date('2026-09-10T12:00:00Z'),
      revokedAt: null,
    } as never)

    expect(await hasActiveWhatsappConsent('5531999999999')).toBe(true)
  })

  it.each([
    null,
    { consented: false, consentedAt: new Date('2026-09-10T12:00:00Z'), revokedAt: null },
    { consented: true, consentedAt: null, revokedAt: null },
    { consented: true, consentedAt: new Date('2026-09-10T12:00:00Z'), revokedAt: new Date('2026-09-10T13:00:00Z') },
  ])('fails closed for absent, incomplete or revoked consent', async (record) => {
    vi.mocked(prisma.whatsappConsent.findUnique).mockResolvedValue(record as never)
    expect(await hasActiveWhatsappConsent('5531999999999')).toBe(false)
  })
})
