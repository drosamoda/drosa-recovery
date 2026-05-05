import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    chatMessage: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    messageLog: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      update: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    abandonedCheckout: {
      findUnique: vi.fn(),
    },
    whatsappTemplate: {
      findFirst: vi.fn(),
    },
  },
}))

import { logger } from '../../config/logger'
import { prisma } from '../../config/prisma'
import { runBackfillInboxRenderedTemplatePreviews } from '../../jobs/backfillInboxRenderedTemplatePreviews'

describe('runBackfillInboxRenderedTemplatePreviews', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.chatMessage.update).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.messageLog.update).mockResolvedValue({ id: 'log-1' } as never)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.contact.create).mockResolvedValue({
      id: 'contact-1',
      phone: '5531999999999',
      name: 'Maria Silva',
    } as never)
    vi.mocked(prisma.contact.update).mockResolvedValue({
      id: 'contact-1',
      phone: '5531999999999',
      name: 'Maria Silva',
    } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue({ id: 'conversation-1' } as never)
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.abandonedCheckout.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue(null)
  })

  it('atualiza body, rawPayload e message_log.payload para pedido com preview completo', async () => {
    vi.mocked(prisma.chatMessage.findMany)
      .mockResolvedValueOnce([
        {
          id: 'chat-1',
          conversationId: 'conversation-1',
          waMessageId: 'wamid-1',
          body: 'Confirmação de pedido enviada',
          rawPayload: { source: 'automation_mirror' },
          timestamp: new Date('2026-05-05T12:00:00.000Z'),
          createdAt: new Date('2026-05-05T12:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)

    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue({
      id: 'log-1',
      entityType: 'order',
      entityId: 'order-1',
      normalizedPhone: '5531999999999',
      templateName: 'confirmacao_pedido_drosa',
      metaMessageId: 'wamid-1',
      payload: {},
      sentAt: new Date('2026-05-05T12:00:00.000Z'),
      createdAt: new Date('2026-05-05T12:00:00.000Z'),
    } as never)

    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      customerName: 'Maria Silva',
      customerEmail: 'maria@example.com',
      customerPhone: '5531999999999',
      normalizedPhone: '5531999999999',
      orderNumber: '1001',
      total: '149.90',
      orderUrl: 'https://example.com/pedido/1001',
      status: 'paid',
      paymentStatus: 'paid',
    } as never)
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue({
      messagePreview: `Oi, [nome_cliente]! 😊\n\nRecebemos o seu pedido *[numero_pedido]* com sucesso.\n\nAgora estamos aguardando a confirmação do pagamento para separar suas peças com todo carinho.\n\n👉 *Entre aqui:* [link_grupo_vip]`,
    } as never)

    const result = await runBackfillInboxRenderedTemplatePreviews()

    expect(result.updatedChatMessages).toBe(1)
    expect(result.updatedMessageLogs).toBe(1)
    const chatUpdate = vi.mocked(prisma.chatMessage.update).mock.calls[0]?.[0]
    const logUpdate = vi.mocked(prisma.messageLog.update).mock.calls[0]?.[0]

    expect(chatUpdate).toBeTruthy()
    expect(chatUpdate?.where).toEqual({ id: 'chat-1' })
    expect(chatUpdate?.data.body).toContain('Recebemos o seu pedido')
    expect(chatUpdate?.data.rawPayload).toEqual(expect.objectContaining({
      source: 'automation',
      templateName: 'confirmacao_pedido_drosa',
      renderedPreview: expect.stringContaining('Recebemos o seu pedido'),
      templateParameters: expect.objectContaining({
        nome_cliente: 'Maria',
        numero_pedido: '1001',
        valor_total: expect.stringContaining('149,90'),
        link_checkout: 'https://example.com/pedido/1001',
      }),
    }))
    expect(logUpdate).toBeTruthy()
    expect(logUpdate?.where).toEqual({ id: 'log-1' })
    expect(logUpdate?.data.payload).toEqual(expect.objectContaining({
      renderedPreview: expect.stringContaining('Recebemos o seu pedido'),
      templateParameters: expect.objectContaining({
        nome_cliente: 'Maria',
        numero_pedido: '1001',
      }),
    }))
  })

  it('usa rawPayload.messageLogId quando waMessageId nao existe e atualiza checkout', async () => {
    vi.mocked(prisma.chatMessage.findMany)
      .mockResolvedValueOnce([
        {
          id: 'chat-2',
          conversationId: 'conversation-2',
          waMessageId: null,
          body: 'Mensagem de carrinho abandonado enviada',
          rawPayload: { source: 'automation_mirror', messageLogId: 'log-checkout-1' },
          timestamp: new Date('2026-05-05T13:00:00.000Z'),
          createdAt: new Date('2026-05-05T13:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)

    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue({
      id: 'log-checkout-1',
      entityType: 'abandoned_checkout',
      entityId: 'checkout-1',
      normalizedPhone: '5541999999999',
      templateName: 'carrinho_abandonado_drosa_01',
      metaMessageId: 'wamid-checkout-1',
      payload: {},
      sentAt: new Date('2026-05-05T13:00:00.000Z'),
      createdAt: new Date('2026-05-05T13:00:00.000Z'),
    } as never)
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue({
      messagePreview: `Oi, [nome_cliente]! 😊\n\nVocê deixou alguns itens no carrinho.\n\n*Produtos:* [resumo_produtos]\n\n👉 Finalize por aqui: [link_checkout]`,
    } as never)

    vi.mocked(prisma.abandonedCheckout.findUnique).mockResolvedValue({
      customerName: 'Regina Bonatto',
      customerEmail: 'regina@example.com',
      customerPhone: '5541999999999',
      normalizedPhone: '5541999999999',
      total: '189.90',
      productsSummary: 'Vestido longo, blusa premium',
      abandonedCheckoutUrl: 'https://example.com/carrinho/checkout-1',
    } as never)

    const result = await runBackfillInboxRenderedTemplatePreviews()

    const checkoutUpdate = vi.mocked(prisma.chatMessage.update).mock.calls[0]?.[0]
    expect(checkoutUpdate).toBeTruthy()
    expect(checkoutUpdate?.data.body).toContain('Regina')
    expect(checkoutUpdate?.data.rawPayload).toEqual(expect.objectContaining({
      renderedPreview: expect.stringContaining('Regina'),
      templateParameters: expect.objectContaining({
        nome_cliente: 'Regina',
        resumo_produtos: 'Vestido longo, blusa premium',
        link_checkout: 'https://example.com/carrinho/checkout-1',
      }),
    }))
  })

  it('pula com motivo quando nao consegue resolver o contexto', async () => {
    vi.mocked(prisma.chatMessage.findMany)
      .mockResolvedValueOnce([
        {
          id: 'chat-3',
          conversationId: 'conversation-3',
          waMessageId: 'wamid-3',
          body: 'Confirmação de pedido enviada',
          rawPayload: { source: 'automation_mirror' },
          timestamp: new Date('2026-05-05T14:00:00.000Z'),
          createdAt: new Date('2026-05-05T14:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)

    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue({
      id: 'log-3',
      entityType: 'order',
      entityId: 'order-missing',
      normalizedPhone: '5531999999999',
      templateName: 'confirmacao_pedido_drosa',
      metaMessageId: 'wamid-3',
      payload: {},
      sentAt: new Date('2026-05-05T14:00:00.000Z'),
      createdAt: new Date('2026-05-05T14:00:00.000Z'),
    } as never)
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null)

    const result = await runBackfillInboxRenderedTemplatePreviews()

    expect(result.skipped).toBe(1)
    expect(prisma.chatMessage.update).not.toHaveBeenCalled()
    expect(prisma.messageLog.update).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[backfillInboxRenderedTemplatePreviews] ignorado',
      expect.objectContaining({
        reason: 'missing_order',
      })
    )
  })
})
