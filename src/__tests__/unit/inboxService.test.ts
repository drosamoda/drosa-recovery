import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: {
    contact: {
      upsert: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      contact: {
        upsert: vi.fn(),
      },
      conversation: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      chatMessage: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    })),
  },
}))

vi.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'development',
    INBOX_SEND_DRY_RUN: true,
  },
}))

vi.mock('../../services/whatsappService', () => ({
  whatsappService: {
    sendTextMessage: vi.fn(),
  },
}))

import { prisma } from '../../config/prisma'
import { inboxService } from '../../services/inboxService'
import { whatsappService } from '../../services/whatsappService'

describe('inboxService.saveInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria contato, conversa aberta e mensagem inbound', async () => {
    const contact = { id: 'contact-1', phone: '558393464855', name: 'Maria' }
    const conversation = { id: 'conversation-1', contactId: contact.id }

    vi.mocked(prisma.contact.upsert).mockResolvedValue(contact as never)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.conversation.create).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'message-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    const result = await inboxService.saveInboundMessage({
      phone: '558393464855',
      name: 'Maria',
      waMessageId: 'wamid.123',
      type: 'text',
      body: 'Oi',
      rawPayload: { text: { body: 'Oi' } },
      timestamp: new Date('2026-05-05T12:00:00.000Z'),
    })

    expect(result.created).toBe(true)
    expect(prisma.contact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { phone: '558393464855' },
    }))
    expect(prisma.conversation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contactId: contact.id, status: 'open' }),
    }))
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: conversation.id,
        waMessageId: 'wamid.123',
        direction: 'inbound',
        body: 'Oi',
      }),
    }))
  })

  it('nao duplica mensagem inbound quando waMessageId ja existe', async () => {
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue({ id: 'message-existing' } as never)

    const result = await inboxService.saveInboundMessage({
      phone: '558393464855',
      waMessageId: 'wamid.duplicated',
      type: 'text',
      body: 'Oi',
      rawPayload: {},
      timestamp: new Date('2026-05-05T12:00:00.000Z'),
    })

    expect(result.created).toBe(false)
    expect(prisma.contact.upsert).not.toHaveBeenCalled()
    expect(prisma.chatMessage.create).not.toHaveBeenCalled()
  })

  it('salva mensagem image com media id no rawPayload e legenda como body', async () => {
    const contact = { id: 'contact-1', phone: '5583999999999', name: 'Cliente Foto' }
    const conversation = { id: 'conversation-1', contactId: contact.id }

    vi.mocked(prisma.contact.upsert).mockResolvedValue(contact as never)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'message-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    await inboxService.saveInboundMessagesFromMetaPayload({
      entry: [{
        changes: [{
          value: {
            contacts: [{ wa_id: '5583999999999', profile: { name: 'Cliente Foto' } }],
            messages: [{
              id: 'wamid.image.1',
              from: '5583999999999',
              timestamp: '1777989600',
              type: 'image',
              image: {
                id: 'media-123',
                caption: 'Olha essa peça',
                mime_type: 'image/jpeg',
                sha256: 'hash-123',
              },
            }],
          },
        }],
      }],
    })

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        waMessageId: 'wamid.image.1',
        type: 'image',
        body: 'Olha essa peça',
        rawPayload: expect.objectContaining({
          image: expect.objectContaining({
            id: 'media-123',
            mime_type: 'image/jpeg',
            sha256: 'hash-123',
          }),
        }),
      }),
    }))
  })
})

describe('inboxService.sendManualTextMessage dry-run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('salva outbound dry_run sem chamar WhatsApp Cloud API em ambiente nao-producao', async () => {
    const lastInboundAt = new Date()
    const conversation = {
      id: 'conversation-1',
      lastInboundAt,
      contact: {
        phone: '5583999999999',
      },
    }
    const savedMessage = {
      id: 'message-1',
      conversationId: 'conversation-1',
      direction: 'outbound',
      type: 'text',
      body: 'Resposta de teste',
      status: 'dry_run',
    }

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue(savedMessage as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    const result = await inboxService.sendManualTextMessage('conversation-1', 'Resposta de teste')

    expect(result.success).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(whatsappService.sendTextMessage).not.toHaveBeenCalled()
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'conversation-1',
        direction: 'outbound',
        type: 'text',
        body: 'Resposta de teste',
        status: 'dry_run',
      }),
    }))
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conversation-1' },
      data: expect.objectContaining({ lastMessageAt: expect.any(Date) }),
    }))
  })
})

describe('inboxService.mirrorAutomationMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cria ChatMessage outbound template para automacao enviada com metaMessageId', async () => {
    const contact = { id: 'contact-1', phone: '5583999999999', name: null }
    const conversation = { id: 'conversation-1', contactId: contact.id }

    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.contact.upsert).mockResolvedValue(contact as never)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.conversation.create).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    const result = await inboxService.mirrorAutomationMessage({
      phone: '5583999999999',
      metaMessageId: 'wamid.auto.123',
      templateName: 'confirmacao_pedido_drosa',
      status: 'sent',
      sentAt: new Date('2026-05-05T12:00:00.000Z'),
      messageLogId: 'msg-001',
    })

    expect(result.created).toBe(true)
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 'conversation-1',
        waMessageId: 'wamid.auto.123',
        direction: 'outbound',
        type: 'template',
        body: 'confirmacao_pedido_drosa',
        status: 'sent',
        rawPayload: expect.objectContaining({
          source: 'automation',
          templateName: 'confirmacao_pedido_drosa',
          messageLogId: 'msg-001',
        }),
      }),
    }))
    expect(prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conversation-1' },
      data: expect.objectContaining({ lastMessageAt: new Date('2026-05-05T12:00:00.000Z') }),
    }))
  })
})
