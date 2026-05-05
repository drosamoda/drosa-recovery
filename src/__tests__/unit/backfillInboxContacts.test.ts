import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: {
    contact: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
    },
    abandonedCheckout: {
      findMany: vi.fn(),
    },
    chatMessage: {
      updateMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../config/prisma'
import { runBackfillInboxContacts } from '../../jobs/backfillInboxContacts'

describe('runBackfillInboxContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.abandonedCheckout.findMany).mockResolvedValue([])
    vi.mocked(prisma.chatMessage.updateMany).mockResolvedValue({ count: 0 } as never)
  })

  it('atualiza contato Sem nome para nome real quando existe order com mesmo telefone', async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: 'contact-1', phone: '5583999999999', name: 'Sem nome' },
    ] as never)
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      { customerName: 'Maria Silva' },
    ] as never)
    vi.mocked(prisma.contact.update).mockResolvedValue({ id: 'contact-1', name: 'Maria Silva' } as never)

    const result = await runBackfillInboxContacts()

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact-1' },
      data: { name: 'Maria Silva' },
    })
    expect(result.contactsUpdated).toBe(1)
  })

  it('nao sobrescreve contato com nome real', async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: 'contact-1', phone: '5583999999999', name: 'Maria Silva' },
    ] as never)

    const result = await runBackfillInboxContacts()

    expect(prisma.order.findMany).not.toHaveBeenCalled()
    expect(prisma.contact.update).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })

  it('atualiza body antigo de template para texto amigavel', async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([] as never)
    vi.mocked(prisma.chatMessage.updateMany)
      .mockResolvedValueOnce({ count: 2 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 3 } as never)

    const result = await runBackfillInboxContacts()

    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: { body: 'confirmacao_pedido_drosa' },
      data: { body: 'Confirmação de pedido enviada' },
    })
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: { body: 'carrinho_abandonado_drosa_01' },
      data: { body: 'Mensagem de carrinho abandonado enviada' },
    })
    expect(result.messagesUpdated).toBe(6)
  })
})
