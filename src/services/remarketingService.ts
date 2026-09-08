import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { isValidBrazilianPhone } from '../helpers/phoneService'
import { runAbandonedCheckoutsPreview } from '../jobs/previewAbandonedCheckouts'

export const segmentNames = ['abandoned_cart', 'pix_pending', 'boleto_pending', 'recent_customer', 'inactive_customer', 'vip_customer', 'engaged_no_purchase'] as const
export type Segment = typeof segmentNames[number]

export const segmentContracts: Record<Segment, { priority: number; template: string; marketing: boolean }> = {
  pix_pending: { priority: 1, template: '_pix_pendente', marketing: false },
  boleto_pending: { priority: 2, template: 'pedido_boleto_drosa_01', marketing: false },
  abandoned_cart: { priority: 3, template: env.ABANDONED_CART_TEMPLATE, marketing: true },
  recent_customer: { priority: 4, template: 'cliente_recente_drosa_v1', marketing: true },
  vip_customer: { priority: 5, template: 'cliente_vip_drosa_v1', marketing: true },
  inactive_customer: { priority: 6, template: 'cliente_inativo_drosa_v1', marketing: true },
  engaged_no_purchase: { priority: 7, template: 'atendimento_retomada_drosa_v1', marketing: true },
}

export async function remarketingSend(segment: Segment | 'all' = 'all') {
  const preview = await remarketingPreview(segment)
  const result = {
    found: preview.found,
    eligible: preview.eligible,
    claimed: 0,
    sent: 0,
    skipped: preview.skipped,
    failed: 0,
    unknown: 0,
    errors: 0,
    reasons: preview.reasons,
    segments: preview.segments,
  }

  if (!env.AUTOMATION_SEND_ENABLED) return { status: 423, result: { ...result, reasons: { ...result.reasons, automation_send_disabled: preview.found } } }
  if (!env.REMARKETING_ENABLED) return { status: 423, result: { ...result, reasons: { ...result.reasons, remarketing_disabled: preview.found } } }
  if (env.WHATSAPP_DRY_RUN) return { status: 423, result: { ...result, reasons: { ...result.reasons, whatsapp_dry_run: preview.found } } }

  // The preview is the source of eligibility and currently fails closed until
  // consent and the live Meta contract are proven for every candidate.
  return { status: 200, result }
}

type Candidate = { entityId: string; phone: string; segment: Segment; reasons: string[] }

// A database template marked active is not evidence of approval in Meta.
// Preview explicitly exposes this outstanding gate, never assumes consent.
export async function remarketingPreview(segment: Segment | 'all' = 'all') {
  const now = Date.now()
  const day = 86400000
  const [orders, conversations, suppressions, optedOut, recentMessages] = await Promise.all([
    prisma.order.findMany({ orderBy: { sourceCreatedAt: 'desc' }, take: 10000 }),
    prisma.conversation.findMany({ where: { lastInboundAt: { not: null } }, include: { contact: true }, take: 10000 }),
    prisma.suppression.findMany({ select: { normalizedPhone: true } }),
    prisma.customer.findMany({ where: { optOut: true }, select: { normalizedPhone: true } }),
    prisma.messageLog.findMany({ where: { status: { in: ['sent', 'delivered', 'read', 'unknown'] },
      OR: [{ sentAt: { gte: new Date(now - env.REMARKETING_GLOBAL_COOLDOWN_HOURS * 3600000) } }, { status: 'unknown' }] },
      select: { normalizedPhone: true } }),
  ])
  const suppressed = new Set([...suppressions, ...optedOut].map(item => item.normalizedPhone))
  const cooldown = new Set(recentMessages.map(item => item.normalizedPhone))
  const candidates: Candidate[] = []
  const incomplete = orders.length === 10000 || conversations.length === 10000
  const push = (entityId: string, phone: string, candidateSegment: Segment, reasons: string[] = []) => {
    if (segment !== 'all' && segment !== candidateSegment) return
    if (!phone) reasons.push('missing_phone')
    else if (!isValidBrazilianPhone(phone)) reasons.push('invalid_phone')
    if (suppressed.has(phone)) reasons.push('opt_out')
    if (cooldown.has(phone)) reasons.push('cooldown_active')
    if (incomplete) reasons.push('history_incomplete')
    if (segmentContracts[candidateSegment].marketing) reasons.push('consent_unproven')
    reasons.push('meta_template_unverified')
    candidates.push({ entityId, phone, segment: candidateSegment, reasons })
  }
  const byPhone = new Map<string, typeof orders>()
  for (const order of orders) {
    if (order.normalizedPhone) byPhone.set(order.normalizedPhone, [...(byPhone.get(order.normalizedPhone) ?? []), order])
    const method = order.paymentMethod?.toLowerCase() ?? ''
    if (order.paymentStatus !== 'pending' || ['cancelled', 'canceled', 'refunded'].includes(order.status)) continue
    const pendingSegment = method.includes('pix') ? 'pix_pending' : /boleto|ticket/.test(method) ? 'boleto_pending' : null
    if (pendingSegment) push(order.id, order.normalizedPhone, pendingSegment,
      [...(!order.sourceCreatedAt ? ['order_timing_uncertain'] : []), ...(!order.orderUrl ? ['missing_payment_url'] : [])])
  }
  for (const [phone, history] of byPhone) {
    const paid = history.filter(order => order.paymentStatus === 'paid' && !['cancelled', 'canceled', 'refunded'].includes(order.status))
    const dated = paid.filter(order => order.sourceCreatedAt).sort((a, b) => b.sourceCreatedAt!.getTime() - a.sourceCreatedAt!.getTime())
    if (!dated.length) continue
    const last = dated[0]
    const age = (now - last.sourceCreatedAt!.getTime()) / day
    const reasons = paid.some(order => !order.sourceCreatedAt) ? ['order_timing_uncertain'] : []
    if (age >= 0 && age <= env.REMARKETING_RECENT_CUSTOMER_DAYS) push(last.id, phone, 'recent_customer', [...reasons])
    if (age >= env.REMARKETING_INACTIVE_DAYS) push(last.id, phone, 'inactive_customer', [...reasons, 'history_completeness_unverified'])
    if (paid.length >= env.VIP_MIN_ORDERS && paid.reduce((sum, order) => sum + Number(order.total), 0) >= env.VIP_MIN_SPEND) {
      push(last.id, phone, 'vip_customer', [...reasons])
    }
  }
  for (const conversation of conversations) {
    const inbound = conversation.lastInboundAt
    if (!inbound || now - inbound.getTime() > 30 * day || inbound.getTime() > now) continue
    const history = byPhone.get(conversation.contact.phone) ?? []
    if (history.some(order => order.sourceCreatedAt && order.sourceCreatedAt >= inbound)) continue
    push(conversation.id, conversation.contact.phone, 'engaged_no_purchase', history.some(order => !order.sourceCreatedAt) ? ['order_timing_uncertain'] : [])
  }
  candidates.sort((a, b) => segmentContracts[a.segment].priority - segmentContracts[b.segment].priority)
  const selectedPhones = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.phone && selectedPhones.has(candidate.phone)) candidate.reasons.push('suppressed_by_higher_priority_segment')
    else if (candidate.phone) selectedPhones.add(candidate.phone)
  }
  const segments: Record<string, unknown> = {}
  const reasons: Record<string, number> = {}
  for (const name of segmentNames.filter(name => name !== 'abandoned_cart' && (segment === 'all' || name === segment))) {
    const items = candidates.filter(item => item.segment === name)
    for (const item of items) for (const reason of item.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1
    segments[name] = { found: items.length, eligible: 0, skipped: items.length, sent: 0,
      template: segmentContracts[name].template, status: segmentContracts[name].marketing ? 'READY_BUT_SUPPRESSED_BY_CONSENT' : 'META_TEMPLATE_SYNC_REQUIRED',
      data: items.map(item => ({ entityId: item.entityId, maskedPhone: item.phone ? `***${item.phone.slice(-2)}` : null, reasons: item.reasons })) }
  }
  let carts = { found: 0, eligible: 0, skipped: 0 }
  if (segment === 'all' || segment === 'abandoned_cart') {
    const preview = await runAbandonedCheckoutsPreview()
    carts = { found: preview.found, eligible: 0, skipped: preview.found }
    segments.abandoned_cart = { ...preview, eligible: 0, skipped: preview.found, status: 'META_TEMPLATE_SYNC_REQUIRED' }
    reasons.meta_template_unverified = (reasons.meta_template_unverified ?? 0) + preview.found
  }
  return { dryRun: true, found: candidates.length + carts.found, eligible: 0, skipped: candidates.length + carts.found, sent: 0,
    segments, reasons, dataQuality: { historyTruncated: incomplete, consentSourceConfigured: false, metaTemplatesVerified: false },
    vipThresholds: { minimumOrders: env.VIP_MIN_ORDERS, minimumSpend: env.VIP_MIN_SPEND } }
}
