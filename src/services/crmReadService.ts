import { MessageStatus, Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { evaluateAbandonedCheckoutEligibility } from './abandonedCheckoutEligibilityService'

const MAX_PAGE_SIZE = 100

export function parsePage(input: unknown, fallback = 1): number {
  const value = Number(input)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function parsePageSize(input: unknown, fallback = 25): number {
  const value = Number(input)
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_PAGE_SIZE) : fallback
}

export function phoneSearchTerm(search: string): string | null {
  const digits = search.replace(/\D/g, '')
  return digits.length >= 3 ? digits : null
}

export function buildCustomerSearch(search: string): Prisma.CustomerWhereInput {
  if (!search) return {}
  const phone = phoneSearchTerm(search)
  return { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, ...(phone ? [{ normalizedPhone: { contains: phone } }] : [])] }
}

export function buildConversationSearch(search: string): Prisma.ConversationWhereInput {
  if (!search) return {}
  const phone = phoneSearchTerm(search)
  return { contact: { OR: [{ name: { contains: search, mode: 'insensitive' } }, ...(phone ? [{ phone: { contains: phone } }] : [])] } }
}

export function buildMessageSearch(search: string): Prisma.MessageLogWhereInput {
  if (!search) return {}
  const phone = phoneSearchTerm(search)
  return { OR: [{ entityId: { contains: search, mode: 'insensitive' } }, { metaMessageId: { contains: search, mode: 'insensitive' } }, ...(phone ? [{ normalizedPhone: { contains: phone } }] : []), { customer: { name: { contains: search, mode: 'insensitive' } } }] }
}

type TimelineSource = {
  status: string
  createdAt: Date
  scheduledAt: Date | null
  acceptedAt: Date | null
  sentAt: Date | null
  updatedAt: Date
  deliveredAt?: Date | null
  readAt?: Date | null
}

export function extractMetaStatusTimestamp(response: unknown, expectedStatus: 'delivered' | 'read'): Date | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null
  const value = response as Record<string, unknown>
  if (value.status !== expectedStatus) return null
  const seconds = Number(value.timestamp)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000)
}

export function buildMessageTimeline(row: TimelineSource) {
  return [
    { stage: 'created', at: row.createdAt },
    ...(row.scheduledAt ? [{ stage: 'scheduled', at: row.scheduledAt }] : []),
    ...(row.acceptedAt ? [{ stage: 'accepted', at: row.acceptedAt }] : []),
    ...(row.sentAt ? [{ stage: 'sent', at: row.sentAt }] : []),
    ...(row.deliveredAt ? [{ stage: 'delivered', at: row.deliveredAt }] : []),
    ...(row.readAt ? [{ stage: 'read', at: row.readAt }] : []),
  ]
}

type DateRange = { gte: Date, lte: Date }

export function buildDashboardFilters(period: DateRange) {
  return {
    messagesCreated: { createdAt: period },
    messagesSent: { sentAt: period },
    orders: { sourceCreatedAt: period },
    abandoned: { abandonedAt: period },
    converted: { convertedAt: period },
    inbound: { direction: 'inbound' as const, OR: [{ timestamp: period }, { timestamp: null, createdAt: period }] },
  }
}

export function summarizeInbound(inboundMessages: number, conversationGroups: Array<{ conversationId: string }>) {
  return { inboundMessages, inboundConversations: conversationGroups.length }
}

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length < 4 ? '***' : `${digits.slice(0, 2)}*****${digits.slice(-2)}`
}

export function maskEmail(value: string | null | undefined): string | null {
  if (!value || !value.includes('@')) return null
  const [local, domain] = value.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}

export type FailureCategory = 'TEMPLATE_CONFIGURATION' | 'PROVIDER_REJECTION' | 'RETRY_EXHAUSTED' | 'CONSENT_BLOCK' | 'SUPPRESSION_BLOCK' | 'DATA_QUALITY' | 'NETWORK_TRANSIENT' | 'DELIVERY_UNKNOWN' | 'INTERNAL_ERROR' | 'UNKNOWN_REASON'

export function normalizeFailure(reason?: string | null, errorCode?: string | null, status?: string | null): FailureCategory | null {
  const value = `${reason ?? ''} ${errorCode ?? ''}`.toLowerCase()
  if (!value.trim() && status !== 'unknown' && status !== 'failed') return null
  if (status === 'unknown' || value.includes('delivery_unknown')) return 'DELIVERY_UNKNOWN'
  if (value.includes('template') || value.includes('132001')) return 'TEMPLATE_CONFIGURATION'
  if (value.includes('max_retries') || value.includes('retry_exhaust')) return 'RETRY_EXHAUSTED'
  if (value.includes('consent') || value.includes('permission')) return 'CONSENT_BLOCK'
  if (value.includes('suppress') || value.includes('opt_out')) return 'SUPPRESSION_BLOCK'
  if (value.includes('missing') || value.includes('invalid_') || value.includes('timing_uncertain')) return 'DATA_QUALITY'
  if (value.includes('timeout') || value.includes('network') || value.includes('econn')) return 'NETWORK_TRANSIENT'
  if (errorCode || value.includes('provider') || value.includes('meta')) return 'PROVIDER_REJECTION'
  return status === 'failed' ? 'INTERNAL_ERROR' : 'UNKNOWN_REASON'
}

function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, pages: Math.ceil(total / pageSize) }
}

function range(query: Record<string, unknown>) {
  const page = parsePage(query.page), pageSize = parsePageSize(query.pageSize)
  return { page, pageSize, skip: (page - 1) * pageSize }
}

function startDate(period?: string, custom?: string): Date {
  if (period === 'custom' && custom) {
    const parsed = new Date(custom)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  const days = period === '30d' ? 30 : period === '7d' ? 7 : 1
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() - days + 1)
  return value
}

export const crmReadService = {
  async dashboard(period?: string, from?: string, to?: string) {
    const start = startDate(period, from)
    const end = to && !Number.isNaN(new Date(to).getTime()) ? new Date(to) : new Date()
    const dateRange = { gte: start, lte: end }
    const filters = buildDashboardFilters(dateRange)
    const [groups, sent, contacted, inboundMessages, inboundConversationGroups, abandoned, converted, pix, boleto] = await Promise.all([
      prisma.messageLog.groupBy({ by: ['status'], where: filters.messagesCreated, _count: { _all: true } }),
      prisma.messageLog.count({ where: filters.messagesSent }),
      prisma.messageLog.findMany({ where: filters.messagesSent, distinct: ['normalizedPhone'], select: { normalizedPhone: true } }),
      prisma.chatMessage.count({ where: filters.inbound }),
      prisma.chatMessage.groupBy({ by: ['conversationId'], where: filters.inbound }),
      prisma.abandonedCheckout.count({ where: { ...filters.abandoned, status: 'abandoned' } }),
      prisma.abandonedCheckout.count({ where: filters.converted }),
      prisma.order.count({ where: { ...filters.orders, paymentMethod: { contains: 'pix', mode: 'insensitive' }, paymentStatus: { notIn: ['paid', 'confirmed', 'authorized', 'refunded'] } } }),
      prisma.order.count({ where: { ...filters.orders, paymentMethod: { contains: 'boleto', mode: 'insensitive' }, paymentStatus: { notIn: ['paid', 'confirmed', 'authorized', 'refunded'] } } }),
    ])
    const statuses = Object.fromEntries(groups.map(item => [item.status, item._count._all]))
    const inbound = summarizeInbound(inboundMessages, inboundConversationGroups)
    return { period: { from: start, to: end }, messages: { total: groups.reduce((sum, item) => sum + item._count._all, 0), ...statuses, sent, delivered: null, read: null }, contactedCustomers: contacted.length, ...inbound, abandonedCheckouts: abandoned, eligibleCheckouts: null, convertedCheckouts: converted, pixPending: pix, boletoPending: boleto }
  },

  async messages(query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query)
    const search = String(query.search ?? '').trim()
    const where: Prisma.MessageLogWhereInput = {
      ...(query.status ? { status: String(query.status) as MessageStatus } : {}),
      ...(query.template ? { templateName: String(query.template) } : {}),
      ...(query.entityType ? { entityType: String(query.entityType) as never } : {}),
      ...(query.source ? { source: String(query.source) } : {}),
      ...buildMessageSearch(search),
    }
    const [total, rows] = await Promise.all([prisma.messageLog.count({ where }), prisma.messageLog.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { customer: { select: { name: true } } } })])
    return { data: rows.map(row => ({ id: row.id, createdAt: row.createdAt, customer: row.customer?.name ?? null, phone: maskPhone(row.normalizedPhone), source: row.source, entityType: row.entityType, entityId: row.entityId, template: row.templateName, status: row.status, attempts: row.retryCount + 1, conversion: null, failureCategory: normalizeFailure(row.reason, row.errorCode, row.status) })), pagination: pagination(page, pageSize, total) }
  },

  async message(id: string) {
    const row = await prisma.messageLog.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true } } } })
    if (!row) return null
    const deliveredAt = extractMetaStatusTimestamp(row.response, 'delivered')
    const readAt = extractMetaStatusTimestamp(row.response, 'read')
    return { id: row.id, customer: row.customer, phone: maskPhone(row.normalizedPhone), source: row.source, entityType: row.entityType, entityId: row.entityId, templateName: row.templateName, templateLanguage: row.templateLanguage, templateParameters: row.templateParameters, renderedPreview: row.renderedPreview, status: row.status, scheduledAt: row.scheduledAt, acceptedAt: row.acceptedAt, sentAt: row.sentAt, deliveredAt, readAt, metaMessageId: row.metaMessageId, retryCount: row.retryCount, lastRetryAt: row.lastRetryAt, nextRetryAt: row.nextRetryAt, reason: row.reason, errorCode: row.errorCode, failureCategory: normalizeFailure(row.reason, row.errorCode, row.status), mirrorStatus: row.mirrorStatus, mirroredAt: row.mirroredAt, timeline: buildMessageTimeline({ ...row, deliveredAt, readAt }) }
  },

  async customers(query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query), search = String(query.search ?? '').trim()
    const where = buildCustomerSearch(search)
    const [total, rows] = await Promise.all([prisma.customer.count({ where }), prisma.customer.findMany({ where, skip, take: pageSize, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { orders: true, messageLogs: true } }, orders: { take: 1, orderBy: { sourceCreatedAt: 'desc' }, select: { sourceCreatedAt: true, createdAt: true } } } })])
    const phones = rows.map(row => row.normalizedPhone)
    const [consents, suppressions, messages, conversations] = await Promise.all([prisma.whatsappConsent.findMany({ where: { normalizedPhone: { in: phones }, scope: 'marketing' } }), prisma.suppression.findMany({ where: { normalizedPhone: { in: phones } } }), prisma.messageLog.groupBy({ by: ['normalizedPhone'], where: { normalizedPhone: { in: phones } }, _max: { createdAt: true } }), prisma.conversation.findMany({ where: { contact: { phone: { in: phones } } }, include: { contact: { select: { phone: true } } } })])
    return { data: rows.map(row => { const consent = consents.find(c => c.normalizedPhone === row.normalizedPhone); return { id: row.id, name: row.name, phone: maskPhone(row.normalizedPhone), email: maskEmail(row.email), orders: row._count.orders, lastOrder: row.orders[0]?.sourceCreatedAt ?? row.orders[0]?.createdAt ?? null, lastContact: messages.find(m => m.normalizedPhone === row.normalizedPhone)?._max.createdAt ?? null, consent: consent?.consented && !consent.revokedAt ? 'GRANTED' : consent?.revokedAt || consent?.consented === false ? 'REVOKED' : 'UNKNOWN', optOut: row.optOut, suppressed: suppressions.some(s => s.normalizedPhone === row.normalizedPhone), messages: row._count.messageLogs, conversations: conversations.filter(c => c.contact.phone === row.normalizedPhone).length } }), pagination: pagination(page, pageSize, total) }
  },

  async customer(id: string) {
    const row = await prisma.customer.findUnique({ where: { id }, include: { orders: { orderBy: { createdAt: 'desc' }, take: 50 }, abandonedCheckouts: { orderBy: { createdAt: 'desc' }, take: 50 }, messageLogs: { orderBy: { createdAt: 'desc' }, take: 100 } } })
    if (!row) return null
    const [consents, suppression, conversations] = await Promise.all([prisma.whatsappConsent.findMany({ where: { normalizedPhone: row.normalizedPhone } }), prisma.suppression.findUnique({ where: { normalizedPhone: row.normalizedPhone } }), prisma.conversation.findMany({ where: { contact: { phone: row.normalizedPhone } }, select: { id: true, status: true, lastMessageAt: true } })])
    return {
      id: row.id,
      name: row.name,
      phone: maskPhone(row.normalizedPhone),
      email: maskEmail(row.email),
      optOut: row.optOut,
      suppression: suppression ? { reason: suppression.reason, source: suppression.source, suppressedAt: suppression.suppressedAt } : null,
      consents: consents.map(item => ({ scope: item.scope, consented: item.consented, source: item.source, consentedAt: item.consentedAt, revokedAt: item.revokedAt })),
      orders: row.orders.map(item => ({ id: item.id, orderNumber: item.orderNumber, total: item.total, paymentStatus: item.paymentStatus, paymentMethod: item.paymentMethod, status: item.status, date: item.sourceCreatedAt ?? item.createdAt })),
      checkouts: row.abandonedCheckouts.map(item => ({ id: item.id, checkout: item.nuvemshopCheckoutId, total: item.total, products: item.productsSummary, status: item.status, date: item.abandonedAt ?? item.createdAt })),
      messages: row.messageLogs.map(item => ({ id: item.id, templateName: item.templateName, status: item.status, entityType: item.entityType, entityId: item.entityId, createdAt: item.createdAt })),
      conversations,
    }
  },

  async conversations(query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query), search = String(query.search ?? '').trim()
    const where: Prisma.ConversationWhereInput = { ...(query.status ? { status: String(query.status) as never } : {}), ...buildConversationSearch(search) }
    const [total, rows] = await Promise.all([prisma.conversation.count({ where }), prisma.conversation.findMany({ where, skip, take: pageSize, orderBy: { lastMessageAt: 'desc' }, include: { contact: true, messages: { take: 1, orderBy: { createdAt: 'desc' } } } })])
    return { data: rows.map(row => ({ id: row.id, contact: row.contact.name, phone: maskPhone(row.contact.phone), status: row.status, lastMessageAt: row.lastMessageAt, lastInboundAt: row.lastInboundAt, preview: row.messages[0]?.body ?? `[${row.messages[0]?.type ?? 'sem mensagem'}]` })), pagination: pagination(page, pageSize, total) }
  },

  async conversation(id: string) {
    const row = await prisma.conversation.findUnique({ where: { id }, include: { contact: true, messages: { orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }], select: { id: true, direction: true, type: true, body: true, status: true, timestamp: true, createdAt: true } } } })
    return row ? { ...row, contact: { ...row.contact, phone: maskPhone(row.contact.phone) } } : null
  },

  async checkouts(query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query)
    const where: Prisma.AbandonedCheckoutWhereInput = query.status ? { status: String(query.status) as never } : {}
    const [total, rows] = await Promise.all([prisma.abandonedCheckout.count({ where }), prisma.abandonedCheckout.findMany({ where, skip, take: pageSize, orderBy: { lastSeenAt: 'desc' } })])
    const [evaluated, messages] = await Promise.all([Promise.all(rows.map(row => evaluateAbandonedCheckoutEligibility(row).catch(() => null))), prisma.messageLog.findMany({ where: { entityType: 'abandoned_checkout', entityId: { in: rows.map(row => row.id) } }, orderBy: { createdAt: 'desc' } })])
    return { data: rows.map((row, index) => { const result = evaluated[index], message = messages.find(item => item.entityId === row.id); return { id: row.id, checkout: row.nuvemshopCheckoutId, customer: row.customerName, phone: maskPhone(row.normalizedPhone), products: row.productsSummary, total: row.total, currency: row.currency, date: row.abandonedAt ?? row.sourceUpdatedAt ?? row.createdAt, status: row.status, eligible: result?.eligible ?? null, blockers: result?.reasons ?? ['evaluation_unavailable'], message: message ? { id: message.id, template: message.templateName, status: message.status } : null, convertedAt: row.convertedAt, convertedOrderId: row.convertedOrderId } }), pagination: pagination(page, pageSize, total) }
  },

  async payments(method: 'pix' | 'boleto', query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query)
    const where: Prisma.OrderWhereInput = { paymentMethod: { contains: method, mode: 'insensitive' } }
    const [total, rows] = await Promise.all([prisma.order.count({ where }), prisma.order.findMany({ where, skip, take: pageSize, orderBy: { sourceCreatedAt: 'desc' } })])
    const logs = await prisma.messageLog.findMany({ where: { entityType: 'order', entityId: { in: rows.map(row => row.id) } }, orderBy: { createdAt: 'desc' } })
    return { data: rows.map(row => { const log = logs.find(item => item.entityId === row.id); return { id: row.id, order: row.orderNumber, customer: row.customerName, phone: maskPhone(row.normalizedPhone), total: row.total, date: row.sourceCreatedAt ?? row.createdAt, paymentStatus: row.paymentStatus, orderStatus: row.status, template: log?.templateName ?? null, messageStatus: log?.status ?? null, error: log ? { category: normalizeFailure(log.reason, log.errorCode, log.status), reason: log.reason, errorCode: log.errorCode, retries: log.retryCount } : null } }), pagination: pagination(page, pageSize, total) }
  },

  async remarketing(query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query)
    const [total, rows] = await Promise.all([prisma.remarketingRun.count(), prisma.remarketingRun.findMany({ skip, take: pageSize, orderBy: { startedAt: 'desc' }, include: { recipients: { take: 20, orderBy: { createdAt: 'desc' } } } })])
    return { data: rows, pagination: pagination(page, pageSize, total), runtime: { enabled: env.REMARKETING_ENABLED, automationSendEnabled: env.AUTOMATION_SEND_ENABLED, dryRun: env.WHATSAPP_DRY_RUN } }
  },

  async automations() {
    const rows = await prisma.automationRule.findMany({ orderBy: { eventType: 'asc' } })
    return { data: rows.map(row => ({ ...row, runtime: { cronEnabled: env.ENABLE_INTERNAL_CRON, automationSendEnabled: env.AUTOMATION_SEND_ENABLED, flowEnabled: row.eventType === 'abandoned_checkout' ? env.ABANDONED_CART_ENABLED : false, whatsappDryRun: env.WHATSAPP_DRY_RUN } })) }
  },

  async templates() {
    const [rows, usage] = await Promise.all([prisma.whatsappTemplate.findMany({ orderBy: { eventType: 'asc' } }), prisma.messageLog.groupBy({ by: ['templateName'], _count: { _all: true }, _max: { createdAt: true } })])
    return { data: rows.map(row => { const stats = usage.find(item => item.templateName === row.metaTemplateName); return { id: row.id, name: row.name, eventType: row.eventType, metaTemplateName: row.metaTemplateName, languageCode: row.languageCode, category: row.category, messagePreview: row.messagePreview, active: row.active, usageCount: stats?._count._all ?? 0, lastUsedAt: stats?._max.createdAt ?? null, metaStatus: 'NOT_AVAILABLE' } }) }
  },

  async consents(query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query)
    const [total, rows] = await Promise.all([prisma.whatsappConsent.count(), prisma.whatsappConsent.findMany({ skip, take: pageSize, orderBy: { updatedAt: 'desc' } })])
    return { data: rows.map(row => ({ id: row.id, phone: maskPhone(row.normalizedPhone), scope: row.scope, status: row.consented && !row.revokedAt ? 'GRANTED' : row.revokedAt || !row.consented ? 'REVOKED' : 'UNKNOWN', source: row.source, consentedAt: row.consentedAt, revokedAt: row.revokedAt })), pagination: pagination(page, pageSize, total) }
  },

  async health() {
    const [meta, nuvemshop, oldestPending, pending, processing, failed, unknown, mirrorFailed, mirrorSuccess] = await Promise.all([prisma.webhookEvent.findFirst({ where: { provider: 'meta' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, processed: true, hmacValid: true, error: true } }), prisma.webhookEvent.findFirst({ where: { provider: 'nuvemshop' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, processed: true, hmacValid: true, error: true } }), prisma.messageLog.findFirst({ where: { status: 'pending' }, orderBy: { scheduledAt: 'asc' }, select: { scheduledAt: true } }), prisma.messageLog.count({ where: { status: 'pending' } }), prisma.messageLog.count({ where: { status: 'processing' } }), prisma.messageLog.count({ where: { status: 'failed' } }), prisma.messageLog.count({ where: { status: 'unknown' } }), prisma.messageLog.count({ where: { mirrorStatus: 'failed' } }), prisma.messageLog.findFirst({ where: { mirrorStatus: 'mirrored' }, orderBy: { mirroredAt: 'desc' }, select: { mirroredAt: true } })])
    return { meta: { configured: Boolean(env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID), latestEvidence: meta ?? null }, nuvemshop: { configured: Boolean(env.NUVEMSHOP_ACCESS_TOKEN && env.NUVEMSHOP_STORE_ID), latestEvidence: nuvemshop ?? null }, recoveryEngine: { pending, processing, failed, unknown, oldestPending: oldestPending?.scheduledAt ?? null }, inboxMirror: { failed: mirrorFailed, latestSuccess: mirrorSuccess?.mirroredAt ?? null }, runtime: { cron: env.ENABLE_INTERNAL_CRON, automationSend: env.AUTOMATION_SEND_ENABLED, abandonedCart: env.ABANDONED_CART_ENABLED, remarketing: env.REMARKETING_ENABLED, whatsappDryRun: env.WHATSAPP_DRY_RUN, inboxDryRun: env.INBOX_SEND_DRY_RUN } }
  },

  async audit(query: Record<string, unknown>) {
    const { page, pageSize, skip } = range(query)
    const [total, rows] = await Promise.all([prisma.webhookEvent.count(), prisma.webhookEvent.findMany({ skip, take: pageSize, orderBy: { createdAt: 'desc' }, select: { id: true, provider: true, topic: true, externalId: true, hmacValid: true, processed: true, processedAt: true, error: true, createdAt: true } })])
    return { data: rows, pagination: pagination(page, pageSize, total), fullAuditLog: { status: 'NOT_AVAILABLE', missing: ['actor', 'before', 'after', 'reason'] } }
  },
}
