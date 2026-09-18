import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  ruleFindFirst: vi.fn(),
  templateFindFirst: vi.fn(),
  existsBlockingLog: vi.fn(),
  createPendingMessageIfNotExists: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    order: { findMany: mocks.orderFindMany },
    automationRule: { findFirst: mocks.ruleFindFirst },
    whatsappTemplate: { findFirst: mocks.templateFindFirst },
  },
}))

vi.mock('../../services/messageService', () => ({
  messageService: {
    existsBlockingLog: mocks.existsBlockingLog,
    createPendingMessageIfNotExists: mocks.createPendingMessageIfNotExists,
  },
}))

vi.mock('../../services/orderService', () => ({
  detectPaymentType: (method: string | null | undefined) =>
    /boleto|ticket/i.test(method ?? '') ? 'boleto' : /pix/i.test(method ?? '') ? 'pix' : 'other',
}))

vi.mock('../../config/env', () => ({
  env: {
    BOLETO_NOTIFY_HOURS: 48,
    CRON_BOLETO_EXPIRING_INTERVAL: 60,
  },
}))

import { runSyncBoletoExpiring } from '../../jobs/syncBoletoExpiring'

describe('runSyncBoletoExpiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'))
    vi.clearAllMocks()
    mocks.ruleFindFirst.mockResolvedValue({
      templateName: 'pedido_boleto_drosa_01',
      delayMinutes: 0,
      active: true,
    })
    mocks.templateFindFirst.mockResolvedValue({
      metaTemplateName: 'pedido_boleto_drosa_01',
      active: true,
    })
    mocks.existsBlockingLog.mockResolvedValue(false)
    mocks.createPendingMessageIfNotExists.mockResolvedValue({ id: 'message-1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('consulta a janela pelo sourceCreatedAt da Nuvemshop, nao pelo createdAt local', async () => {
    mocks.orderFindMany.mockResolvedValue([])

    await runSyncBoletoExpiring()

    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        paymentStatus: 'pending',
        sourceCreatedAt: {
          gte: new Date('2026-09-16T11:00:00Z'),
          lte: new Date('2026-09-16T12:00:00Z'),
        },
      }),
    }))
    const where = mocks.orderFindMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('createdAt')
  })

  it('agenda somente boleto pendente elegivel e preserva idempotencia', async () => {
    mocks.orderFindMany.mockResolvedValue([
      {
        id: 'order-1',
        customerId: 'customer-1',
        normalizedPhone: '5531998021418',
        paymentMethod: 'boleto',
        customer: { optOut: false },
      },
      {
        id: 'order-2',
        customerId: 'customer-2',
        normalizedPhone: '5531998021419',
        paymentMethod: 'pix',
        customer: { optOut: false },
      },
    ])

    const result = await runSyncBoletoExpiring()

    expect(result).toEqual({ found: 1, scheduled: 1 })
    expect(mocks.existsBlockingLog).toHaveBeenCalledWith(
      'order',
      'order-1',
      'pedido_boleto_drosa_01',
    )
    expect(mocks.createPendingMessageIfNotExists).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'order',
      entityId: 'order-1',
      templateName: 'pedido_boleto_drosa_01',
      source: 'sync_boleto_expiring',
    }))
  })
})
