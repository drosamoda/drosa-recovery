import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
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
    chatMessage: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

import { prisma } from '../../config/prisma'
import { runBackfillImportedWhatsAppSends } from '../../jobs/backfillImportedWhatsAppSends'

describe('runBackfillImportedWhatsAppSends', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(prisma.contact.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.contact.create).mockResolvedValue({
      id: 'contact-1',
      phone: '5541999176724',
      name: 'Regina Bonatto',
    } as never)
    vi.mocked(prisma.contact.update).mockResolvedValue({
      id: 'contact-1',
      phone: '5541999176724',
      name: 'Regina Bonatto',
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
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.chatMessage.create).mockResolvedValue({
      id: 'chat-1',
    } as never)
  })

  it('cria chat_message a partir de whatsapp_envios_importados', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        data: {
          origem: 'api',
          id: 'import-1',
          telefone: '55 (41) 99917-6724',
          nome: 'Regina Bonatto',
          tipo_mensagem: 'template',
          status: 'sent',
          wa_message_id: 'wamid.imported.1',
          corpo: 'Mensagem importada',
          enviado_em: '2026-05-05T12:00:00.000Z',
          criado_em: '2026-05-05T11:59:00.000Z',
          imported_at: '2026-05-05T11:58:00.000Z',
        },
      },
    ] as never)

    const result = await runBackfillImportedWhatsAppSends()

    expect(result.found).toBe(1)
    expect(result.created).toBe(1)
    expect(prisma.contact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '5541999176724',
        name: 'Regina Bonatto',
      }),
    }))
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        waMessageId: 'wamid.imported.1',
        direction: 'outbound',
        type: 'template',
        body: 'Mensagem importada',
        timestamp: new Date('2026-05-05T12:00:00.000Z'),
        rawPayload: expect.objectContaining({
          source: 'whatsapp_envios_importados',
          origem: 'api',
          id: 'import-1',
          status: 'sent',
          imported_at: '2026-05-05T12:00:00.000Z',
          wa_message_id: 'wamid.imported.1',
          telefone: '5541999176724',
          nome: 'Regina Bonatto',
          tipo_mensagem: 'template',
          corpo: 'Mensagem importada',
        }),
      }),
    }))
  })

  it('nao duplica por wa_message_id', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        data: {
          origem: 'api',
          id: 'import-2',
          telefone: '5541999176724',
          nome: 'Regina Bonatto',
          tipo_mensagem: 'text',
          status: 'sent',
          wa_message_id: 'wamid.imported.2',
          corpo: 'Mensagem importada',
          enviado_em: '2026-05-05T12:00:00.000Z',
        },
      },
    ] as never)
    vi.mocked(prisma.chatMessage.findFirst).mockResolvedValue({
      id: 'chat-existing',
    } as never)

    const result = await runBackfillImportedWhatsAppSends()

    expect(result.skipped).toBe(1)
    expect(prisma.chatMessage.create).not.toHaveBeenCalled()
  })

  it('atualiza contato sem nome com nome real', async () => {
    vi.mocked(prisma.contact.findUnique).mockResolvedValue({
      id: 'contact-1',
      phone: '5541999176724',
      name: 'Sem nome',
    } as never)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        data: {
          origem: 'api',
          id: 'import-3',
          telefone: '5541999176724',
          nome: 'Regina Bonatto',
          tipo_mensagem: 'text',
          status: 'sent',
          wa_message_id: 'wamid.imported.3',
          corpo: 'Oi',
          enviado_em: '2026-05-05T12:00:00.000Z',
        },
      },
    ] as never)

    await runBackfillImportedWhatsAppSends()

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: { name: 'Regina Bonatto' },
    })
  })

  it('usa enviado_em como timestamp quando valido', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      {
        data: {
          origem: 'api',
          id: 'import-4',
          telefone: '5541999176724',
          nome: 'Regina Bonatto',
          tipo_mensagem: 'text',
          status: 'sent',
          wa_message_id: 'wamid.imported.4',
          corpo: 'Oi',
          enviado_em: '2026-05-05T12:34:56.000Z',
        },
      },
    ] as never)

    await runBackfillImportedWhatsAppSends()

    expect(prisma.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        timestamp: new Date('2026-05-05T12:34:56.000Z'),
      }),
    }))
  })
})
