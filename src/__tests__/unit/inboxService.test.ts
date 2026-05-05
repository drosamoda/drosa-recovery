import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: {
    contact: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    order: {
      findUnique: vi.fn(),
    },
    abandonedCheckout: {
      findUnique: vi.fn(),
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
    vi.mocked(prisma.order.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.abandonedCheckout.findUnique).mockResolvedValue(null)
  })

  it('cria ChatMessage outbound template para automacao enviada com metaMessageId', async () => {
    const contact = { id: 'contact-1', phone: '5583999999999', name: null }
    const conversation = { id: 'conversation-1', contactId: contact.id }

    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.contact.create).mockResolvedValue(contact as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
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
        body: 'Confirmação de pedido enviada',
        status: 'sent',
        rawPayload: expect.objectContaining({
          source: 'automation_mirror',
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

  it('usa customerName do pedido no contato ao espelhar automacao de order', async () => {
    const contact = { id: 'contact-1', phone: '5583999999999', name: 'Maria Silva' }
    const conversation = { id: 'conversation-1', contactId: contact.id }

    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      nuvemshopOrderId: '1944167967',
      customerName: 'Maria Silva',
      customerEmail: 'maria@example.com',
      customerPhone: '+55 (83) 99999-9999',
      normalizedPhone: '5583999999999',
    } as never)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.contact.create).mockResolvedValue(contact as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    await inboxService.mirrorAutomationMessage({
      phone: '5583000000000',
      metaMessageId: 'wamid.order.1',
      templateName: 'confirmacao_pedido_drosa',
      status: 'sent',
      entityType: 'order',
      entityId: 'order-1',
      messageLogId: 'msg-001',
    })

    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: {
        phone: '5583999999999',
        name: 'Maria Silva',
      },
    })
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: 'Confirmação de pedido enviada',
        rawPayload: expect.objectContaining({
          source: 'automation_mirror',
          entityType: 'order',
          entityId: 'order-1',
          orderId: '1944167967',
          customerName: 'Maria Silva',
          customerEmail: 'maria@example.com',
        }),
      }),
    }))
  })

  it('atualiza contato Sem nome para nome real', async () => {
    const existingContact = { id: 'contact-1', phone: '5583999999999', name: 'Sem nome' }
    const updatedContact = { ...existingContact, name: 'Maria Silva' }
    const conversation = { id: 'conversation-1', contactId: existingContact.id }

    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      nuvemshopOrderId: '1944167967',
      customerName: 'Maria Silva',
      customerEmail: null,
      customerPhone: null,
      normalizedPhone: '5583999999999',
    } as never)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(existingContact as never)
    vi.mocked(prisma.contact.update).mockResolvedValue(updatedContact as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    await inboxService.mirrorAutomationMessage({
      phone: '5583999999999',
      metaMessageId: 'wamid.order.2',
      templateName: 'confirmacao_pedido_drosa',
      status: 'sent',
      entityType: 'order',
      entityId: 'order-1',
    })

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: { name: 'Maria Silva' },
    })
  })

  it('nao sobrescreve contato com nome real por Cliente', async () => {
    const existingContact = { id: 'contact-1', phone: '5583999999999', name: 'Maria Silva' }
    const conversation = { id: 'conversation-1', contactId: existingContact.id }

    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      nuvemshopOrderId: '1944167967',
      customerName: 'Cliente',
      customerEmail: null,
      customerPhone: null,
      normalizedPhone: '5583999999999',
    } as never)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(existingContact as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    await inboxService.mirrorAutomationMessage({
      phone: '5583999999999',
      metaMessageId: 'wamid.order.3',
      templateName: 'confirmacao_pedido_drosa',
      status: 'sent',
      entityType: 'order',
      entityId: 'order-1',
    })

    expect(prisma.contact.update).not.toHaveBeenCalled()
  })

  it('nao duplica ChatMessage por waMessageId, mas atualiza contato placeholder', async () => {
    const existingContact = { id: 'contact-1', phone: '5583999999999', name: 'Sem nome' }

    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-1',
      nuvemshopOrderId: '1944167967',
      customerName: 'Maria Silva',
      customerEmail: null,
      customerPhone: null,
      normalizedPhone: '5583999999999',
    } as never)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(existingContact as never)
    vi.mocked(prisma.contact.update).mockResolvedValue({ ...existingContact, name: 'Maria Silva' } as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue({
      id: 'chat-existing',
      conversationId: 'conversation-1',
    } as never)

    const result = await inboxService.mirrorAutomationMessage({
      phone: '5583999999999',
      metaMessageId: 'wamid.order.4',
      templateName: 'confirmacao_pedido_drosa',
      status: 'sent',
      entityType: 'order',
      entityId: 'order-1',
    })

    expect(result.created).toBe(false)
    expect(prisma.contact.update).toHaveBeenCalled()
    expect(prisma.chatMessage.create).not.toHaveBeenCalled()
  })

  it('usa dados do abandoned_checkout e body amigavel para carrinho abandonado', async () => {
    const contact = { id: 'contact-1', phone: '5541999176724', name: 'Ana Souza' }
    const conversation = { id: 'conversation-1', contactId: contact.id }

    vi.mocked(prisma.abandonedCheckout.findUnique).mockResolvedValue({
      id: 'checkout-1',
      nuvemshopCheckoutId: 'checkout-remote-1',
      customerName: 'Ana Souza',
      customerEmail: 'ana@example.com',
      customerPhone: '(41) 99917-6724',
      normalizedPhone: '5541999176724',
    } as never)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.contact.create).mockResolvedValue(contact as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.conversation.findFirst).mockResolvedValue(conversation as never)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({ id: 'chat-1' } as never)
    vi.mocked(prisma.conversation.update).mockResolvedValue(conversation as never)

    await inboxService.mirrorAutomationMessage({
      phone: '5541000000000',
      metaMessageId: 'wamid.checkout.1',
      templateName: 'carrinho_abandonado_drosa_01',
      status: 'sent',
      entityType: 'abandoned_checkout',
      entityId: 'checkout-1',
    })

    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: {
        phone: '5541999176724',
        name: 'Ana Souza',
      },
    })
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: 'Mensagem de carrinho abandonado enviada',
        rawPayload: expect.objectContaining({
          source: 'automation_mirror',
          entityType: 'abandoned_checkout',
          entityId: 'checkout-1',
          checkoutId: 'checkout-remote-1',
          customerName: 'Ana Souza',
          customerEmail: 'ana@example.com',
        }),
      }),
    }))
  })
})
