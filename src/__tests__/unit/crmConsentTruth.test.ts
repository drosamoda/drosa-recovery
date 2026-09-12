import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({ prisma: {
  customer: { count: vi.fn(), findMany: vi.fn() },
  whatsappConsent: { count: vi.fn(), findMany: vi.fn() },
  suppression: { findMany: vi.fn() },
  messageLog: { groupBy: vi.fn() },
  conversation: { findMany: vi.fn() },
} }))

import { prisma } from '../../config/prisma'
import { crmReadService } from '../../services/crmReadService'

const timestamp = new Date('2026-09-10T12:00:00Z')
const evidence = [
  { consented: true, consentedAt: timestamp, revokedAt: null, expected: 'GRANTED' },
  { consented: true, consentedAt: null, revokedAt: null, expected: 'UNKNOWN' },
  { consented: false, consentedAt: timestamp, revokedAt: null, expected: 'REVOKED' },
  { consented: true, consentedAt: timestamp, revokedAt: timestamp, expected: 'REVOKED' },
]

describe('CRM consent truth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.customer.count).mockResolvedValue(evidence.length)
    vi.mocked(prisma.customer.findMany).mockResolvedValue(evidence.map((_, index) => ({
      id: String(index), normalizedPhone: `553199999000${index}`, name: null, email: null,
      _count: { orders: 0, messageLogs: 0 }, orders: [], optOut: false,
    })) as never)
    vi.mocked(prisma.whatsappConsent.count).mockResolvedValue(evidence.length)
    vi.mocked(prisma.whatsappConsent.findMany).mockResolvedValue(evidence.map((item, index) => ({
      ...item, id: String(index), normalizedPhone: `553199999000${index}`, scope: 'marketing', source: 'test',
    })) as never)
    vi.mocked(prisma.suppression.findMany).mockResolvedValue([])
    vi.mocked(prisma.messageLog.groupBy).mockResolvedValue([])
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([])
  })

  it('shows identical evidence states in customers and consents', async () => {
    const customers = await crmReadService.customers({})
    const consents = await crmReadService.consents({})
    expect(customers.data.map(row => row.consent)).toEqual(evidence.map(row => row.expected))
    expect(consents.data.map(row => row.status)).toEqual(evidence.map(row => row.expected))
  })

  it('shows no registry record as UNKNOWN for a customer', async () => {
    vi.mocked(prisma.whatsappConsent.findMany).mockResolvedValue([])
    const customers = await crmReadService.customers({})
    expect(customers.data.every(row => row.consent === 'UNKNOWN')).toBe(true)
  })
})
