import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageStatus } from '@prisma/client'
import { messageService } from '../../services/messageService'
import { prisma } from '../../config/prisma'

vi.mock('../../config/prisma', () => ({ prisma: {
  messageLog: { findMany: vi.fn(), updateMany: vi.fn() },
  chatMessage: { findMany: vi.fn(), updateMany: vi.fn() },
} }))

describe('delivery status conditional advancement', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each(['sent', 'delivered', 'failed'] as const)('read never regresses to %s', async (status) => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([{ id: 'log', status: 'read' }] as never)
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([{ id: 'chat', status: 'read' }] as never)
    await messageService.updateStatusByMetaMessageId('wamid', MessageStatus[status])
    expect(prisma.messageLog.updateMany).not.toHaveBeenCalled()
    expect(prisma.chatMessage.updateMany).not.toHaveBeenCalled()
  })
  it('updates both stores conditionally so concurrent events cannot overwrite a newer status', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([{ id: 'log', status: 'sent' }] as never)
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([{ id: 'chat', status: 'sent' }] as never)
    await messageService.updateStatusByMetaMessageId('wamid', MessageStatus.read)
    expect(prisma.messageLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'log', status: 'sent' }, data: expect.objectContaining({ status: 'read' }) }))
    expect(prisma.chatMessage.updateMany).toHaveBeenCalledWith({ where: { id: 'chat', status: 'sent' }, data: { status: 'read' } })
  })
})
