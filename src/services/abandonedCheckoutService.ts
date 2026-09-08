import { prisma } from '../config/prisma'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { addMinutes } from '../helpers/dateService'
import { customerService } from './customerService'
import { messageService } from './messageService'
import { AbandonedCheckout, AbandonedCheckoutStatus } from '@prisma/client'
import { evaluateAbandonedCheckoutEligibility } from './abandonedCheckoutEligibilityService'

// Formato esperado do payload da Nuvemshop
type NuvemshopCheckoutPayload = {
  id: number | string
  token?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  total?: string | number
  currency?: string
  products?: Array<{ name?: string; quantity?: number }>
  checkout_url?: string
  abandoned_checkout_url?: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

function nonEmpty(value?: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function normalizeEmail(value?: string | null): string | null {
  return nonEmpty(value)?.toLowerCase() ?? null
}

function safeDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function safeTotal(value?: string | number): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function buildProductsSummary(
  products?: Array<{ name?: string; quantity?: number }>
): string {
  if (!products || products.length === 0) return ''
  return products
    .slice(0, 3)
    .map((p) => (p.quantity && p.quantity > 1 ? `${p.quantity}x ${p.name}` : p.name ?? ''))
    .filter(Boolean)
    .join(', ')
}

export const abandonedCheckoutService = {
  async upsertAbandonedCheckout(
    payload: NuvemshopCheckoutPayload
  ): Promise<AbandonedCheckout> {
    const nuvemshopCheckoutId = String(payload.id)
    const customerName = nonEmpty(payload.contact_name)
    const customerEmail = normalizeEmail(payload.contact_email)
    const customerPhone = nonEmpty(payload.contact_phone)
    const normalizedPhone = normalizePhoneBrazil(customerPhone) ?? ''
    const total = safeTotal(payload.total)
    const currency = nonEmpty(payload.currency)?.toUpperCase() ?? null
    const productsSummary = buildProductsSummary(payload.products)
    const abandonedCheckoutUrl = nonEmpty(payload.abandoned_checkout_url) ?? nonEmpty(payload.checkout_url)
    const now = new Date()
    const sourceCreatedAt = safeDate(payload.created_at)
    const sourceUpdatedAt = safeDate(payload.updated_at)

    const existing = await prisma.abandonedCheckout.findUnique({
      where: { nuvemshopCheckoutId },
    })

    let customer = null
    if (normalizedPhone) {
      try {
        customer = await customerService.upsertCustomer({
          name: customerName ?? existing?.customerName ?? 'Cliente',
          email: customerEmail,
          phone: customerPhone,
          normalizedPhone,
          source: 'nuvemshop_abandoned_checkout',
        })
      } catch {
        // customer creation non-critical
      }
    }

    if (existing) {
      return prisma.abandonedCheckout.update({
        where: { id: existing.id },
        data: {
          customerName: customerName ?? undefined,
          customerEmail: customerEmail ?? undefined,
          customerPhone: customerPhone ?? undefined,
          normalizedPhone: normalizedPhone || undefined,
          total: total ?? undefined,
          currency: currency ?? undefined,
          productsSummary: productsSummary || undefined,
          abandonedCheckoutUrl: abandonedCheckoutUrl ?? undefined,
          sourceCreatedAt: sourceCreatedAt ?? undefined,
          sourceUpdatedAt: sourceUpdatedAt ?? undefined,
          collectedAt: now,
          lastSeenAt: now,
          rawPayload: payload as object,
          customerId: customer?.id ?? existing.customerId,
        },
      })
    }

    return prisma.abandonedCheckout.create({
      data: {
        nuvemshopCheckoutId,
        token: payload.token ?? null,
        customerId: customer?.id ?? null,
        customerName: customerName ?? 'Cliente',
        customerEmail,
        customerPhone,
        normalizedPhone,
        total: total ?? undefined,
        currency: currency ?? 'BRL',
        productsSummary,
        abandonedCheckoutUrl: abandonedCheckoutUrl ?? '',
        status: AbandonedCheckoutStatus.abandoned,
        rawPayload: payload as object,
        firstSeenAt: now,
        lastSeenAt: now,
        sourceCreatedAt,
        sourceUpdatedAt,
        collectedAt: now,
        source: 'nuvemshop_api',
      },
    })
  },

  async markConvertedByOrder(params: {
    normalizedPhone?: string
    email?: string
    orderCreatedAt: Date
    orderId?: string
  }): Promise<void> {
    const conditions: object[] = []
    if (params.normalizedPhone) conditions.push({ normalizedPhone: params.normalizedPhone })
    if (params.email) conditions.push({ customerEmail: params.email })
    if (conditions.length === 0) return

    const checkouts = await prisma.abandonedCheckout.findMany({
      where: {
        OR: conditions,
        status: AbandonedCheckoutStatus.abandoned,
        sourceCreatedAt: { not: null, lte: params.orderCreatedAt },
      },
    })

    for (const checkout of checkouts) {
      await prisma.abandonedCheckout.update({
        where: { id: checkout.id },
        data: {
          status: AbandonedCheckoutStatus.converted,
          convertedAt: params.orderCreatedAt,
          convertedOrderId: params.orderId ?? null,
        },
      })
      await messageService.skipPendingCheckoutLogs(checkout.id, 'converted_before_send')
    }
  },

  async hasOrderAfterCheckout(params: {
    normalizedPhone?: string
    email?: string
    checkoutCreatedAt: Date
  }): Promise<boolean> {
    const conditions: object[] = []
    if (params.normalizedPhone) conditions.push({ normalizedPhone: params.normalizedPhone })
    if (params.email) conditions.push({ customerEmail: params.email })
    if (conditions.length === 0) return false

    const order = await prisma.order.findFirst({
      where: {
        OR: conditions,
        sourceCreatedAt: { gte: params.checkoutCreatedAt },
      },
    })
    return !!order
  },

  async scheduleAbandonedCheckoutMessage(checkout: AbandonedCheckout): Promise<boolean> {
    const rule = await prisma.automationRule.findFirst({ where: { eventType: 'abandoned_checkout', active: true } })
    if (!rule) return false
    const eligibility = await evaluateAbandonedCheckoutEligibility(checkout)
    if (!eligibility.eligible || !eligibility.normalizedPhone) return false
    if (rule.templateName !== eligibility.templateName) return false
    if (await messageService.existsBlockingLog('abandoned_checkout', checkout.id, eligibility.templateName)) return false

    const customer = checkout.customerId
      ? await prisma.customer.findUnique({ where: { id: checkout.customerId } })
      : null

    await messageService.createPendingMessageIfNotExists({
      entityType: 'abandoned_checkout',
      entityId: checkout.id,
      customerId: customer?.id ?? null,
      normalizedPhone: checkout.normalizedPhone,
      templateName: eligibility.templateName,
      scheduledAt: addMinutes(checkout.abandonedAt ?? checkout.sourceUpdatedAt ?? checkout.sourceCreatedAt ?? new Date(), 0),
      source: 'sync_abandoned_checkouts',
    })

    return true
  },
}
