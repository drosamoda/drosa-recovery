import { AbandonedCheckout, MessageStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { isValidBrazilianPhone } from '../helpers/phoneService'
import { renderTemplatePreview } from '../helpers/inboxTemplatePreview'
import { hasActiveWhatsappConsent } from './whatsappConsentService'

export type AbandonedCheckoutEligibilityReason =
  | 'missing_phone'
  | 'invalid_phone'
  | 'missing_recovery_url'
  | 'invalid_recovery_url'
  | 'converted'
  | 'skipped'
  | 'already_sent'
  | 'cooldown_active'
  | 'order_after_checkout'
  | 'order_timing_uncertain'
  | 'opt_out'
  | 'consent_unproven'
  | 'too_recent'
  | 'too_old'
  | 'invalid_template'
  | 'invalid_template_data'
  | 'invalid_encoding'
  | 'unknown_checkout_state'

export type AbandonedCheckoutEligibility = {
  eligible: boolean
  reasons: AbandonedCheckoutEligibilityReason[]
  warnings: string[]
  checkoutId: string
  normalizedPhone: string | null
  templateName: string
  templateParameters: string[]
  renderedPreview: string | null
}

const BLOCKING_DELIVERY_STATUSES: MessageStatus[] = [
  MessageStatus.sent,
  MessageStatus.delivered,
  MessageStatus.read,
  MessageStatus.unknown,
]

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

function hasBadEncoding(value: string): boolean {
  return value.includes('\uFFFD') || value.includes('??') || /{{\s*\d+\s*}}/.test(value)
}

function validRecoveryUrl(value: string): boolean {
  try {
    const candidate = new URL(value)
    const allowed = new URL(env.CHECKOUT_BASE_URL)
    return candidate.protocol === 'https:' && candidate.origin === allowed.origin && candidate.pathname.startsWith(allowed.pathname)
  } catch {
    return false
  }
}

function reliableCheckoutTime(checkout: AbandonedCheckout): Date | null {
  return checkout.abandonedAt ?? checkout.sourceUpdatedAt ?? checkout.sourceCreatedAt
}

type EligibilityFacts = {
  suppressed: boolean
  optedOut: boolean
  consentProven: boolean
  template: { messagePreview: string | null; variables: unknown } | null
  existingForCheckout: boolean
  recentContact: boolean
  matchingOrders: Array<{ sourceCreatedAt: Date | null; createdAt: Date }>
}

function evaluateFromFacts(checkout: AbandonedCheckout, facts: EligibilityFacts, now: Date): AbandonedCheckoutEligibility {
  const reasons: AbandonedCheckoutEligibilityReason[] = []
  const warnings: string[] = []
  const templateName = env.ABANDONED_CART_TEMPLATE
  const phone = checkout.normalizedPhone || null
  const name = firstName(checkout.customerName || '')
  const recoveryUrl = checkout.abandonedCheckoutUrl?.trim() ?? ''
  const checkoutTime = reliableCheckoutTime(checkout)

  if (!phone) reasons.push('missing_phone')
  else if (!isValidBrazilianPhone(phone)) reasons.push('invalid_phone')
  if (!recoveryUrl) reasons.push('missing_recovery_url')
  else if (!validRecoveryUrl(recoveryUrl)) reasons.push('invalid_recovery_url')

  if (checkout.status === 'converted') reasons.push('converted')
  else if (checkout.status === 'skipped') reasons.push('skipped')
  else if (checkout.status !== 'abandoned') reasons.push('unknown_checkout_state')

  if (!checkoutTime || !checkout.sourceCreatedAt) {
    reasons.push('order_timing_uncertain')
  } else {
    const ageMs = now.getTime() - checkoutTime.getTime()
    if (ageMs < env.ABANDONED_CART_DELAY_MINUTES * 60_000) reasons.push('too_recent')
    if (ageMs > env.ABANDONED_CART_MAX_AGE_HOURS * 3_600_000) reasons.push('too_old')
  }

  if (!name || !recoveryUrl) reasons.push('invalid_template_data')

  const { suppressed, optedOut, consentProven, template, existingForCheckout, recentContact, matchingOrders } = facts

  if (suppressed || optedOut) reasons.push('opt_out')
  if (!consentProven) reasons.push('consent_unproven')
  if (!template) reasons.push('invalid_template')
  if (existingForCheckout) reasons.push('already_sent')
  if (recentContact) reasons.push('cooldown_active')

  if (checkout.sourceCreatedAt && matchingOrders.length > 0) {
    const uncertainLegacyOrder = matchingOrders.some((order) =>
      !order.sourceCreatedAt && order.createdAt >= checkout.sourceCreatedAt!
    )

    if (uncertainLegacyOrder) {
      reasons.push('order_timing_uncertain')
    } else if (matchingOrders.some((order) =>
      order.sourceCreatedAt !== null && order.sourceCreatedAt >= checkout.sourceCreatedAt!
    )) {
      reasons.push('order_after_checkout')
    }
  }

  const templateParameters = name && recoveryUrl ? [name, recoveryUrl] : []
  let renderedPreview: string | null = null
  if (template && templateParameters.length === 2) {
    renderedPreview = renderTemplatePreview(templateName, {
      templatePreview: template.messagePreview,
      templateVariables: { nome_cliente: name, link_checkout: recoveryUrl },
    }).renderedPreview
    if (!renderedPreview || hasBadEncoding(renderedPreview)) reasons.push('invalid_encoding')
  }

  if (!checkout.abandonedAt) warnings.push('abandoned_time_inferred_from_nuvemshop_update')

  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    warnings,
    checkoutId: checkout.id,
    normalizedPhone: phone,
    templateName,
    templateParameters,
    renderedPreview,
  }
}

export async function evaluateAbandonedCheckoutEligibility(
  checkout: AbandonedCheckout,
  now: Date = new Date()
): Promise<AbandonedCheckoutEligibility> {
  const phone = checkout.normalizedPhone || null
  const templateName = env.ABANDONED_CART_TEMPLATE
  const [suppression, customer, consentProven, template, existingForCheckout, recentContact, matchingOrders] = await Promise.all([
    phone ? prisma.suppression.findUnique({ where: { normalizedPhone: phone }, select: { id: true } }) : null,
    phone ? prisma.customer.findFirst({ where: { normalizedPhone: phone }, select: { optOut: true } }) : null,
    phone ? hasActiveWhatsappConsent(phone) : false,
    prisma.whatsappTemplate.findFirst({
      where: { metaTemplateName: templateName, active: true },
      select: { metaTemplateName: true, languageCode: true, messagePreview: true, variables: true },
    }),
    prisma.messageLog.findFirst({
      where: {
        entityType: 'abandoned_checkout', entityId: checkout.id, templateName,
        status: { in: BLOCKING_DELIVERY_STATUSES },
      },
      select: { id: true },
    }),
    phone ? prisma.messageLog.findFirst({
      where: {
        normalizedPhone: phone,
        status: { in: BLOCKING_DELIVERY_STATUSES },
        OR: [
          { acceptedAt: { gte: new Date(now.getTime() - Math.max(env.ABANDONED_CART_COOLDOWN_HOURS, env.REMARKETING_GLOBAL_COOLDOWN_HOURS) * 3_600_000) } },
          { sentAt: { gte: new Date(now.getTime() - Math.max(env.ABANDONED_CART_COOLDOWN_HOURS, env.REMARKETING_GLOBAL_COOLDOWN_HOURS) * 3_600_000) } },
          { status: MessageStatus.unknown },
        ],
      },
      select: { id: true },
    }) : null,
    phone || checkout.customerEmail ? prisma.order.findMany({
      where: { OR: [
        ...(phone ? [{ normalizedPhone: phone }] : []),
        ...(checkout.customerEmail ? [{ customerEmail: checkout.customerEmail.trim().toLowerCase() }] : []),
      ] },
      select: { id: true, sourceCreatedAt: true, createdAt: true },
    }) : [],
  ])

  return evaluateFromFacts(checkout, {
    suppressed: Boolean(suppression), optedOut: Boolean(customer?.optOut), consentProven,
    template, existingForCheckout: Boolean(existingForCheckout), recentContact: Boolean(recentContact), matchingOrders,
  }, now)
}

export async function evaluateAbandonedCheckoutEligibilityBatch(
  checkouts: AbandonedCheckout[], now: Date = new Date()
): Promise<Array<AbandonedCheckoutEligibility | null>> {
  if (checkouts.length === 0) return []
  const phones = [...new Set(checkouts.map(c => c.normalizedPhone).filter((x): x is string => Boolean(x)))]
  const emails = [...new Set(checkouts.map(c => c.customerEmail?.trim().toLowerCase()).filter((x): x is string => Boolean(x)))]
  const ids = checkouts.map(c => c.id)
  const cutoff = new Date(now.getTime() - Math.max(env.ABANDONED_CART_COOLDOWN_HOURS, env.REMARKETING_GLOBAL_COOLDOWN_HOURS) * 3_600_000)
  const [template, suppressions, customers, consents, existing, recent, orders] = await Promise.all([
    prisma.whatsappTemplate.findFirst({ where: { metaTemplateName: env.ABANDONED_CART_TEMPLATE, active: true }, select: { metaTemplateName: true, languageCode: true, messagePreview: true, variables: true } }),
    phones.length ? prisma.suppression.findMany({ where: { normalizedPhone: { in: phones } }, select: { normalizedPhone: true } }) : [],
    phones.length ? prisma.customer.findMany({ where: { normalizedPhone: { in: phones } }, select: { normalizedPhone: true, optOut: true } }) : [],
    phones.length ? prisma.whatsappConsent.findMany({ where: { normalizedPhone: { in: phones }, scope: 'marketing' }, select: { normalizedPhone: true, consented: true, revokedAt: true, consentedAt: true } }) : [],
    prisma.messageLog.findMany({ where: { entityType: 'abandoned_checkout', entityId: { in: ids }, templateName: env.ABANDONED_CART_TEMPLATE, status: { in: BLOCKING_DELIVERY_STATUSES } }, select: { entityId: true } }),
    phones.length ? prisma.messageLog.findMany({ where: { normalizedPhone: { in: phones }, status: { in: BLOCKING_DELIVERY_STATUSES }, OR: [{ acceptedAt: { gte: cutoff } }, { sentAt: { gte: cutoff } }, { status: MessageStatus.unknown }] }, select: { normalizedPhone: true } }) : [],
    phones.length || emails.length ? prisma.order.findMany({ where: { OR: [...(phones.length ? [{ normalizedPhone: { in: phones } }] : []), ...(emails.length ? [{ customerEmail: { in: emails } }] : [])] }, select: { id: true, normalizedPhone: true, customerEmail: true, sourceCreatedAt: true, createdAt: true } }) : [],
  ])
  const suppressedPhones = new Set(suppressions.map(x => x.normalizedPhone))
  const firstCustomerByPhone = new Map<string, (typeof customers)[number]>()
  for (const customer of customers) if (!firstCustomerByPhone.has(customer.normalizedPhone)) firstCustomerByPhone.set(customer.normalizedPhone, customer)
  const consentedPhones = new Set(consents.filter(x => x.consented === true && x.revokedAt === null && x.consentedAt !== null).map(x => x.normalizedPhone))
  const existingIds = new Set(existing.map(x => x.entityId))
  const recentPhones = new Set(recent.map(x => x.normalizedPhone))
  const ordersByPhone = new Map<string, typeof orders>()
  const ordersByEmail = new Map<string, typeof orders>()
  for (const order of orders) {
    if (order.normalizedPhone) ordersByPhone.set(order.normalizedPhone, [...(ordersByPhone.get(order.normalizedPhone) ?? []), order])
    if (order.customerEmail) ordersByEmail.set(order.customerEmail, [...(ordersByEmail.get(order.customerEmail) ?? []), order])
  }
  return checkouts.map(checkout => {
    try {
      const phone = checkout.normalizedPhone || null
      const email = checkout.customerEmail?.trim().toLowerCase() || null
      const matching = [...new Map([...(phone ? ordersByPhone.get(phone) ?? [] : []), ...(email ? ordersByEmail.get(email) ?? [] : [])].map(x => [x.id, x])).values()]
      return evaluateFromFacts(checkout, {
        suppressed: Boolean(phone && suppressedPhones.has(phone)), optedOut: Boolean(phone && firstCustomerByPhone.get(phone)?.optOut),
        consentProven: Boolean(phone && consentedPhones.has(phone)), template,
        existingForCheckout: existingIds.has(checkout.id), recentContact: Boolean(phone && recentPhones.has(phone)), matchingOrders: matching,
      }, now)
    } catch {
      return null
    }
  })
}
