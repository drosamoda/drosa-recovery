import { MessageDirection } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: {
    chatMessage: {
      updateMany: vi.fn(),
    },
  },
}))

import { prisma } from '../../config/prisma'
import { runBackfillInboxTemplatePreviews } from '../../jobs/backfillInboxTemplatePreviews'

describe('runBackfillInboxTemplatePreviews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.chatMessage.updateMany).mockResolvedValue({ count: 0 } as never)
  })

  it('atualiza body tecnico antigo de template para texto amigavel', async () => {
    vi.mocked(prisma.chatMessage.updateMany)
      .mockResolvedValueOnce({ count: 2 } as never)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)

    const result = await runBackfillInboxTemplatePreviews()

    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: {
        direction: MessageDirection.outbound,
        type: 'template',
        body: 'confirmacao_pedido_drosa',
      },
      data: { body: 'Confirmação de pedido enviada' },
    })
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({
      where: {
        direction: MessageDirection.outbound,
        type: 'template',
        body: 'carrinho_abandonado_drosa_01',
      },
      data: { body: 'Mensagem de carrinho abandonado enviada' },
    })
    expect(result.messagesUpdated).toBe(3)
  })

  it('nao altera mensagens inbound da cliente', async () => {
    await runBackfillInboxTemplatePreviews()

    for (const call of vi.mocked(prisma.chatMessage.updateMany).mock.calls) {
      expect(call[0].where).toMatchObject({
        direction: MessageDirection.outbound,
        type: 'template',
      })
    }
  })
})
