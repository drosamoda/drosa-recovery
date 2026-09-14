import { AbandonedCheckoutStatus, MessageStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { NuvemshopOrder, nuvemshopService } from '../services/nuvemshopService'

export type NuvemshopOrdersBackfillResult = {
  found: number
  created: number
  updated: number
  customersUpserted: number
  converted: number
  errors: number
  messagesScheduled: 0
}

type BackfillOptions = {
  from: Date
  to: Date
  scheduleMessages?: false
}

function sourceDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function upsertCustomer(payload: NuvemshopOrder, normalizedPhone: string) {
  const email = payload.contact_email?.trim() || null
  const phone = payload.contact_phone?.trim() || null
  const name = payload.contact_name?.trim() || 'Cliente'
  const identity = [
    ...(normalizedPhone ? [{ normalizedPhone }] : []),
    ...(email ? [{ email }] : []),
  ]

  const existing = identity.length > 0
    ? await prisma.customer.findFirst({ where: { OR: identity } })
    : null

  if (existing) {
    return prisma.customer.update({
      where: { id: existing.id },
      data: {
        name: name.length > existing.name.trim().length ? name : existing.name,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        ...(normalizedPhone ? { normalizedPhone } : {}),
      },
    })
  }

  return prisma.customer.create({
    data: {
      name,
      email,
      phone,
      normalizedPhone,
      optOut: false,
      source: 'nuvemshop_orders_backfill',
    },
  })
}

async function persistOrder(payload: NuvemshopOrder): Promise<{ created: boolean; converted: number }> {
  const nuvemshopOrderId = String(payload.id)
  const orderNumber = String(payload.number ?? payload.id)
  const customerName = payload.contact_name?.trim() || 'Cliente'
  const customerEmail = payload.contact_email?.trim() || null
  const customerPhone = payload.contact_phone?.trim() || null
  const normalizedPhone = normalizePhoneBrazil(customerPhone) ?? ''
  const total = Number(payload.total) || 0
  const currency = payload.currency ?? 'BRL'
  const paymentStatus = payload.payment_status ?? 'pending'
  const paymentMethod = payload.payment_details?.method ?? null
  const status = payload.status ?? 'open'
  const orderUrl = payload.checkout_url ?? null
  const sourceCreatedAt = sourceDate(payload.created_at)
  const sourceUpdatedAt = sourceDate(payload.updated_at)
  const customer = await upsertCustomer(payload, normalizedPhone)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { nuvemshopOrderId } })
    const data = {
      orderNumber,
      customerId: customer.id,
      customerName,
      customerEmail,
      customerPhone,
      normalizedPhone,
      total,
      currency,
      paymentStatus,
      paymentMethod,
      status,
      orderUrl,
      rawPayload: payload as object,
      source: 'nuvemshop_orders_backfill',
      sourceCreatedAt,
      sourceUpdatedAt,
    }
    const saved = existing
      ? await tx.order.update({ where: { id: existing.id }, data })
      : await tx.order.create({ data: { nuvemshopOrderId, ...data } })

    let converted = 0
    if (sourceCreatedAt && (normalizedPhone || customerEmail)) {
      const checkouts = await tx.abandonedCheckout.findMany({
        where: {
          OR: [
            ...(normalizedPhone ? [{ normalizedPhone }] : []),
            ...(customerEmail ? [{ customerEmail }] : []),
          ],
          status: AbandonedCheckoutStatus.abandoned,
          sourceCreatedAt: { not: null, lte: sourceCreatedAt },
        },
        select: { id: true },
      })
      for (const checkout of checkouts) {
        await tx.abandonedCheckout.update({
          where: { id: checkout.id },
          data: {
            status: AbandonedCheckoutStatus.converted,
            convertedAt: sourceCreatedAt,
            convertedOrderId: saved.id,
          },
        })
        await tx.messageLog.updateMany({
          where: {
            entityId: checkout.id,
            status: MessageStatus.pending,
          },
          data: { status: MessageStatus.skipped, reason: 'converted_before_send' },
        })
        converted++
      }
    }

    return { created: !existing, converted }
  })
}

export async function runBackfillNuvemshopOrders(
  options: BackfillOptions
): Promise<NuvemshopOrdersBackfillResult> {
  if (options.scheduleMessages !== undefined && options.scheduleMessages !== false) {
    throw new Error('historical_message_scheduling_forbidden')
  }
  if (!(options.from instanceof Date) || Number.isNaN(options.from.getTime()) ||
      !(options.to instanceof Date) || Number.isNaN(options.to.getTime()) || options.from > options.to) {
    throw new Error('invalid_backfill_period')
  }

  const result: NuvemshopOrdersBackfillResult = {
    found: 0,
    created: 0,
    updated: 0,
    customersUpserted: 0,
    converted: 0,
    errors: 0,
    messagesScheduled: 0,
  }
  const orders = await nuvemshopService.fetchOrders({ createdAtMin: options.from, createdAtMax: options.to })
  result.found = orders.length

  for (const payload of orders) {
    try {
      const saved = await persistOrder(payload)
      result.customersUpserted++
      result.converted += saved.converted
      if (saved.created) result.created++
      else result.updated++
    } catch (error) {
      result.errors++
      logger.error('[backfillNuvemshopOrders] pedido falhou', {
        orderId: String(payload.id),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  logger.info('[backfillNuvemshopOrders] concluido', result)
  return result
}
