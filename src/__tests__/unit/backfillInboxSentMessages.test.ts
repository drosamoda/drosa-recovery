import { MessageStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: {
    messageLog: {
      findMany: vi.fn(),
    },
    chatMessage: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    contact: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    abandonedCheckout: {
      findUnique: vi.fn(),
    },
  },
}))

import { prisma } from '../../config/prisma'
import { runBackfillInboxSentMessages } from '../../jobs/backfillInboxSentMessages'

describe('runBackfillInboxSentMessages', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.contact.create).mockResolvedValue({
      id: 'contact-1',
      phone: '5583999999999',
      name: null,
    } as never)
    vi.mocked(prisma.contact.update).mockResolvedValue({
      id: 'contact-1',
      phone: '5583999999999',
      name: 'Maria Cristina',
    } as never)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.conversation.create).mockResolvedValue({
      id: 'conversation-1',
      contactId: 'contact-1',
    } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue({
      id: 'conversation-1',
      contactId: 'contact-1',
    } as never)
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.abandonedCheckout.findUnique).mockResolvedValue(null)
  })

  it('cria chat_message para message_log enviado sem espelho e usa nome real do pedido', async () => {
    const sentAt = new Date('2026-05-05T12:00:00.000Z')

    vi.mocked(prisma.messageLog.findMany)
      .mockResolvedValueOnce([
        {
          id: 'log-1',
          entityType: 'order',
          entityId: 'order-1',
          normalizedPhone: '5583999999999',
          templateName: 'confirmacao_pedido_drosa',
          status: MessageStatus.sent,
          metaMessageId: 'wamid.sent.1',
          payload: null,
          response: null,
          sentAt,
          createdAt: sentAt,
        },
      ] as never)
      .mockResolvedValueOnce([] as never)

    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      customerName: 'Maria Cristina',
      customerPhone: '5583999999999',
      normalizedPhone: '5583999999999',
    } as never)
    vi.mocked(prisma.contact.create).mockResolvedValue({
      id: 'contact-1',
      phone: '5583999999999',
      name: 'Maria Cristina',
    } as never)
    vi.mocked(prisma.conversation.create).mockResolvedValue({
      id: 'conversation-1',
      contactId: 'contact-1',
    } as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue({ id: 'conversation-1' } as never)

    const result = await runBackfillInboxSentMessages()

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        waMessageId: 'wamid.sent.1',
        direction: 'outbound',
        type: 'template',
        body: 'Confirmação de pedido enviada',
        status: MessageStatus.sent,
      }),
    }))
    expect(prisma.contact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '5583999999999',
        name: 'Maria Cristina',
      }),
    }))
    expect(result.created).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('nao duplica se waMessageId ja existir', async () => {
    vi.mocked(prisma.messageLog.findMany)
      .mockResolvedValueOnce([
        {
          id: 'log-1',
          entityType: 'order',
          entityId: 'order-1',
          normalizedPhone: '5583999999999',
          templateName: 'confirmacao_pedido_drosa',
          status: MessageStatus.sent,
          metaMessageId: 'wamid.duplicated',
          payload: null,
          response: null,
          sentAt: new Date('2026-05-05T12:00:00.000Z'),
          createdAt: new Date('2026-05-05T12:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)

    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue({
      id: 'chat-existing',
      conversationId: 'conversation-1',
    } as never)

    const result = await runBackfillInboxSentMessages()

    expect(prisma.chatMessage.create).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })

  it('usa fallback amigavel quando nao houver pedido relacionado', async () => {
    vi.mocked(prisma.messageLog.findMany)
      .mockResolvedValueOnce([
        {
          id: 'log-1',
          entityType: 'order',
          entityId: 'order-1',
          normalizedPhone: '5583999999999',
          templateName: 'pedido_boleto_drosa_01',
          status: MessageStatus.delivered,
          metaMessageId: 'wamid.sent.3',
          payload: null,
          response: null,
          sentAt: new Date('2026-05-05T12:00:00.000Z'),
          createdAt: new Date('2026-05-05T12:00:00.000Z'),
        },
      ] as never)
      .mockResolvedValueOnce([] as never)

    vi.mocked(prisma.order.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.contact.create).mockResolvedValue({
      id: 'contact-1',
      phone: '5583999999999',
      name: null,
    } as never)
    vi.mocked(prisma.conversation.create).mockResolvedValue({
      id: 'conversation-1',
      contactId: 'contact-1',
    } as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue({ id: 'conversation-1' } as never)

    await runBackfillInboxSentMessages()

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: 'Lembrete de boleto enviado',
      }),
    }))
  })
})
