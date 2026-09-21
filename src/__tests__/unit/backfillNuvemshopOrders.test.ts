import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchOrders: vi.fn(),
  customerFindFirst: vi.fn(),
  customerCreate: vi.fn(),
  customerUpdate: vi.fn(),
  orderFindUnique: vi.fn(),
  orderCreate: vi.fn(),
  orderUpdate: vi.fn(),
  checkoutFindMany: vi.fn(),
  checkoutUpdate: vi.fn(),
  messageUpdateMany: vi.fn(),
  recordConsent: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('../../services/nuvemshopService', () => ({
  nuvemshopService: { fetchOrders: mocks.fetchOrders },
}))

vi.mock('../../services/whatsappConsentService', () => ({
  recordConsentFromNuvemshopOrderExtra: mocks.recordConsent,
}))

vi.mock('../../config/logger', () => ({
  logger: { info: mocks.loggerInfo, error: mocks.loggerError },
}))

vi.mock('../../config/prisma', () => {
  const tx = {
    order: { findUnique: mocks.orderFindUnique, create: mocks.orderCreate, update: mocks.orderUpdate },
    abandonedCheckout: { findMany: mocks.checkoutFindMany, update: mocks.checkoutUpdate },
    messageLog: { updateMany: mocks.messageUpdateMany },
  }
  return {
    prisma: {
      customer: { findFirst: mocks.customerFindFirst, create: mocks.customerCreate, update: mocks.customerUpdate },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  }
})

import { runBackfillNuvemshopOrders } from '../../jobs/backfillNuvemshopOrders'

describe('runBackfillNuvemshopOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchOrders.mockResolvedValue([{
      id: 123,
      number: 456,
      status: 'open',
      payment_status: 'paid',
      payment_details: { method: 'credit_card' },
      contact_name: 'Maria Silva',
      contact_email: 'maria@example.com',
      contact_phone: '+55 83 99876-5432',
      total: '199.90',
      currency: 'BRL',
      created_at: '2026-09-14T10:00:00Z',
      updated_at: '2026-09-14T10:05:00Z',
    }])
    mocks.recordConsent.mockResolvedValue(undefined)
    mocks.customerFindFirst.mockResolvedValue(null)
    mocks.customerCreate.mockResolvedValue({ id: 'customer-1', name: 'Maria Silva', email: null, phone: null })
    mocks.orderFindUnique.mockResolvedValue(null)
    mocks.orderCreate.mockResolvedValue({ id: 'order-1' })
    mocks.checkoutFindMany.mockResolvedValue([])
  })

  it('backfills historical orders without scheduling commercial messages', async () => {
    const result = await runBackfillNuvemshopOrders({
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-09-14T23:59:59Z'),
      scheduleMessages: false,
    })

    expect(result).toMatchObject({ found: 1, created: 1, errors: 0, messagesScheduled: 0 })
    expect(mocks.orderCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: 'nuvemshop_orders_backfill', paymentStatus: 'paid' }),
    }))
    expect(mocks.messageUpdateMany).not.toHaveBeenCalled()
  })

  it('reconciles checkout consent evidence without scheduling messages', async () => {
    const extra = {
      drosa_whatsapp_marketing_version: 'v1',
      drosa_whatsapp_marketing_store_id: 'store-1',
      drosa_whatsapp_marketing_source: 'nuvemshop_checkout_whatsapp_optin',
      drosa_whatsapp_marketing_scope: 'marketing',
      drosa_whatsapp_marketing_choice: 'granted',
    }
    mocks.fetchOrders.mockResolvedValueOnce([{
      id: 123,
      number: 456,
      status: 'open',
      payment_status: 'paid',
      contact_name: 'Maria Silva',
      contact_phone: '+55 83 99876-5432',
      total: '199.90',
      currency: 'BRL',
      created_at: '2026-09-14T10:00:00Z',
      updated_at: '2026-09-14T10:05:00Z',
      extra,
    }])

    const result = await runBackfillNuvemshopOrders({
      from: new Date('2026-09-14T00:00:00Z'),
      to: new Date('2026-09-14T23:59:59Z'),
      scheduleMessages: false,
    })

    expect(result).toMatchObject({ found: 1, created: 1, errors: 0, messagesScheduled: 0 })
    expect(mocks.recordConsent).toHaveBeenCalledWith(expect.objectContaining({
      normalizedPhone: expect.any(String),
      extra,
      nuvemshopOrderId: '123',
    }))
    expect(mocks.messageUpdateMany).not.toHaveBeenCalled()
  })

  it('does not fail an order backfill if consent reconciliation fails', async () => {
    mocks.recordConsent.mockRejectedValueOnce(new Error('consent write failed'))

    const result = await runBackfillNuvemshopOrders({
      from: new Date('2026-09-14T00:00:00Z'),
      to: new Date('2026-09-14T23:59:59Z'),
      scheduleMessages: false,
    })

    expect(result).toMatchObject({ found: 1, created: 1, errors: 0, messagesScheduled: 0 })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[backfillNuvemshopOrders] consentimento do checkout falhou',
      expect.objectContaining({ orderId: '123', error: 'consent write failed' }),
    )
  })

  it('refuses any attempt to schedule messages during historical backfill', async () => {
    await expect(runBackfillNuvemshopOrders({
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-09-14T23:59:59Z'),
      scheduleMessages: true as never,
    })).rejects.toThrow('historical_message_scheduling_forbidden')
    expect(mocks.fetchOrders).not.toHaveBeenCalled()
  })

  it('updates an existing order idempotently without creating a historical message', async () => {
    mocks.customerFindFirst.mockResolvedValue({
      id: 'customer-1',
      name: 'Maria Silva',
      email: 'maria@example.com',
      phone: '+55 83 99876-5432',
    })
    mocks.customerUpdate.mockResolvedValue({ id: 'customer-1' })
    mocks.orderFindUnique.mockResolvedValue({ id: 'order-1' })
    mocks.orderUpdate.mockResolvedValue({ id: 'order-1' })

    const result = await runBackfillNuvemshopOrders({
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-09-14T23:59:59Z'),
      scheduleMessages: false,
    })

    expect(result).toMatchObject({ found: 1, created: 0, updated: 1, errors: 0, messagesScheduled: 0 })
    expect(mocks.orderCreate).not.toHaveBeenCalled()
    expect(mocks.orderUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.messageUpdateMany).not.toHaveBeenCalled()
  })
})
