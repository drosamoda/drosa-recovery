import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  record: vi.fn(),
}))

vi.mock('axios', () => ({
  default: { get: mocks.get },
}))

vi.mock('../../services/emailConsentService', async () => {
  const actual = await vi.importActual<typeof import('../../services/emailConsentService')>('../../services/emailConsentService')
  return { ...actual, recordEmailConsentEvent: mocks.record }
})

import { refreshEmailConsentFromNuvemshop } from '../../services/emailLiveConsentService'

describe('refreshEmailConsentFromNuvemshop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.record.mockResolvedValue({ state: 'CONFIRMED_OPT_IN' })
  })

  it('persiste a preferência atual da Nuvemshop como fonte autoritativa sem payload/PII extra', async () => {
    mocks.get.mockResolvedValue({
      data: [{
        id: 123,
        email: 'ANA@EXAMPLE.COM',
        accepts_marketing: true,
        accepts_marketing_updated_at: '2026-09-24T08:00:00Z',
      }],
    })

    const result = await refreshEmailConsentFromNuvemshop('ana@example.com')

    expect(result).toEqual({ ok: true, matchedCustomers: 1, recordedEvents: 1 })
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ana@example.com',
      customerId: '123',
      status: 'OPT_IN',
      source: 'NUVEMSHOP_CUSTOMER_API',
      sourceUpdatedAt: new Date('2026-09-24T08:00:00Z'),
    }))
    const written = mocks.record.mock.calls[0][0]
    expect(JSON.stringify(written)).not.toMatch(/cpf|phone|address|name/i)
  })

  it.each([
    [{ data: [] }, 'NOT_FOUND'],
    [{ data: [{ id: 1, email: 'ana@example.com', accepts_marketing: null, accepts_marketing_updated_at: '2026-09-24T08:00:00Z' }] }, 'UNKNOWN_PREFERENCE'],
    [{ data: [{ id: 1, email: 'ana@example.com', accepts_marketing: true, accepts_marketing_updated_at: null }] }, 'UNKNOWN_PREFERENCE'],
  ])('falha fechado para resposta sem preferência comprovável', async (response, reason) => {
    mocks.get.mockResolvedValue(response)
    await expect(refreshEmailConsentFromNuvemshop('ana@example.com')).resolves.toEqual({ ok: false, reason })
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('falha fechado quando a API da Nuvemshop falha', async () => {
    mocks.get.mockRejectedValue(new Error('upstream'))
    await expect(refreshEmailConsentFromNuvemshop('ana@example.com')).resolves.toEqual({ ok: false, reason: 'UPSTREAM_ERROR' })
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('grava todas as ocorrências quando a API devolve clientes duplicados para o mesmo e-mail', async () => {
    mocks.get.mockResolvedValue({
      data: [
        { id: 1, email: 'ana@example.com', accepts_marketing: true, accepts_marketing_updated_at: '2026-09-20T08:00:00Z' },
        { id: 2, email: 'ana@example.com', accepts_marketing: false, accepts_marketing_updated_at: '2026-09-24T08:00:00Z' },
      ],
    })

    const result = await refreshEmailConsentFromNuvemshop('ana@example.com')
    expect(result).toEqual({ ok: true, matchedCustomers: 2, recordedEvents: 2 })
    expect(mocks.record).toHaveBeenCalledTimes(2)
    expect(mocks.record.mock.calls[1][0]).toMatchObject({ status: 'OPT_OUT', customerId: '2' })
  })
})
