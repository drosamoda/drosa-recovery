import { AbandonedCheckout, MessageStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { isValidBrazilianPhone } from '../helpers/phoneService'
import { renderTemplatePreview } from '../helpers/inboxTemplatePreview'

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

export async function evaluateAbandonedCheckoutEligibility(
  checkout: AbandonedCheckout,
  now: Date = new Date()
): Promise<AbandonedCheckoutEligibility> {
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

  const [suppression, customer, template, existingForCheckout, recentContact, matchingOrders] = await Promise.all([
    phone ? prisma.suppression.findUnique({ where: { normalizedPhone: phone }, select: { id: true } }) : null,
    phone ? prisma.customer.findFirst({ where: { normalizedPhone: phone }, select: { optOut: true } }) : null,
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
      select: { id: true, sourceCreatedAt: true },
    }) : [],
  ])

  if (suppression || customer?.optOut) reasons.push('opt_out')
  if (!template) reasons.push('invalid_template')
  if (existingForCheckout) reasons.push('already_sent')
  if (recentContact) reasons.push('cooldown_active')

  if (checkout.sourceCreatedAt && matchingOrders.length > 0) {
    if (matchingOrders.some((order) => !order.sourceCreatedAt)) {
      reasons.push('order_timing_uncertain')
    } else if (matchingOrders.some((order) => order.sourceCreatedAt! >= checkout.sourceCreatedAt!)) {
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
