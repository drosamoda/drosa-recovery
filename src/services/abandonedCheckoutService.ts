import { prisma } from '../config/prisma'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { addMinutes } from '../helpers/dateService'
import { customerService } from './customerService'
import { messageService } from './messageService'
import { AbandonedCheckout, AbandonedCheckoutStatus } from '@prisma/client'

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
    const customerName = payload.contact_name ?? 'Cliente'
    const customerEmail = payload.contact_email ?? null
    const customerPhone = payload.contact_phone ?? null
    const normalizedPhone = normalizePhoneBrazil(customerPhone) ?? ''
    const total = payload.total ? Number(payload.total) : null
    const currency = payload.currency ?? 'BRL'
    const productsSummary = buildProductsSummary(payload.products)
    const abandonedCheckoutUrl =
      payload.abandoned_checkout_url ?? payload.checkout_url ?? ''
    const now = new Date()
    const firstSeenAt = payload.created_at ? new Date(payload.created_at) : now

    const existing = await prisma.abandonedCheckout.findUnique({
      where: { nuvemshopCheckoutId },
    })

    let customer = null
    if (normalizedPhone) {
      try {
        customer = await customerService.upsertCustomer({
          name: customerName,
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
          customerName,
          customerEmail,
          customerPhone,
          normalizedPhone,
          total: total ?? undefined,
          productsSummary,
          abandonedCheckoutUrl,
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
        customerName,
        customerEmail,
        customerPhone,
        normalizedPhone,
        total: total ?? undefined,
        currency,
        productsSummary,
        abandonedCheckoutUrl,
        status: AbandonedCheckoutStatus.abandoned,
        rawPayload: payload as object,
        firstSeenAt,
        lastSeenAt: now,
        source: 'nuvemshop_api',
      },
    })
  },

  async markConvertedByOrder(params: {
    normalizedPhone?: string
    email?: string
    orderCreatedAt: Date
  }): Promise<void> {
    const conditions: object[] = []
    if (params.normalizedPhone) conditions.push({ normalizedPhone: params.normalizedPhone })
    if (params.email) conditions.push({ customerEmail: params.email })
    if (conditions.length === 0) return

    const checkouts = await prisma.abandonedCheckout.findMany({
      where: {
        OR: conditions,
        status: AbandonedCheckoutStatus.abandoned,
      },
    })

    for (const checkout of checkouts) {
      await prisma.abandonedCheckout.update({
        where: { id: checkout.id },
        data: {
          status: AbandonedCheckoutStatus.converted,
          convertedAt: params.orderCreatedAt,
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
        createdAt: { gte: params.checkoutCreatedAt },
      },
    })
    return !!order
  },

  async scheduleAbandonedCheckoutMessage(checkout: AbandonedCheckout): Promise<boolean> {
    if (!checkout.normalizedPhone) return false

    const isOptOut = await customerService.isOptOut(checkout.normalizedPhone)
    if (isOptOut) return false

    const rule = await prisma.automationRule.findFirst({
      where: { eventType: 'abandoned_checkout', active: true },
    })
    if (!rule) return false

    const template = await prisma.whatsappTemplate.findFirst({
      where: { metaTemplateName: rule.templateName, active: true },
    })
    if (!template) return false

    const hasPosteriorOrder = await abandonedCheckoutService.hasOrderAfterCheckout({
      normalizedPhone: checkout.normalizedPhone,
      email: checkout.customerEmail ?? undefined,
      checkoutCreatedAt: checkout.firstSeenAt,
    })
    if (hasPosteriorOrder) {
      await prisma.abandonedCheckout.update({
        where: { id: checkout.id },
        data: { status: AbandonedCheckoutStatus.converted, convertedAt: new Date() },
      })
      return false
    }

    const alreadyBlocked = await messageService.existsBlockingLog(
      'abandoned_checkout',
      checkout.id,
      rule.templateName
    )
    if (alreadyBlocked) return false

    const customer = checkout.customerId
      ? await prisma.customer.findUnique({ where: { id: checkout.customerId } })
      : null

    await messageService.createPendingMessageIfNotExists({
      entityType: 'abandoned_checkout',
      entityId: checkout.id,
      customerId: customer?.id ?? null,
      normalizedPhone: checkout.normalizedPhone,
      templateName: rule.templateName,
      scheduledAt: addMinutes(new Date(), rule.delayMinutes),
      source: 'sync_abandoned_checkouts',
    })

    return true
  },
}
