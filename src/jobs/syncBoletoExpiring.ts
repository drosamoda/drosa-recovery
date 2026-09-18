import { prisma } from '../config/prisma'
import { messageService } from '../services/messageService'
import { detectPaymentType } from '../services/orderService'
import { addMinutes } from '../helpers/dateService'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { EventType } from '@prisma/client'

export type BoletoExpiringResult = {
  found: number
  scheduled: number
}

export async function runSyncBoletoExpiring(): Promise<BoletoExpiringResult> {
  const result: BoletoExpiringResult = { found: 0, scheduled: 0 }

  const now = new Date()
  const notifyMs = env.BOLETO_NOTIFY_HOURS * 60 * 60 * 1000
  const cronWindowMs = env.CRON_BOLETO_EXPIRING_INTERVAL * 60 * 1000

  // Usa sourceCreatedAt (horário original na Nuvemshop), nunca createdAt
  // (horário de ingestão no CRM). Isso evita lembrar boleto antigo como se
  // tivesse acabado de nascer após backfill/importação. Registros legados sem
  // sourceCreatedAt ficam fora do fluxo (fail closed).
  // Janela: [now - NOTIFY_HOURS - CRON_INTERVAL, now - NOTIFY_HOURS].
  const createdTo = new Date(now.getTime() - notifyMs)
  const createdFrom = new Date(createdTo.getTime() - cronWindowMs)

  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: 'pending',
      sourceCreatedAt: { gte: createdFrom, lte: createdTo },
    },
    include: { customer: true },
  })

  const boletoOrders = orders.filter((o) => detectPaymentType(o.paymentMethod) === 'boleto')
  result.found = boletoOrders.length

  if (boletoOrders.length === 0) return result

  const rule = await prisma.automationRule.findFirst({
    where: { eventType: EventType.boleto_expiring, active: true },
  })
  if (!rule) return result

  const template = await prisma.whatsappTemplate.findFirst({
    where: { metaTemplateName: rule.templateName, active: true },
  })
  if (!template) return result

  for (const order of boletoOrders) {
    if (!order.normalizedPhone) continue
    if (order.customer?.optOut) continue

    const alreadyBlocked = await messageService.existsBlockingLog(
      'order',
      order.id,
      rule.templateName
    )
    if (alreadyBlocked) continue

    await messageService.createPendingMessageIfNotExists({
      entityType: 'order',
      entityId: order.id,
      customerId: order.customerId,
      normalizedPhone: order.normalizedPhone,
      templateName: rule.templateName,
      scheduledAt: addMinutes(new Date(), rule.delayMinutes),
      source: 'sync_boleto_expiring',
    })

    result.scheduled++
    logger.info('[syncBoletoExpiring] lembrete agendado', { orderId: order.id })
  }

  return result
}
