import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  conversation: { findMany: vi.fn() },
  chatMessage: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  order: { findMany: vi.fn(), findFirst: vi.fn() },
  $queryRaw: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({ prisma: prismaMock }))

import { inboxService } from '../../services/inboxService'

function conversation(i: number, phone: string) {
  return {
    id: `c${i}`,
    status: 'open',
    assignedTo: null,
    lastMessageAt: new Date('2026-09-20T10:00:00Z'),
    lastInboundAt: null,
    contact: { id: `k${i}`, name: `Cliente ${i}`, phone },
  }
}

describe('inboxService.listConversations (P0 pool=1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a constant number of queries regardless of conversation count', async () => {
    const convs = Array.from({ length: 100 }, (_, i) => conversation(i, `55839999900${String(i).padStart(2, '0')}`))
    prismaMock.conversation.findMany.mockResolvedValue(convs)
    prismaMock.$queryRaw.mockResolvedValue(convs.map((c) => ({ conversationId: c.id, lastMessageId: null, unansweredCount: 0n })))
    prismaMock.order.findMany.mockResolvedValue([])

    const rows = await inboxService.listConversations()

    expect(rows).toHaveLength(100)
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prismaMock.order.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.chatMessage.findMany).not.toHaveBeenCalled()
    expect(prismaMock.chatMessage.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.chatMessage.count).not.toHaveBeenCalled()
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled()
  })

  it('keeps the response shape: last message, unanswered count and latest order by either phone field', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([conversation(1, '5583911111111'), conversation(2, '5583922222222')])
    prismaMock.$queryRaw.mockResolvedValue([
      { conversationId: 'c1', lastMessageId: 'm1', unansweredCount: 3n },
      { conversationId: 'c2', lastMessageId: null, unansweredCount: 0n },
    ])
    prismaMock.chatMessage.findMany.mockResolvedValue([
      { id: 'm1', direction: 'inbound', type: 'text', body: 'oi', createdAt: new Date('2026-09-20T10:00:00Z'), timestamp: null },
    ])
    const order = (id: string, createdAt: string, normalizedPhone: string, customerPhone: string | null) => ({
      id, nuvemshopOrderId: `n-${id}`, orderNumber: id, status: 'open', paymentStatus: 'paid', total: '10.00',
      orderUrl: null, createdAt: new Date(createdAt), normalizedPhone, customerPhone,
    })
    // desc by createdAt, as requested from the database
    prismaMock.order.findMany.mockResolvedValue([
      order('o3', '2026-09-25T00:00:00Z', '5500000000000', '5583922222222'),
      order('o2', '2026-09-24T00:00:00Z', '5583911111111', null),
      order('o1', '2026-09-01T00:00:00Z', '5583911111111', null),
    ])

    const [first, second] = await inboxService.listConversations()

    expect(first.unansweredCount).toBe(3)
    expect(first.lastMessage).toMatchObject({ id: 'm1', body: 'oi' })
    expect(first.lastOrder).toEqual(expect.objectContaining({ id: 'o2' }))
    expect(first.lastOrder).not.toHaveProperty('normalizedPhone')
    expect(second.unansweredCount).toBe(0)
    expect(second.lastMessage).toBeNull()
    expect(second.lastOrder).toEqual(expect.objectContaining({ id: 'o3' }))
  })

  it('returns empty without extra queries when there are no conversations', async () => {
    prismaMock.conversation.findMany.mockResolvedValue([])
    expect(await inboxService.listConversations()).toEqual([])
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
  })
})
