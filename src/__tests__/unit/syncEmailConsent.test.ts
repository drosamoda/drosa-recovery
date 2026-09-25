import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('axios', () => ({
  default: { get: mocks.get },
}))

import { runEmailConsentSync } from '../../jobs/syncEmailConsent'

describe('runEmailConsentSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pagina todos os clientes e prepara somente eventos autoritativos sem PII extra', async () => {
    const page1 = Array.from({ length: 200 }, (_, index) => ({
      id: index + 1,
      email: `cliente${index}@example.com`,
      accepts_marketing: true,
      accepts_marketing_updated_at: '2026-09-25T10:00:00Z',
    }))
    const page2 = [
      {
        id: 999,
        email: 'CLIENTE0@example.com',
        accepts_marketing: false,
        accepts_marketing_updated_at: '2026-09-25T11:00:00Z',
      },
      {
        id: 201,
        email: 'cliente200@example.com',
        accepts_marketing: false,
        accepts_marketing_updated_at: '2026-09-25T11:00:00Z',
      },
    ]
    mocks.get
      .mockResolvedValueOnce({ data: page1, headers: { 'x-total-count': '202' }, status: 200 })
      .mockResolvedValueOnce({ data: page2, headers: { 'x-total-count': '202' }, status: 200 })

    const writeBatch = vi.fn().mockResolvedValue({
      inputEvents: 202,
      uniqueHashes: 201,
      eventsInserted: 202,
      statesRecomputed: 201,
    })
    const sleep = vi.fn().mockResolvedValue(undefined)
    const capturedAt = new Date('2026-09-25T12:00:00Z')

    const result = await runEmailConsentSync({ writeBatch, sleep, capturedAt })

    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      customersFetched: 202,
      pagesFetched: 2,
      expectedTotal: 202,
      liveOptIn: 200,
      liveOptOut: 2,
      duplicateEmailRows: 1,
      signalsPrepared: 202,
      eventsInserted: 202,
      statesRecomputed: 201,
    })
    const events = writeBatch.mock.calls[0][0]
    expect(events).toHaveLength(202)
    expect(events[200]).toMatchObject({
      email: 'cliente0@example.com',
      customerId: '999',
      status: 'OPT_OUT',
      source: 'NUVEMSHOP_CUSTOMER_API',
      sourceUpdatedAt: new Date('2026-09-25T11:00:00Z'),
      capturedAt,
    })
    expect(events[200].evidenceRef).toBe(
      'customer:999:accepts_marketing:2026-09-25T11:00:00.000Z',
    )
    expect(events[200].evidenceRef).not.toContain('@')
  })

  it('faz retry/backoff em 429 e não expõe resposta do upstream', async () => {
    mocks.get
      .mockRejectedValueOnce({ response: { status: 429, data: { email: 'secret@example.com' } } })
      .mockResolvedValueOnce({ data: [], headers: { 'x-total-count': '0' }, status: 200 })

    const sleep = vi.fn().mockResolvedValue(undefined)
    const writeBatch = vi.fn().mockResolvedValue({
      inputEvents: 0,
      uniqueHashes: 0,
      eventsInserted: 0,
      statesRecomputed: 0,
    })
    const result = await runEmailConsentSync({ sleep, writeBatch })

    expect(result.apiRequests).toBe(2)
    expect(result.rateLimitErrors).toBe(1)
    expect(result.retryableErrors).toBe(1)
    expect(sleep).toHaveBeenCalledWith(1500)
    expect(writeBatch).toHaveBeenCalledWith([])
  })

  it('pula sinais que não podem ser provados com segurança', async () => {
    mocks.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'x-total-count': '5' },
      data: [
        { id: 1, email: null, accepts_marketing: true, accepts_marketing_updated_at: '2026-09-25T10:00:00Z' },
        { id: 2, email: 'invalido', accepts_marketing: true, accepts_marketing_updated_at: '2026-09-25T10:00:00Z' },
        { id: 3, email: 'a@example.com', accepts_marketing: null, accepts_marketing_updated_at: '2026-09-25T10:00:00Z' },
        { id: 4, email: 'b@example.com', accepts_marketing: false, accepts_marketing_updated_at: null },
        { email: 'c@example.com', accepts_marketing: true, accepts_marketing_updated_at: '2026-09-25T10:00:00Z' },
      ],
    })
    const writeBatch = vi.fn().mockResolvedValue({
      inputEvents: 0,
      uniqueHashes: 0,
      eventsInserted: 0,
      statesRecomputed: 0,
    })

    const result = await runEmailConsentSync({ writeBatch, sleep: async () => undefined })

    expect(result).toMatchObject({
      skippedNoEmail: 1,
      skippedInvalidEmail: 1,
      skippedUnknownPreference: 1,
      skippedInvalidUpdatedAt: 1,
      skippedInvalidCustomerId: 1,
      signalsPrepared: 0,
    })
    expect(writeBatch).toHaveBeenCalledWith([])
  })
})
