import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventType } from '@prisma/client'

const mocks = vi.hoisted(() => {
  const tx = {
    order: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    abandonedCheckout: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  }

  return {
    tx,
    transaction: vi.fn(async (fn: (txArg: typeof tx) => Promise<unknown>) => fn(tx)),
    automationRuleFindFirst: vi.fn(),
    whatsappTemplateFindFirst: vi.fn(),
    fetchOrderById: vi.fn(),
    upsertCustomer: vi.fn(),
    existsBlockingLog: vi.fn(),
    createPendingMessageIfNotExists: vi.fn(),
    skipPendingCheckoutLogs: vi.fn(),
    markProcessed: vi.fn(),
    markError: vi.fn(),
  }
})

vi.mock('../../config/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    automationRule: {
      findFirst: mocks.automationRuleFindFirst,
    },
    whatsappTemplate: {
      findFirst: mocks.whatsappTemplateFindFirst,
    },
  },
}))

vi.mock('../../services/nuvemshopService', () => ({
  nuvemshopService: {
    fetchOrderById: mocks.fetchOrderById,
  },
}))

vi.mock('../../services/customerService', () => ({
  customerService: {
    upsertCustomer: mocks.upsertCustomer,
  },
}))

vi.mock('../../services/messageService', () => ({
  messageService: {
    existsBlockingLog: mocks.existsBlockingLog,
    createPendingMessageIfNotExists: mocks.createPendingMessageIfNotExists,
    skipPendingCheckoutLogs: mocks.skipPendingCheckoutLogs,
  },
}))

vi.mock('../../services/webhookEventService', () => ({
  webhookEventService: {
    markProcessed: mocks.markProcessed,
    markError: mocks.markError,
  },
}))

import { orderService } from '../../services/orderService'
import { nuvemshopService } from '../../services/nuvemshopService'

const fullOrderPayload = {
  id: 1944167967,
  number: 1001,
  status: 'open',
  event: 'order/created',
  payment_status: 'pending',
  payment_details: { method: 'pix' },
  contact_name: 'Maria Silva',
  contact_email: 'maria@example.com',
  contact_phone: '+55 (83) 99999-9999',
  total: '199.90',
  currency: 'BRL',
  checkout_url: 'https://www.drosamoda.com.br/checkout/abc',
}

describe('orderService.handleNuvemshopOrderWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tx.order.findUnique.mockResolvedValue(null)
    mocks.tx.order.create.mockResolvedValue({ id: 'order-db-1' })
    mocks.tx.order.update.mockResolvedValue({ id: 'order-db-1' })
    mocks.tx.abandonedCheckout.findMany.mockResolvedValue([])
    mocks.upsertCustomer.mockResolvedValue({ id: 'customer-1', optOut: false })
    mocks.automationRuleFindFirst.mockResolvedValue({
      id: 'rule-1',
      eventType: EventType.order_created_pix,
      templateName: 'pedido_pix',
      delayMinutes: 0,
      active: true,
    })
    mocks.whatsappTemplateFindFirst.mockResolvedValue({
      id: 'template-1',
      metaTemplateName: 'pedido_pix',
      active: true,
    })
    mocks.existsBlockingLog.mockResolvedValue(false)
    mocks.createPendingMessageIfNotExists.mockResolvedValue({ id: 'message-log-1' })
    mocks.markProcessed.mockResolvedValue(undefined)
    mocks.markError.mockResolvedValue(undefined)
  })

  it('busca pedido completo na Nuvemshop quando o webhook vem resumido', async () => {
    mocks.fetchOrderById.mockResolvedValue(fullOrderPayload)

    await orderService.handleNuvemshopOrderWebhook({
      payload: { id: 1944167967, store_id: 123, event: 'order/created' },
      headers: {},
      webhookEventId: 'event-1',
    })

    expect(nuvemshopService.fetchOrderById).toHaveBeenCalledWith('1944167967')
    expect(mocks.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nuvemshopOrderId: '1944167967',
        customerName: 'Maria Silva',
        normalizedPhone: '5583999999999',
        paymentStatus: 'pending',
        webhookTopic: 'order/created',
        rawPayload: {
          originalWebhookPayload: { id: 1944167967, store_id: 123, event: 'order/created' },
          fetchedOrderPayload: fullOrderPayload,
        },
      }),
    }))
  })

  it('salva pedido completo com telefone e agenda message_log quando existe regra ativa', async () => {
    await orderService.handleNuvemshopOrderWebhook({
      payload: fullOrderPayload,
      headers: { 'x-linkedstore-topic': 'order/created' },
      webhookEventId: 'event-2',
    })

    expect(nuvemshopService.fetchOrderById).not.toHaveBeenCalled()
    expect(mocks.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerName: 'Maria Silva',
        customerEmail: 'maria@example.com',
        customerPhone: '+55 (83) 99999-9999',
        normalizedPhone: '5583999999999',
        status: 'open',
        paymentStatus: 'pending',
        webhookTopic: 'order/created',
      }),
    }))
    expect(mocks.createPendingMessageIfNotExists).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'order',
      entityId: 'order-db-1',
      customerId: 'customer-1',
      normalizedPhone: '5583999999999',
      templateName: 'pedido_pix',
      source: 'nuvemshop_webhook',
    }))
  })

  it('quando telefone estiver ausente salva pedido, nao agenda mensagem e marca evento processado', async () => {
    const orderWithoutPhone = { ...fullOrderPayload, contact_phone: '' }
    mocks.fetchOrderById.mockResolvedValue(orderWithoutPhone)

    await orderService.handleNuvemshopOrderWebhook({
      payload: { id: 1944167967, store_id: 123, event: 'order/created' },
      headers: {},
      webhookEventId: 'event-3',
    })

    expect(mocks.tx.order.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        normalizedPhone: '',
        rawPayload: {
          originalWebhookPayload: { id: 1944167967, store_id: 123, event: 'order/created' },
          fetchedOrderPayload: orderWithoutPhone,
        },
      }),
    }))
    expect(mocks.createPendingMessageIfNotExists).not.toHaveBeenCalled()
    expect(mocks.markProcessed).toHaveBeenCalledWith('event-3')
    expect(mocks.markError).not.toHaveBeenCalled()
  })

  it('quando falha ao buscar pedido completo nao salva pedido incompleto nem cria mensagem', async () => {
    mocks.fetchOrderById.mockRejectedValue(new Error('Nuvemshop order fetch failed'))

    await orderService.handleNuvemshopOrderWebhook({
      payload: { id: 1944167967, store_id: 123, event: 'order/created' },
      headers: {},
      webhookEventId: 'event-4',
    })

    expect(nuvemshopService.fetchOrderById).toHaveBeenCalledWith('1944167967')
    expect(mocks.upsertCustomer).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.tx.order.create).not.toHaveBeenCalled()
    expect(mocks.createPendingMessageIfNotExists).not.toHaveBeenCalled()
    expect(mocks.markProcessed).not.toHaveBeenCalled()
    expect(mocks.markError).toHaveBeenCalledWith('event-4', 'Nuvemshop order fetch failed')
  })
})
