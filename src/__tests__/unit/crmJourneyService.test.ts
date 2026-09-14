import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({ prisma: {
  $queryRaw: vi.fn(),
  customer: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() }, contact: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  order: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() }, abandonedCheckout: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  messageLog: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() }, conversation: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  chatMessage: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() }, whatsappConsent: { findMany: vi.fn() },
  suppression: { findMany: vi.fn() },
} }))

import { prisma } from '../../config/prisma'
import { crmJourneyService } from '../../services/crmJourneyService'

const phone = '5531999990000'
const at = (value: string) => new Date(value)

describe('CRM customer journey read model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ phone, total: BigInt(1) }] as never)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ normalizedPhone: phone } as never)
    vi.mocked(prisma.contact.findUnique).mockResolvedValue({ phone } as never)
    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue({ normalizedPhone: phone } as never)
    for (const model of ['customer', 'contact', 'order', 'abandonedCheckout', 'messageLog', 'conversation', 'chatMessage', 'whatsappConsent', 'suppression'] as const) {
      vi.mocked(prisma[model].findMany).mockResolvedValue([] as never)
    }
  })

  it('joins a customer and contact by phone and keeps a single outbound message', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([{ id: 'customer-1', name: 'Maria', email: 'maria@example.com', normalizedPhone: phone, optOut: false }] as never)
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: 'contact-1', name: 'Maria', phone }] as never)
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([{ id: 'log-1', normalizedPhone: phone, entityType: 'order', entityId: 'order-1', templateName: 'pedido', status: 'delivered', scheduledAt: at('2026-09-01T10:00:00Z'), acceptedAt: at('2026-09-01T10:01:00Z'), sentAt: at('2026-09-01T10:02:00Z'), response: { status: 'delivered', timestamp: '1788257040' }, metaMessageId: 'wamid-1', reason: null, errorCode: null, renderedPreview: 'Olá', source: 'meta' }] as never)
    vi.mocked(prisma.conversation.findMany).mockResolvedValue([{ id: 'conversation-1', contact: { phone }, status: 'open', lastInboundAt: null, lastMessageAt: at('2026-09-01T10:04:00Z') }] as never)
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([{ id: 'chat-1', waMessageId: 'wamid-1', conversation: { contact: { phone } }, direction: 'outbound', type: 'text', body: 'Olá', status: 'delivered', timestamp: at('2026-09-01T10:02:00Z'), createdAt: at('2026-09-01T10:03:00Z') }] as never)

    const list = await crmJourneyService.list({})
    expect(list.data).toHaveLength(1)
    expect(list.data[0]).toMatchObject({ name: 'Maria', consent: 'UNKNOWN', messageCount: 1, lastMessage: { template: 'pedido', status: 'delivered' } })
    expect(list.data[0].phone).toContain('*')
    expect(list.data[0].email).toContain('*')
    const detail = await crmJourneyService.detail(list.data[0].id)
    expect(detail?.messages).toHaveLength(1)
    expect(detail?.timeline.map(event => event.type)).toContain('WHATSAPP_DELIVERED')
  })

  it('uses provider time for inbound and never promotes technical ingestion to business time', async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: 'contact-1', name: 'Pessoa', phone }] as never)
    vi.mocked(prisma.chatMessage.findMany).mockResolvedValue([{ id: 'chat-1', waMessageId: 'in-1', conversation: { contact: { phone } }, direction: 'inbound', type: 'text', body: 'Oi', status: 'received', timestamp: at('2017-01-01T12:00:00Z'), createdAt: at('2026-09-10T12:00:00Z') }] as never)
    const list = await crmJourneyService.list({})
    expect(list.data[0].lastActionAt).toEqual(at('2017-01-01T12:00:00Z'))
    const detail = await crmJourneyService.detail(list.data[0].id)
    expect(detail?.timeline[0]).toMatchObject({ type: 'WHATSAPP_INBOUND', at: at('2017-01-01T12:00:00Z'), ingestedAt: at('2026-09-10T12:00:00Z') })
  })

  it('keeps unknown consent inactive and never infers paid or failed timestamps', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([{ id: 'customer-1', name: 'Maria', email: null, normalizedPhone: phone, optOut: false }] as never)
    vi.mocked(prisma.whatsappConsent.findMany).mockResolvedValue([{ normalizedPhone: phone, scope: 'marketing', consented: true, consentedAt: null, revokedAt: null, source: 'legacy' }] as never)
    vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: 'order-1', normalizedPhone: phone, orderNumber: '123', customerName: 'Maria', customerEmail: null, paymentStatus: 'paid', status: 'open', sourceCreatedAt: null, sourceUpdatedAt: at('2026-09-10T12:00:00Z'), total: 50, source: 'nuvemshop' }] as never)
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([{ id: 'log-1', normalizedPhone: phone, entityType: 'order', entityId: 'order-1', templateName: 'pedido', status: 'failed', scheduledAt: at('2026-09-10T11:00:00Z'), acceptedAt: null, sentAt: null, response: null, metaMessageId: null, reason: 'provider rejected', errorCode: '131000', renderedPreview: null, source: 'meta' }] as never)
    const list = await crmJourneyService.list({})
    expect(list.data[0]).toMatchObject({ consent: 'UNKNOWN', lastMessage: { status: 'failed', failureCategory: 'PROVIDER_REJECTION' } })
    const detail = await crmJourneyService.detail(list.data[0].id)
    expect(detail?.timeline.find(event => event.type === 'ORDER_PAID')?.at).toBeNull()
    expect(detail?.timeline.find(event => event.type === 'WHATSAPP_FAILED')?.at).toBeNull()
  })

  it('filters identified customers without an empty contains query or additional per-row reads', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      { id: 'one', name: 'Ana', email: 'ana@example.com', normalizedPhone: phone, optOut: false },
      { id: 'two', name: 'Bia', email: 'bia@example.com', normalizedPhone: '5531888880000', optOut: false },
    ] as never)
    vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: 'order-one', normalizedPhone: phone, orderNumber: 'ORDER-123', customerName: 'Ana', customerEmail: 'ana@example.com', paymentStatus: 'pending', status: 'open', sourceCreatedAt: at('2026-09-10T12:00:00Z'), sourceUpdatedAt: null, total: 50, source: 'nuvemshop' }] as never)
    vi.mocked(prisma.whatsappConsent.findMany).mockResolvedValue([{ normalizedPhone: phone, scope: 'marketing', consented: true, consentedAt: at('2026-09-09T12:00:00Z'), revokedAt: null, source: 'manual' }] as never)
    expect((await crmJourneyService.list({ search: 'ORDER-123', consent: 'GRANTED', action: 'ORDER' })).data).toHaveLength(1)
    expect((await crmJourneyService.list({ search: '   ' })).pagination.total).toBe(1)
    expect(vi.mocked(prisma.customer.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: [phone] } } })
    expect(vi.mocked(prisma.order.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: [phone] } } })
  })

  it('chooses the last outbound by origin time, even if an older message was read later', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      { id: 'older', normalizedPhone: phone, entityType: 'order', entityId: 'one', templateName: 'A', status: 'read', scheduledAt: at('2026-09-01T09:00:00Z'), acceptedAt: null, sentAt: at('2026-09-01T10:00:00Z'), response: { status: 'read', timestamp: String(at('2026-09-01T12:00:00Z').getTime() / 1000) }, metaMessageId: 'wa-a', reason: null, errorCode: null, renderedPreview: null, source: 'meta' },
      { id: 'newer', normalizedPhone: phone, entityType: 'order', entityId: 'two', templateName: 'B', status: 'sent', scheduledAt: at('2026-09-01T10:30:00Z'), acceptedAt: null, sentAt: at('2026-09-01T11:00:00Z'), response: null, metaMessageId: 'wa-b', reason: null, errorCode: null, renderedPreview: null, source: 'meta' },
    ] as never)
    const result = await crmJourneyService.list({})
    expect(result.data[0].lastMessage).toMatchObject({ template: 'B', messageAt: at('2026-09-01T11:00:00Z') })
    const detail = await crmJourneyService.detail(result.data[0].id)
    expect(detail?.messages.find(m => m.template === 'A')?.statusAt).toEqual(at('2026-09-01T12:00:00Z'))
  })

  it('retains origin timestamps for scheduled, accepted and failed messages', async () => {
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      { id: 'scheduled', normalizedPhone: phone, entityType: 'order', entityId: 'one', templateName: 'S', status: 'pending', scheduledAt: at('2026-09-01T09:00:00Z'), acceptedAt: null, sentAt: null, response: null, metaMessageId: null, reason: null, errorCode: null, renderedPreview: null, source: 'meta' },
      { id: 'accepted', normalizedPhone: phone, entityType: 'order', entityId: 'two', templateName: 'A', status: 'accepted', scheduledAt: at('2026-09-01T10:00:00Z'), acceptedAt: at('2026-09-01T10:01:00Z'), sentAt: null, response: null, metaMessageId: null, reason: null, errorCode: null, renderedPreview: null, source: 'meta' },
      { id: 'failed', normalizedPhone: phone, entityType: 'order', entityId: 'three', templateName: 'F', status: 'failed', scheduledAt: at('2026-09-01T11:00:00Z'), acceptedAt: null, sentAt: null, response: null, metaMessageId: null, reason: 'provider rejected', errorCode: null, renderedPreview: null, source: 'meta' },
    ] as never)
    const list = await crmJourneyService.list({})
    const messages = (await crmJourneyService.detail(list.data[0].id))!.messages
    expect(messages.map(m => [m.template, m.messageAt?.toISOString(), m.statusAt?.toISOString()])).toEqual([
      ['S', '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z'],
      ['A', '2026-09-01T10:01:00.000Z', '2026-09-01T10:01:00.000Z'],
      ['F', '2026-09-01T11:00:00.000Z', '2026-09-01T11:00:00.000Z'],
    ])
  })

  it.each([25, 50, 100])('loads only the selected %i-phone page with fixed batch query count', async pageSize => {
    const phones = Array.from({ length: pageSize }, (_, i) => `5531${String(i).padStart(9, '0')}`)
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce(phones.map(p => ({ phone: p, total: BigInt(50000) })) as never)
    vi.mocked(prisma.customer.findMany).mockResolvedValue(phones.map((p, i) => ({ id: `c${i}`, name: `Cliente ${i}`, email: null, normalizedPhone: p, optOut: false })) as never)
    const result = await crmJourneyService.list({ pageSize })
    expect(result.data).toHaveLength(pageSize)
    expect(result.pagination.total).toBe(50000)
    expect(vi.mocked(prisma.customer.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: phones } } })
    expect(vi.mocked(prisma.messageLog.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: phones } } })
    expect(vi.mocked(prisma.contact.findMany).mock.calls[0][0]).toMatchObject({ where: { phone: { in: phones } } })
    expect(vi.mocked(prisma.order.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: phones } } })
    expect(vi.mocked(prisma.abandonedCheckout.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: phones } } })
    expect(vi.mocked(prisma.whatsappConsent.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: phones } } })
    expect(vi.mocked(prisma.suppression.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: phones } } })
    expect(vi.mocked(prisma.customer.findMany)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.messageLog.findMany)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(2)
  })

  it('resolves one detail ID and reads only records linked to that phone', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([{ id: 'one', name: 'Ana', email: null, normalizedPhone: phone, optOut: false }] as never)
    const detail = await crmJourneyService.detail('customer:one')
    expect(detail?.name).toBe('Ana')
    expect(vi.mocked(prisma.customer.findUnique)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.$queryRaw)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.customer.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: [phone] } } })
    expect(vi.mocked(prisma.messageLog.findMany).mock.calls[0][0]).toMatchObject({ where: { normalizedPhone: { in: [phone] } } })
    expect(vi.mocked(prisma.chatMessage.findMany).mock.calls[0][0]).toMatchObject({ where: { conversation: { contact: { phone: { in: [phone] } } } } })
  })

  it('includes all of the custom end date and excludes the next day', async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([{ id: 'one', name: 'Ana', email: null, normalizedPhone: phone, optOut: false }] as never)
    for (const time of ['00:00:00', '12:00:00', '23:59:59']) {
      vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: time, normalizedPhone: phone, orderNumber: time, customerName: 'Ana', customerEmail: null, paymentStatus: 'pending', status: 'open', sourceCreatedAt: at(`2026-09-10T${time}Z`), sourceUpdatedAt: null, total: 1, source: 'nuvemshop' }] as never)
      expect((await crmJourneyService.list({ period: 'custom', from: '2026-09-01', to: '2026-09-10' })).data).toHaveLength(1)
    }
    vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: 'next', normalizedPhone: phone, orderNumber: 'next', customerName: 'Ana', customerEmail: null, paymentStatus: 'pending', status: 'open', sourceCreatedAt: at('2026-09-11T00:00:00Z'), sourceUpdatedAt: null, total: 1, source: 'nuvemshop' }] as never)
    expect((await crmJourneyService.list({ period: 'custom', from: '2026-09-01', to: '2026-09-10' })).data).toHaveLength(0)
  })
})
