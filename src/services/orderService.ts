import { prisma } from '../config/prisma'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { addMinutes } from '../helpers/dateService'
import { customerService } from './customerService'
import { messageService } from './messageService'
import { webhookEventService } from './webhookEventService'
import { AbandonedCheckoutStatus } from '@prisma/client'
import { logger } from '../config/logger'

// Formato esperado do payload de pedido da Nuvemshop
type NuvemshopOrderPayload = {
  id: number | string
  number: number | string
  status: string
  payment_status: string
  payment_details?: { method?: string }
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  total: string | number
  currency?: string
  checkout_url?: string
  [key: string]: unknown
}

type HandleWebhookParams = {
  payload: NuvemshopOrderPayload
  headers: Record<string, string | string[] | undefined>
  webhookEventId: string
}

export const orderService = {
  async handleNuvemshopOrderWebhook(params: HandleWebhookParams): Promise<void> {
    const { payload, webhookEventId } = params

    const nuvemshopOrderId = String(payload.id)
    const orderNumber = String(payload.number)
    const customerName = payload.contact_name ?? 'Cliente'
    const customerEmail = payload.contact_email ?? null
    const customerPhone = payload.contact_phone ?? null
    const normalizedPhone = normalizePhoneBrazil(customerPhone) ?? ''
    const total = Number(payload.total) || 0
    const currency = payload.currency ?? 'BRL'
    const paymentStatus = payload.payment_status ?? 'pending'
    const paymentMethod = payload.payment_details?.method ?? null
    const status = payload.status ?? 'open'
    const orderUrl = payload.checkout_url ?? null
    const webhookTopic = (params.headers['x-linkedstore-topic'] as string) ?? null

    try {
      // Upsert do customer fora da transação (não aceita tx como parâmetro)
      const customer = await customerService.upsertCustomer({
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        normalizedPhone,
        source: 'nuvemshop_webhook',
      })

      // ----------------------------------------------------------------
      // Transação: order → converter carrinhos → agendar msg
      // ----------------------------------------------------------------
      await prisma.$transaction(async (tx) => {
        // 2. Upsert order (idempotência por nuvemshop_order_id)
        const existingOrder = await tx.order.findUnique({
          where: { nuvemshopOrderId },
        })

        let order
        if (existingOrder) {
          order = await tx.order.update({
            where: { id: existingOrder.id },
            data: {
              status,
              paymentStatus,
              paymentMethod,
              total,
              orderUrl,
              webhookTopic,
              rawPayload: payload as object,
            },
          })
        } else {
          order = await tx.order.create({
            data: {
              nuvemshopOrderId,
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
              webhookTopic,
              rawPayload: payload as object,
              source: 'nuvemshop_webhook',
            },
          })
        }

        // 3. Marcar carrinhos abandonados como convertidos
        const matchConditions = []
        if (normalizedPhone) matchConditions.push({ normalizedPhone })
        if (customerEmail) matchConditions.push({ customerEmail })

        if (matchConditions.length > 0) {
          const checkoutsToConvert = await tx.abandonedCheckout.findMany({
            where: {
              OR: matchConditions,
              status: AbandonedCheckoutStatus.abandoned,
            },
          })

          for (const checkout of checkoutsToConvert) {
            await tx.abandonedCheckout.update({
              where: { id: checkout.id },
              data: {
                status: AbandonedCheckoutStatus.converted,
                convertedAt: new Date(),
              },
            })

            // Cancela message_logs pending desse carrinho
            await messageService.skipPendingCheckoutLogs(
              checkout.id,
              'converted_before_send'
            )
          }
        }

        // 4. Agendar mensagem de confirmação de pedido
        // Só agenda se for um pedido novo (não atualização)
        if (!existingOrder && normalizedPhone) {
          const rule = await tx.automationRule.findFirst({
            where: { eventType: 'order_created', active: true },
          })

          const template = rule
            ? await tx.whatsappTemplate.findFirst({
                where: { metaTemplateName: rule.templateName, active: true },
              })
            : null

          if (rule && template && !customer.optOut) {
            const alreadyBlocked = await messageService.existsBlockingLog(
              'order',
              order.id,
              rule.templateName
            )

            if (!alreadyBlocked) {
              await messageService.createPendingMessageIfNotExists({
                entityType: 'order',
                entityId: order.id,
                customerId: customer.id,
                normalizedPhone,
                templateName: rule.templateName,
                scheduledAt: addMinutes(new Date(), rule.delayMinutes),
                source: 'nuvemshop_webhook',
              })
            }
          }
        }
      })

      await webhookEventService.markProcessed(webhookEventId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('[orderService] erro ao processar pedido', { nuvemshopOrderId, error: msg })
      await webhookEventService.markError(webhookEventId, msg)
    }
  },
}
