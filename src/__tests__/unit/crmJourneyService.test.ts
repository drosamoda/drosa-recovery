import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({ prisma: {
  customer: { findMany: vi.fn(), count: vi.fn() }, contact: { findMany: vi.fn(), count: vi.fn() },
  order: { findMany: vi.fn(), count: vi.fn() }, abandonedCheckout: { findMany: vi.fn(), count: vi.fn() },
  messageLog: { findMany: vi.fn(), count: vi.fn() }, conversation: { findMany: vi.fn(), count: vi.fn() },
  chatMessage: { findMany: vi.fn(), count: vi.fn() }, whatsappConsent: { findMany: vi.fn() },
  suppression: { findMany: vi.fn() },
} }))

import { prisma } from '../../config/prisma'
import { crmJourneyService } from '../../services/crmJourneyService'

const phone = '5531999990000'
const at = (value: string) => new Date(value)

describe('CRM customer journey read model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    expect((await crmJourneyService.list({ search: '   ' })).pagination.total).toBe(2)
    expect(vi.mocked(prisma.customer.findMany).mock.calls[0][0]).not.toHaveProperty('where')
    expect(vi.mocked(prisma.order.findMany).mock.calls[0][0]).not.toHaveProperty('where')
  })
})
