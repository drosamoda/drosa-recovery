import { prisma } from '../config/prisma'
import { classifyWhatsappConsent } from './whatsappConsentService'
import { extractMetaStatusTimestamp, maskEmail, maskPhone, normalizeFailure, parsePage, parsePageSize } from './crmReadService'

// This first read model uses existing tables only. It never reads rawPayload or writes data.
async function loadFacts() {
  const [customers, contacts, orders, checkouts, logs, conversations, chats, consents, suppressions] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, name: true, email: true, normalizedPhone: true, optOut: true } }),
    prisma.contact.findMany({ select: { id: true, name: true, phone: true } }),
    prisma.order.findMany({ select: { id: true, normalizedPhone: true, orderNumber: true, customerName: true, customerEmail: true, paymentStatus: true, status: true, sourceCreatedAt: true, sourceUpdatedAt: true, total: true, source: true } }),
    prisma.abandonedCheckout.findMany({ select: { id: true, normalizedPhone: true, nuvemshopCheckoutId: true, customerName: true, customerEmail: true, productsSummary: true, status: true, sourceCreatedAt: true, abandonedAt: true, convertedAt: true, total: true, source: true } }),
    prisma.messageLog.findMany({ select: { id: true, normalizedPhone: true, entityType: true, entityId: true, templateName: true, status: true, scheduledAt: true, acceptedAt: true, sentAt: true, response: true, metaMessageId: true, reason: true, errorCode: true, renderedPreview: true, source: true } }),
    prisma.conversation.findMany({ select: { id: true, status: true, lastInboundAt: true, lastMessageAt: true, contact: { select: { phone: true } } } }),
    prisma.chatMessage.findMany({ select: { id: true, waMessageId: true, direction: true, type: true, body: true, status: true, timestamp: true, createdAt: true, conversation: { select: { contact: { select: { phone: true } } } } } }),
    prisma.whatsappConsent.findMany({ select: { normalizedPhone: true, scope: true, consented: true, consentedAt: true, revokedAt: true, source: true } }),
    prisma.suppression.findMany({ select: { normalizedPhone: true, reason: true, source: true, suppressedAt: true } }),
  ])
  return { customers, contacts, orders, checkouts, logs, conversations, chats, consents, suppressions }
}

type Facts = Awaited<ReturnType<typeof loadFacts>>
type JourneyEvent = { type: string; at: Date | null; source: string; reference: string | null; status: string | null; template?: string | null; related?: string | null; ingestedAt?: Date | null }
type JourneyMessage = { id: string; direction: 'inbound' | 'outbound'; template: string | null; body: string | null; status: string; at: Date | null; failureCategory: string | null; reference: string | null; metaMessageId: string | null; flow: string }
type JourneyRow = { id: string; name: string; phone: string | null; email: string | null; lastAction: string | null; lastActionAt: Date | null; actionSource: string | null; related: string | null; lastMessage: JourneyMessage | null; lastInboundAt: Date | null; consent: 'GRANTED' | 'REVOKED' | 'UNKNOWN'; optOut: boolean; suppressed: boolean; messageCount: number; orderCount: number; checkoutCount: number; flow: string | null; responded: boolean; search: string; timeline: JourneyEvent[]; messages: JourneyMessage[] }

const phoneKey = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '')
const happened = (at: Date | null | undefined) => at instanceof Date && Number.isFinite(at.getTime()) ? at : null
const latest = <T extends { at: Date | null }>(rows: T[]) => rows.filter(row => row.at).sort((a, b) => b.at!.getTime() - a.at!.getTime())[0] ?? null
const event = (type: string, at: Date | null | undefined, source: string, reference: string | null, status: string | null = null, related: string | null = null, template: string | null = null): JourneyEvent => ({ type, at: happened(at), source, reference, status, related, template })
const messageFlow = (entityType: string, template: string) => {
  const name = template.toLowerCase()
  if (entityType === 'abandoned_checkout' || /carrinho|checkout/.test(name)) return 'carrinho'
  if (/pix/.test(name)) return 'pix'
  if (/boleto/.test(name)) return 'boleto'
  if (/remarketing|recompra|inativo|vip/.test(name)) return 'remarketing'
  return 'outros'
}

function makeRows(facts: Facts): JourneyRow[] {
  const phones = new Map<string, JourneyRow>()
  const ensure = (raw: string, reference: string, name?: string | null, email?: string | null) => {
    const phone = phoneKey(raw)
    if (!phone) return null
    let row = phones.get(phone)
    if (!row) {
      row = { id: reference, name: name || 'Contato identificado', phone: maskPhone(phone), email: maskEmail(email), lastAction: null, lastActionAt: null, actionSource: null, related: null, lastMessage: null, lastInboundAt: null, consent: 'UNKNOWN', optOut: false, suppressed: false, messageCount: 0, orderCount: 0, checkoutCount: 0, flow: null, responded: false, search: phone, timeline: [], messages: [] }
      phones.set(phone, row)
    }
    if (name && row.name === 'Contato identificado') row.name = name
    if (email && !row.email) row.email = maskEmail(email)
    row.search += ` ${name ?? ''} ${email ?? ''} ${reference}`
    return row
  }

  for (const c of facts.customers) { const row = ensure(c.normalizedPhone, `customer:${c.id}`, c.name, c.email); if (row) { row.id = `customer:${c.id}`; row.optOut ||= c.optOut; if (c.optOut) row.timeline.push(event('OPT_OUT', null, 'customers', c.id, 'ACTIVE')) } }
  for (const c of facts.contacts) ensure(c.phone, `contact:${c.id}`, c.name)
  for (const o of facts.orders) {
    const row = ensure(o.normalizedPhone, `order:${o.id}`, o.customerName, o.customerEmail); if (!row) continue
    row.orderCount++; row.search += ` ${o.orderNumber}`
    row.timeline.push(event('ORDER_CREATED', o.sourceCreatedAt, o.source || 'nuvemshop', o.orderNumber, o.status, o.orderNumber))
    if (['paid', 'confirmed', 'authorized'].includes(o.paymentStatus.toLowerCase())) row.timeline.push(event('ORDER_PAID', null, o.source || 'nuvemshop', o.orderNumber, o.paymentStatus, o.orderNumber))
  }
  for (const c of facts.checkouts) {
    const row = ensure(c.normalizedPhone, `checkout:${c.id}`, c.customerName, c.customerEmail); if (!row) continue
    row.checkoutCount++; row.search += ` ${c.nuvemshopCheckoutId}`
    row.timeline.push(event('CHECKOUT', c.sourceCreatedAt, c.source || 'nuvemshop', c.nuvemshopCheckoutId, c.status, c.productsSummary))
    if (c.abandonedAt) row.timeline.push(event('CHECKOUT_ABANDONED', c.abandonedAt, c.source || 'nuvemshop', c.nuvemshopCheckoutId, c.status, c.productsSummary))
    if (c.convertedAt) row.timeline.push(event('CHECKOUT_CONVERTED', c.convertedAt, c.source || 'nuvemshop', c.nuvemshopCheckoutId, c.status, c.productsSummary))
  }
  const loggedIds = new Set<string>()
  for (const m of facts.logs) {
    const row = ensure(m.normalizedPhone, `message:${m.id}`); if (!row) continue
    if (m.metaMessageId) loggedIds.add(m.metaMessageId)
    const deliveredAt = extractMetaStatusTimestamp(m.response, 'delivered')
    const readAt = extractMetaStatusTimestamp(m.response, 'read')
    const at = readAt || deliveredAt || m.sentAt || m.acceptedAt || m.scheduledAt
    row.messages.push({ id: `log:${m.id}`, direction: 'outbound', template: m.templateName, body: m.renderedPreview, status: m.status, at, failureCategory: normalizeFailure(m.reason, m.errorCode, m.status), reference: m.entityId, metaMessageId: m.metaMessageId, flow: messageFlow(m.entityType, m.templateName) })
    row.search += ` ${m.id} ${m.metaMessageId ?? ''} ${m.entityId}`
    row.timeline.push(event('WHATSAPP_SCHEDULED', m.scheduledAt, m.source || 'message_logs', m.id, m.status, m.entityId, m.templateName))
    if (m.acceptedAt) row.timeline.push(event('WHATSAPP_ACCEPTED', m.acceptedAt, m.source || 'message_logs', m.id, m.status, m.entityId, m.templateName))
    if (m.sentAt) row.timeline.push(event('WHATSAPP_SENT', m.sentAt, m.source || 'message_logs', m.id, m.status, m.entityId, m.templateName))
    if (deliveredAt) row.timeline.push(event('WHATSAPP_DELIVERED', deliveredAt, 'meta', m.metaMessageId || m.id, m.status, m.entityId, m.templateName))
    if (readAt) row.timeline.push(event('WHATSAPP_READ', readAt, 'meta', m.metaMessageId || m.id, m.status, m.entityId, m.templateName))
    if (m.status === 'failed') row.timeline.push(event('WHATSAPP_FAILED', null, m.source || 'message_logs', m.id, m.status, m.entityId, m.templateName))
  }
  for (const c of facts.conversations) ensure(c.contact.phone, `conversation:${c.id}`)
  for (const m of facts.chats) {
    const row = ensure(m.conversation.contact.phone, `chat:${m.id}`); if (!row) continue
    if (m.direction === 'outbound' && m.waMessageId && loggedIds.has(m.waMessageId)) continue
    const at = happened(m.timestamp)
    row.messages.push({ id: `chat:${m.id}`, direction: m.direction, template: null, body: m.body, status: m.status || 'unknown', at, failureCategory: null, reference: m.id, metaMessageId: m.waMessageId, flow: 'outros' })
    row.search += ` ${m.id} ${m.waMessageId ?? ''}`
    if (m.direction === 'inbound') row.timeline.push({ ...event('WHATSAPP_INBOUND', at, 'chat_messages', m.waMessageId || m.id, m.status), ingestedAt: m.createdAt })
    else row.timeline.push({ ...event('WHATSAPP_SENT', at, 'chat_messages', m.waMessageId || m.id, m.status), ingestedAt: m.createdAt })
  }
  for (const c of facts.consents) {
    const row = ensure(c.normalizedPhone, `consent:${c.normalizedPhone}`); if (!row) continue
    if (c.scope === 'marketing') row.consent = classifyWhatsappConsent(c)
    if (c.consentedAt) row.timeline.push(event('CONSENT_GRANTED', c.consentedAt, 'whatsapp_consents', c.scope, c.consented ? 'GRANTED' : 'REVOKED'))
    if (c.revokedAt) row.timeline.push(event('CONSENT_REVOKED', c.revokedAt, 'whatsapp_consents', c.scope, 'REVOKED'))
  }
  for (const s of facts.suppressions) { const row = ensure(s.normalizedPhone, `suppression:${s.normalizedPhone}`); if (row) { row.suppressed = true; row.timeline.push(event('SUPPRESSION', s.suppressedAt, s.source, s.reason, 'ACTIVE')) } }

  return [...phones.values()].map(row => {
    row.timeline.sort((a, b) => (a.at === null ? 1 : b.at === null ? -1 : a.at.getTime() - b.at.getTime()))
    row.messages.sort((a, b) => (a.at === null ? 1 : b.at === null ? -1 : a.at.getTime() - b.at.getTime()))
    const action = latest(row.timeline.filter(item => ['ORDER_CREATED', 'CHECKOUT', 'CHECKOUT_ABANDONED', 'CHECKOUT_CONVERTED', 'WHATSAPP_SCHEDULED', 'WHATSAPP_ACCEPTED', 'WHATSAPP_SENT', 'WHATSAPP_DELIVERED', 'WHATSAPP_READ', 'WHATSAPP_INBOUND'].includes(item.type)))
    const lastMessage = latest(row.messages.filter(item => item.direction === 'outbound'))
    row.lastAction = action?.type ?? null; row.lastActionAt = action?.at ?? null; row.actionSource = action?.source ?? null; row.related = action?.related ?? null
    row.lastMessage = lastMessage; row.lastInboundAt = latest(row.timeline.filter(item => item.type === 'WHATSAPP_INBOUND'))?.at ?? null
    row.responded = row.messages.some(item => item.direction === 'inbound'); row.messageCount = row.messages.length
    row.flow = lastMessage?.flow ?? null
    row.search = `${row.search} ${row.name}`.toLowerCase()
    return row
  })
}

function periodStart(query: Record<string, unknown>, now: Date): Date | null {
  const period = String(query.period || 'all')
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === '7d') return new Date(now.getTime() - 7 * 86400000)
  if (period === '30d') return new Date(now.getTime() - 30 * 86400000)
  if (period === 'custom' && typeof query.from === 'string') { const d = new Date(query.from); return Number.isFinite(d.getTime()) ? d : null }
  return null
}

function filterRows(rows: JourneyRow[], query: Record<string, unknown>, now: Date) {
  const search = String(query.search ?? '').trim().toLowerCase()
  const since = periodStart(query, now)
  const until = query.period === 'custom' && typeof query.to === 'string' ? new Date(query.to) : null
  return rows.filter(row => {
    if (search && !row.search.includes(search)) return false
    if (query.consent && row.consent !== query.consent) return false
    if (query.responded === 'yes' && !row.responded || query.responded === 'no' && row.responded) return false
    if (query.message === 'none' && row.lastMessage || query.message === 'failed' && row.lastMessage?.status !== 'failed') return false
    if (['sent', 'delivered', 'read'].includes(String(query.message)) && row.lastMessage?.status !== query.message) return false
    if (query.action && !row.lastAction?.startsWith(String(query.action).toUpperCase())) return false
    if (query.flow && row.flow !== query.flow) return false
    if (since && (!row.lastActionAt || row.lastActionAt < since)) return false
    if (until && Number.isFinite(until.getTime()) && row.lastActionAt && row.lastActionAt > until) return false
    return true
  })
}

export const crmJourneyService = {
  async list(query: Record<string, unknown>) {
    const facts = await loadFacts(), now = new Date(), rows = makeRows(facts)
    const filtered = filterRows(rows, query, now).sort((a, b) => (b.lastActionAt?.getTime() ?? 0) - (a.lastActionAt?.getTime() ?? 0))
    const page = parsePage(query.page), pageSize = parsePageSize(query.pageSize)
    const data = filtered.slice((page - 1) * pageSize, page * pageSize).map(({ search, timeline, messages, ...row }) => { void search; void timeline; void messages; return row })
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const kpis = { activeToday: rows.filter(row => row.lastActionAt && row.lastActionAt >= today).length, abandonedCheckouts: facts.checkouts.filter(c => c.abandonedAt && c.abandonedAt >= today).length, orders: facts.orders.filter(o => o.sourceCreatedAt && o.sourceCreatedAt >= today).length, contactedCustomers: rows.filter(row => row.messages.some(m => m.direction === 'outbound')).length, delivered: facts.logs.filter(m => m.status === 'delivered').length, read: facts.logs.filter(m => m.status === 'read').length, failed: facts.logs.filter(m => m.status === 'failed').length, responses: facts.chats.filter(m => m.direction === 'inbound' && m.timestamp && m.timestamp >= today).length }
    return { data, kpis, pagination: { page, pageSize, total: filtered.length, pages: Math.ceil(filtered.length / pageSize) }, coverage: { identified: rows.length, source: 'existing_tables', siteBehavior: 'NOT_AVAILABLE' } }
  },
  async detail(id: string) {
    const rows = makeRows(await loadFacts())
    const row = rows.find(item => item.id === id)
    if (!row) return null
    const { search, ...publicRow } = row
    void search
    return publicRow
  },
}
