import { prisma } from '../config/prisma'
import { Prisma } from '@prisma/client'
import { classifyWhatsappConsent } from './whatsappConsentService'
import { extractMetaStatusTimestamp, maskEmail, maskPhone, normalizeFailure, parsePage, parsePageSize } from './crmReadService'

// This first read model uses existing tables only. It never reads rawPayload or writes data.
async function loadFacts(phones: string[]) {
  const [customers, contacts, orders, checkouts, logs, conversations, chats, consents, suppressions] = await Promise.all([
    prisma.customer.findMany({ where: { normalizedPhone: { in: phones } }, select: { id: true, name: true, email: true, normalizedPhone: true, optOut: true } }),
    prisma.contact.findMany({ where: { phone: { in: phones } }, select: { id: true, name: true, phone: true } }),
    prisma.order.findMany({ where: { normalizedPhone: { in: phones } }, select: { id: true, normalizedPhone: true, orderNumber: true, customerName: true, customerEmail: true, paymentStatus: true, status: true, sourceCreatedAt: true, sourceUpdatedAt: true, total: true, source: true } }),
    prisma.abandonedCheckout.findMany({ where: { normalizedPhone: { in: phones } }, select: { id: true, normalizedPhone: true, nuvemshopCheckoutId: true, customerName: true, customerEmail: true, productsSummary: true, status: true, sourceCreatedAt: true, abandonedAt: true, convertedAt: true, total: true, source: true } }),
    prisma.messageLog.findMany({ where: { normalizedPhone: { in: phones } }, select: { id: true, normalizedPhone: true, entityType: true, entityId: true, templateName: true, status: true, scheduledAt: true, acceptedAt: true, sentAt: true, response: true, metaMessageId: true, reason: true, errorCode: true, renderedPreview: true, source: true } }),
    prisma.conversation.findMany({ where: { contact: { phone: { in: phones } } }, select: { id: true, status: true, lastInboundAt: true, lastMessageAt: true, contact: { select: { phone: true } } } }),
    prisma.chatMessage.findMany({ where: { conversation: { contact: { phone: { in: phones } } } }, select: { id: true, waMessageId: true, direction: true, type: true, body: true, status: true, timestamp: true, createdAt: true, conversation: { select: { contact: { select: { phone: true } } } } } }),
    prisma.whatsappConsent.findMany({ where: { normalizedPhone: { in: phones } }, select: { normalizedPhone: true, scope: true, consented: true, consentedAt: true, revokedAt: true, source: true } }),
    prisma.suppression.findMany({ where: { normalizedPhone: { in: phones } }, select: { normalizedPhone: true, reason: true, source: true, suppressedAt: true } }),
  ])
  return { customers, contacts, orders, checkouts, logs, conversations, chats, consents, suppressions }
}

type Facts = Awaited<ReturnType<typeof loadFacts>>
type JourneyEvent = { type: string; at: Date | null; source: string; reference: string | null; status: string | null; template?: string | null; related?: string | null; ingestedAt?: Date | null }
type JourneyMessage = { id: string; direction: 'inbound' | 'outbound'; template: string | null; body: string | null; status: string; messageAt: Date | null; statusAt: Date | null; failureCategory: string | null; reference: string | null; metaMessageId: string | null; flow: string }
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
    const messageAt = happened(m.sentAt || m.acceptedAt || m.scheduledAt)
    const statusAt = happened(readAt || deliveredAt || m.sentAt || m.acceptedAt || m.scheduledAt)
    row.messages.push({ id: `log:${m.id}`, direction: 'outbound', template: m.templateName, body: m.renderedPreview, status: m.status, messageAt, statusAt, failureCategory: normalizeFailure(m.reason, m.errorCode, m.status), reference: m.entityId, metaMessageId: m.metaMessageId, flow: messageFlow(m.entityType, m.templateName) })
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
    row.messages.push({ id: `chat:${m.id}`, direction: m.direction, template: null, body: m.body, status: m.status || 'unknown', messageAt: at, statusAt: at, failureCategory: null, reference: m.id, metaMessageId: m.waMessageId, flow: 'outros' })
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
    row.messages.sort((a, b) => (a.messageAt === null ? 1 : b.messageAt === null ? -1 : a.messageAt.getTime() - b.messageAt.getTime()))
    const action = latest(row.timeline.filter(item => ['ORDER_CREATED', 'CHECKOUT', 'CHECKOUT_ABANDONED', 'CHECKOUT_CONVERTED', 'WHATSAPP_SCHEDULED', 'WHATSAPP_ACCEPTED', 'WHATSAPP_SENT', 'WHATSAPP_DELIVERED', 'WHATSAPP_READ', 'WHATSAPP_INBOUND'].includes(item.type)))
    const lastMessage = [...row.messages].filter(item => item.direction === 'outbound' && item.messageAt).sort((a, b) => b.messageAt!.getTime() - a.messageAt!.getTime())[0] ?? null
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

function periodEnd(query: Record<string, unknown>): Date | null {
  if (query.period !== 'custom' || typeof query.to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(query.to)) return null
  const next = new Date(`${query.to}T00:00:00.000Z`)
  if (!Number.isFinite(next.getTime())) return null
  next.setUTCDate(next.getUTCDate() + 1)
  return next
}

function filterRows(rows: JourneyRow[], query: Record<string, unknown>, now: Date) {
  const search = String(query.search ?? '').trim().toLowerCase()
  const since = periodStart(query, now)
  const until = periodEnd(query)
  return rows.filter(row => {
    if (search && !row.search.includes(search)) return false
    if (query.consent && row.consent !== query.consent) return false
    if (query.responded === 'yes' && !row.responded || query.responded === 'no' && row.responded) return false
    if (query.message === 'none' && row.lastMessage || query.message === 'failed' && row.lastMessage?.status !== 'failed') return false
    if (['sent', 'delivered', 'read'].includes(String(query.message)) && row.lastMessage?.status !== query.message) return false
    if (query.action && !row.lastAction?.startsWith(String(query.action).toUpperCase())) return false
    if (query.flow && row.flow !== query.flow) return false
    if (since && (!row.lastActionAt || row.lastActionAt < since)) return false
    if (until && (!row.lastActionAt || row.lastActionAt >= until)) return false
    return true
  })
}

const phoneSources = Prisma.sql`
  SELECT "normalizedPhone" AS phone FROM customers
  UNION SELECT phone FROM contacts
  UNION SELECT "normalizedPhone" FROM orders
  UNION SELECT "normalizedPhone" FROM abandoned_checkouts
  UNION SELECT "normalizedPhone" FROM message_logs
  UNION SELECT "normalizedPhone" FROM whatsapp_consents
  UNION SELECT "normalizedPhone" FROM suppressions`

async function selectPhonePage(query: Record<string, unknown>, now: Date, page: number, pageSize: number) {
  const conditions: Prisma.Sql[] = [Prisma.sql`p.phone ~ '[0-9]'`]
  const search = String(query.search ?? '').trim()
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    conditions.push(Prisma.sql`(
      p.phone ILIKE ${pattern} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM customers c WHERE c."normalizedPhone" = p.phone AND (c.name ILIKE ${pattern} ESCAPE '\\' OR c.email ILIKE ${pattern} ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM contacts c WHERE c.phone = p.phone AND c.name ILIKE ${pattern} ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM orders o WHERE o."normalizedPhone" = p.phone AND (o."orderNumber" ILIKE ${pattern} ESCAPE '\\' OR o."customerName" ILIKE ${pattern} ESCAPE '\\' OR o."customerEmail" ILIKE ${pattern} ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM abandoned_checkouts c WHERE c."normalizedPhone" = p.phone AND (c."nuvemshopCheckoutId" ILIKE ${pattern} ESCAPE '\\' OR c."customerName" ILIKE ${pattern} ESCAPE '\\' OR c."customerEmail" ILIKE ${pattern} ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM message_logs m WHERE m."normalizedPhone" = p.phone AND (m.id ILIKE ${pattern} ESCAPE '\\' OR m."metaMessageId" ILIKE ${pattern} ESCAPE '\\' OR m."entityId" ILIKE ${pattern} ESCAPE '\\'))
    )`)
  }
  const consent = String(query.consent || '')
  const granted = Prisma.sql`EXISTS (SELECT 1 FROM whatsapp_consents c WHERE c."normalizedPhone" = p.phone AND c.scope = 'marketing' AND c.consented = true AND c."consentedAt" IS NOT NULL AND c."revokedAt" IS NULL)`
  const revoked = Prisma.sql`EXISTS (SELECT 1 FROM whatsapp_consents c WHERE c."normalizedPhone" = p.phone AND c.scope = 'marketing' AND (c."revokedAt" IS NOT NULL OR c.consented = false))`
  if (consent === 'GRANTED') conditions.push(granted)
  if (consent === 'REVOKED') conditions.push(revoked)
  if (consent === 'UNKNOWN') conditions.push(Prisma.sql`NOT (${granted}) AND NOT (${revoked})`)
  const responded = Prisma.sql`EXISTS (SELECT 1 FROM chat_messages m JOIN conversations v ON v.id = m."conversationId" JOIN contacts c ON c.id = v."contactId" WHERE c.phone = p.phone AND m.direction = 'inbound')`
  if (query.responded === 'yes') conditions.push(responded)
  if (query.responded === 'no') conditions.push(Prisma.sql`NOT (${responded})`)
  const message = String(query.message || '')
  const flow = String(query.flow || '')
  const action = String(query.action || '')
  const since = periodStart(query, now), until = periodEnd(query)
  const needsMessage = ['none', 'sent', 'delivered', 'read', 'failed'].includes(message) || ['carrinho', 'pix', 'boleto', 'remarketing', 'outros'].includes(flow)
  const needsAction = Boolean(action || since || until)
  const joins: Prisma.Sql[] = []
  if (needsMessage) {
    joins.push(Prisma.sql`LEFT JOIN LATERAL (
      SELECT status, flow FROM (
        SELECT m.status::text, CASE WHEN m."entityType" = 'abandoned_checkout' OR m."templateName" ~* '(carrinho|checkout)' THEN 'carrinho' WHEN m."templateName" ~* 'pix' THEN 'pix' WHEN m."templateName" ~* 'boleto' THEN 'boleto' WHEN m."templateName" ~* '(remarketing|recompra|inativo|vip)' THEN 'remarketing' ELSE 'outros' END AS flow, COALESCE(m."sentAt", m."acceptedAt", m."scheduledAt") AS at
        FROM message_logs m WHERE m."normalizedPhone" = p.phone
        UNION ALL
        SELECT COALESCE(m.status::text, 'unknown'), 'outros', m.timestamp FROM chat_messages m JOIN conversations v ON v.id = m."conversationId" JOIN contacts c ON c.id = v."contactId" WHERE c.phone = p.phone AND m.direction = 'outbound' AND (m."waMessageId" IS NULL OR NOT EXISTS (SELECT 1 FROM message_logs l WHERE l."metaMessageId" = m."waMessageId"))
      ) messages WHERE at IS NOT NULL ORDER BY at DESC LIMIT 1
    ) last_message ON true`)
    if (message === 'none') conditions.push(Prisma.sql`last_message.status IS NULL`)
    else if (message) conditions.push(Prisma.sql`last_message.status = ${message}`)
    if (flow) conditions.push(Prisma.sql`last_message.flow = ${flow}`)
  }
  if (needsAction) {
    joins.push(Prisma.sql`LEFT JOIN LATERAL (
      SELECT type, at FROM (
        SELECT 'ORDER_CREATED' AS type, o."sourceCreatedAt" AS at FROM orders o WHERE o."normalizedPhone" = p.phone
        UNION ALL SELECT 'CHECKOUT', c."sourceCreatedAt" FROM abandoned_checkouts c WHERE c."normalizedPhone" = p.phone
        UNION ALL SELECT 'CHECKOUT_ABANDONED', c."abandonedAt" FROM abandoned_checkouts c WHERE c."normalizedPhone" = p.phone
        UNION ALL SELECT 'CHECKOUT_CONVERTED', c."convertedAt" FROM abandoned_checkouts c WHERE c."normalizedPhone" = p.phone
        UNION ALL SELECT 'WHATSAPP_SCHEDULED', m."scheduledAt" FROM message_logs m WHERE m."normalizedPhone" = p.phone
        UNION ALL SELECT 'WHATSAPP_ACCEPTED', m."acceptedAt" FROM message_logs m WHERE m."normalizedPhone" = p.phone
        UNION ALL SELECT 'WHATSAPP_SENT', m."sentAt" FROM message_logs m WHERE m."normalizedPhone" = p.phone
        UNION ALL SELECT 'WHATSAPP_DELIVERED', to_timestamp((m.response->>'timestamp')::double precision) AT TIME ZONE 'UTC' FROM message_logs m WHERE m."normalizedPhone" = p.phone AND m.response->>'status' = 'delivered' AND m.response->>'timestamp' ~ '^[0-9]+$'
        UNION ALL SELECT 'WHATSAPP_READ', to_timestamp((m.response->>'timestamp')::double precision) AT TIME ZONE 'UTC' FROM message_logs m WHERE m."normalizedPhone" = p.phone AND m.response->>'status' = 'read' AND m.response->>'timestamp' ~ '^[0-9]+$'
        UNION ALL SELECT CASE WHEN m.direction = 'inbound' THEN 'WHATSAPP_INBOUND' ELSE 'WHATSAPP_SENT' END, m.timestamp FROM chat_messages m JOIN conversations v ON v.id = m."conversationId" JOIN contacts c ON c.id = v."contactId" WHERE c.phone = p.phone
      ) actions WHERE at IS NOT NULL ORDER BY at DESC LIMIT 1
    ) last_action ON true`)
    if (action) conditions.push(Prisma.sql`last_action.type LIKE ${action.toUpperCase() + '%'}`)
    if (since) conditions.push(Prisma.sql`last_action.at >= ${since}`)
    if (until) conditions.push(Prisma.sql`last_action.at < ${until}`)
  }
  const selected = await prisma.$queryRaw<Array<{ phone: string | null; total: bigint }>>(Prisma.sql`
    WITH phones AS (${phoneSources}), filtered AS (
      SELECT p.phone FROM phones p ${joins.length ? Prisma.join(joins, ' ') : Prisma.empty} WHERE ${Prisma.join(conditions, ' AND ')}
    ), total AS (SELECT COUNT(*)::bigint AS total FROM filtered)
    SELECT page.phone, total.total FROM total LEFT JOIN LATERAL (
      SELECT phone FROM filtered ORDER BY phone LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    ) page ON true`)
  return { phones: selected.map(row => row.phone).filter((phone): phone is string => Boolean(phone)), total: Number(selected[0]?.total ?? 0) }
}

async function loadKpis(now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const rows = await prisma.$queryRaw<Array<Record<string, bigint>>>(Prisma.sql`
    SELECT
      (SELECT COUNT(DISTINCT phone)::bigint FROM (
        SELECT "normalizedPhone" AS phone FROM orders WHERE "sourceCreatedAt" >= ${today}
        UNION SELECT "normalizedPhone" FROM abandoned_checkouts WHERE "abandonedAt" >= ${today}
        UNION SELECT "normalizedPhone" FROM abandoned_checkouts WHERE "sourceCreatedAt" >= ${today}
        UNION SELECT "normalizedPhone" FROM abandoned_checkouts WHERE "convertedAt" >= ${today}
        UNION SELECT "normalizedPhone" FROM message_logs WHERE "scheduledAt" >= ${today}
        UNION SELECT c.phone FROM chat_messages m JOIN conversations v ON v.id = m."conversationId" JOIN contacts c ON c.id = v."contactId" WHERE m.timestamp >= ${today}
      ) active) AS "activeToday",
      (SELECT COUNT(*)::bigint FROM abandoned_checkouts WHERE "abandonedAt" >= ${today}) AS "abandonedCheckouts",
      (SELECT COUNT(*)::bigint FROM orders WHERE "sourceCreatedAt" >= ${today}) AS orders,
      (SELECT COUNT(DISTINCT phone)::bigint FROM (
        SELECT "normalizedPhone" AS phone FROM message_logs
        UNION SELECT c.phone FROM chat_messages m JOIN conversations v ON v.id = m."conversationId" JOIN contacts c ON c.id = v."contactId" WHERE m.direction = 'outbound'
      ) outbound) AS "contactedCustomers",
      (SELECT COUNT(*)::bigint FROM message_logs WHERE status = 'delivered') AS delivered,
      (SELECT COUNT(*)::bigint FROM message_logs WHERE status = 'read') AS read,
      (SELECT COUNT(*)::bigint FROM message_logs WHERE status = 'failed') AS failed,
      (SELECT COUNT(*)::bigint FROM chat_messages WHERE direction = 'inbound' AND timestamp >= ${today}) AS responses`)
  const row = rows[0] || {}
  return Object.fromEntries(['activeToday', 'abandonedCheckouts', 'orders', 'contactedCustomers', 'delivered', 'read', 'failed', 'responses'].map(key => [key, Number(row[key] ?? 0)]))
}

async function resolvePhone(id: string): Promise<string | null> {
  const colon = id.indexOf(':')
  if (colon < 1) return null
  const kind = id.slice(0, colon), reference = id.slice(colon + 1)
  if (!reference || reference.length > 200) return null
  if (kind === 'consent' || kind === 'suppression') return /^\d{8,20}$/.test(reference) ? reference : null
  if (kind === 'customer') return (await prisma.customer.findUnique({ where: { id: reference }, select: { normalizedPhone: true } }))?.normalizedPhone ?? null
  if (kind === 'contact') return (await prisma.contact.findUnique({ where: { id: reference }, select: { phone: true } }))?.phone ?? null
  if (kind === 'order') return (await prisma.order.findUnique({ where: { id: reference }, select: { normalizedPhone: true } }))?.normalizedPhone ?? null
  if (kind === 'checkout') return (await prisma.abandonedCheckout.findUnique({ where: { id: reference }, select: { normalizedPhone: true } }))?.normalizedPhone ?? null
  if (kind === 'message') return (await prisma.messageLog.findUnique({ where: { id: reference }, select: { normalizedPhone: true } }))?.normalizedPhone ?? null
  if (kind === 'conversation') return (await prisma.conversation.findUnique({ where: { id: reference }, select: { contact: { select: { phone: true } } } }))?.contact.phone ?? null
  if (kind === 'chat') return (await prisma.chatMessage.findUnique({ where: { id: reference }, select: { conversation: { select: { contact: { select: { phone: true } } } } } }))?.conversation.contact.phone ?? null
  return null
}

export const crmJourneyService = {
  async list(query: Record<string, unknown>) {
    const page = parsePage(query.page), pageSize = parsePageSize(query.pageSize)
    const now = new Date(), selected = await selectPhonePage(query, now, page, pageSize)
    const facts = await loadFacts(selected.phones)
    const byPhone = new Map(makeRows(facts).map(row => [phoneKey(row.search.split(' ')[0]), row]))
    const rows = selected.phones.map(phone => byPhone.get(phoneKey(phone))).filter((row): row is JourneyRow => Boolean(row))
    const filtered = filterRows(rows, query, now)
    const data = filtered.map(({ search, timeline, messages, ...row }) => { void search; void timeline; void messages; return row })
    const kpis = await loadKpis(now)
    return { data, kpis, pagination: { page, pageSize, total: selected.total, pages: Math.ceil(selected.total / pageSize) }, coverage: { identified: selected.total, source: 'existing_tables', siteBehavior: 'NOT_AVAILABLE' } }
  },
  async detail(id: string) {
    const phone = await resolvePhone(id)
    if (!phone) return null
    const row = makeRows(await loadFacts([phone]))[0]
    if (!row) return null
    const { search, ...publicRow } = row
    void search
    return publicRow
  },
}
