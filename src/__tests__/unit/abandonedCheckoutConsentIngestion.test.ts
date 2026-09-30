import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tx = {
    abandonedCheckout: { update: vi.fn(), create: vi.fn() },
  }
  return {
    tx,
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
    ingest: vi.fn(),
  }
})

vi.mock('../../config/prisma', () => ({
  prisma: {
    abandonedCheckout: { findUnique: mocks.findUnique, create: mocks.create, update: mocks.update },
    $transaction: mocks.transaction,
  },
}))
vi.mock('../../services/customerService', () => ({ customerService: { upsertCustomer: vi.fn().mockResolvedValue({ id: 'cust1' }) } }))
vi.mock('../../services/emailConsentService', () => ({ ingestObservedConsentInTx: mocks.ingest }))

import { env } from '../../config/env'
import { abandonedCheckoutService } from '../../services/abandonedCheckoutService'

const payload = { id: 77, contact_name: 'Ana', contact_email: 'ana@example.com', contact_phone: '83988887777', contact_accepts_marketing: true, created_at: '2026-09-25T10:00:00Z', abandoned_checkout_url: 'https://x/c/1', total: '10' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue(null)
  mocks.create.mockResolvedValue({ id: 'ck1', customerId: 'cust1' })
  mocks.tx.abandonedCheckout.create.mockResolvedValue({ id: 'ck1', customerId: 'cust1' })
  mocks.transaction.mockImplementation(async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx))
  mocks.ingest.mockResolvedValue({ recorded: true, status: 'OPT_IN' })
})

describe('persistência do checkout × ingestão contínua', () => {
  it('flag DESLIGADA: caminho antigo (sem transação, sem ingestão)', async () => {
    env.EMAIL_CONSENT_CONTINUOUS_INGESTION_ENABLED = false
    await abandonedCheckoutService.upsertAbandonedCheckout(payload as never)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.ingest).not.toHaveBeenCalled()
  })

  it('flag LIGADA: grava o checkout e a evidência na MESMA transação, sem e-mail fora do hash', async () => {
    env.EMAIL_CONSENT_CONTINUOUS_INGESTION_ENABLED = true
    await abandonedCheckoutService.upsertAbandonedCheckout(payload as never)
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.tx.abandonedCheckout.create).toHaveBeenCalledTimes(1)
    expect(mocks.create).not.toHaveBeenCalled() // escreveu via tx, não via prisma direto
    expect(mocks.ingest).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ kind: 'checkout', externalId: '77', customerId: 'cust1' }))
  })

  it('se a ingestão lança, a transação inteira falha (nenhum checkout sem evidência coerente)', async () => {
    env.EMAIL_CONSENT_CONTINUOUS_INGESTION_ENABLED = true
    mocks.ingest.mockRejectedValue(new Error('db'))
    await expect(abandonedCheckoutService.upsertAbandonedCheckout(payload as never)).rejects.toThrow()
  })
})
