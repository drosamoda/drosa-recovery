import { prisma } from '../config/prisma'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { addMinutes } from '../helpers/dateService'
import { customerService } from './customerService'
import { messageService } from './messageService'
import { webhookEventService } from './webhookEventService'
import { nuvemshopService } from './nuvemshopService'
import { AbandonedCheckoutStatus, EventType } from '@prisma/client'
import { logger } from '../config/logger'

// Formato esperado do payload de pedido da Nuvemshop
type NuvemshopOrderPayload = {
  id: number | string
  number?: number | string
  status?: string
  event?: string
  payment_status?: string
  payment_details?: { method?: string }
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  total?: string | number
  currency?: string
  checkout_url?: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

type HandleWebhookParams = {
  payload: NuvemshopOrderPayload
  headers: Record<string, string | string[] | undefined>
  webhookEventId: string
}

// Detecta tipo de pagamento a partir do campo payment_details.method
export function detectPaymentType(method: string | null | undefined): 'boleto' | 'pix' | 'other' {
  if (!method) return 'other'
  const m = method.toLowerCase()
  if (m.includes('boleto') || m.includes('ticket')) return 'boleto'
  if (m.includes('pix')) return 'pix'
  return 'other'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function needsFullOrderFetch(payload: NuvemshopOrderPayload): boolean {
  return !payload.contact_phone || !payload.contact_name || !payload.status || !payload.payment_status || !payload.total
}

function asOrderPayload(value: unknown): NuvemshopOrderPayload {
  if (!isRecord(value) || value.id === undefined || value.id === null || value.id === '') {
    throw new Error('Pedido Nuvemshop completo invalido ou sem id')
  }

  return value as NuvemshopOrderPayload
}

function safeSourceDate(value?: string): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function resolveOrderPayload(
  payload: NuvemshopOrderPayload
): Promise<{ payload: NuvemshopOrderPayload; fetched: boolean }> {
  if (!needsFullOrderFetch(payload)) return { payload, fetched: false }

  const nuvemshopOrderId = String(payload.id)
  logger.info('[orderService] buscando detalhes do pedido Nuvemshop', {
    nuvemshopOrderId,
    reason: 'payload_resumido',
  })

  return {
    payload: asOrderPayload(await nuvemshopService.fetchOrderById(nuvemshopOrderId)),
    fetched: true,
  }
}

// Agenda mensagem para um pedido dado um EventType — idempotente via chave única
async function scheduleOrderMessage(
  orderId: string,
  customerId: string,
  customerOptOut: boolean,
  normalizedPhone: string,
  eventType: EventType
): Promise<void> {
  if (customerOptOut) return

  const rule = await prisma.automationRule.findFirst({
    where: { eventType, active: true },
  })
  if (!rule) return

  const template = await prisma.whatsappTemplate.findFirst({
    where: { metaTemplateName: rule.templateName, active: true },
  })
  if (!template) return

  const alreadyBlocked = await messageService.existsBlockingLog('order', orderId, rule.templateName)
  if (alreadyBlocked) return

  await messageService.createPendingMessageIfNotExists({
    entityType: 'order',
    entityId: orderId,
    customerId,
    normalizedPhone,
    templateName: rule.templateName,
    scheduledAt: addMinutes(new Date(), rule.delayMinutes),
    source: 'nuvemshop_webhook',
  })

  logger.info('[orderService] mensagem agendada', { orderId, eventType, templateName: rule.templateName })
}

export const orderService = {
  async handleNuvemshopOrderWebhook(params: HandleWebhookParams): Promise<void> {
    const { webhookEventId } = params
    const initialPayload = params.payload
    const nuvemshopOrderId = String(initialPayload.id)

    try {
      const resolved = await resolveOrderPayload(initialPayload)
      const payload = resolved.payload
      const rawPayloadForOrder = resolved.fetched
        ? {
            originalWebhookPayload: initialPayload,
            fetchedOrderPayload: payload,
          }
        : payload
      const orderNumber = String(payload.number ?? payload.id)
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
      const webhookTopic = ((params.headers['x-linkedstore-topic'] as string | undefined) ?? payload.event) ?? null
      const paymentType = detectPaymentType(paymentMethod)
      const sourceCreatedAt = safeSourceDate(payload.created_at)
      const sourceUpdatedAt = safeSourceDate(payload.updated_at)

      // Upsert do customer fora da transação (não aceita tx como parâmetro)
      const customer = await customerService.upsertCustomer({
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        normalizedPhone,
        source: 'nuvemshop_webhook',
      })

      // ----------------------------------------------------------------
      // Transação: order → converter carrinhos
      // ----------------------------------------------------------------
      const { savedOrderId, isNew } = await prisma.$transaction(async (tx) => {
        const existingOrder = await tx.order.findUnique({
          where: { nuvemshopOrderId },
        })

        let savedOrder: { id: string }
        let isNew = false

        if (existingOrder) {
          savedOrder = await tx.order.update({
            where: { id: existingOrder.id },
            data: {
              status,
              paymentStatus,
              paymentMethod,
              total,
              orderUrl,
              webhookTopic,
              rawPayload: rawPayloadForOrder as object,
              sourceCreatedAt: sourceCreatedAt ?? undefined,
              sourceUpdatedAt: sourceUpdatedAt ?? undefined,
            },
          })
        } else {
          isNew = true
          savedOrder = await tx.order.create({
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
              rawPayload: rawPayloadForOrder as object,
              source: 'nuvemshop_webhook',
              sourceCreatedAt,
              sourceUpdatedAt,
            },
          })
        }

        // Marcar carrinhos abandonados como convertidos
        const matchConditions = []
        if (normalizedPhone) matchConditions.push({ normalizedPhone })
        if (customerEmail) matchConditions.push({ customerEmail })

        if (matchConditions.length > 0 && sourceCreatedAt) {
          const checkoutsToConvert = await tx.abandonedCheckout.findMany({
            where: {
              OR: matchConditions,
              status: AbandonedCheckoutStatus.abandoned,
              sourceCreatedAt: { not: null, lte: sourceCreatedAt },
            },
          })

          for (const checkout of checkoutsToConvert) {
            await tx.abandonedCheckout.update({
              where: { id: checkout.id },
              data: {
                status: AbandonedCheckoutStatus.converted,
                convertedAt: sourceCreatedAt,
                convertedOrderId: savedOrder.id,
              },
            })

            await messageService.skipPendingCheckoutLogs(
              checkout.id,
              'converted_before_send'
            )
          }
        }

        return { savedOrderId: savedOrder.id, isNew }
      })

      // ----------------------------------------------------------------
      // Agendar mensagens — fora da transação, protegido por idempotencyKey
      // ----------------------------------------------------------------
      if (!normalizedPhone) {
        logger.warn('[orderService] pedido sem telefone normalizado, mensagem nao agendada', {
          nuvemshopOrderId,
          savedOrderId,
          reason: 'missing_phone',
        })
      } else {
        if (isNew) {
          // Pedido novo — escolhe evento pelo método de pagamento
          let newOrderEvent: EventType
          if (paymentType === 'boleto') {
            newOrderEvent = EventType.order_created_boleto
          } else if (paymentType === 'pix') {
            newOrderEvent = EventType.order_created_pix
          } else {
            newOrderEvent = EventType.order_created
          }
          await scheduleOrderMessage(savedOrderId, customer.id, customer.optOut, normalizedPhone, newOrderEvent)
        } else {
          // Pedido atualizado — verifica transições de status
          if (paymentStatus === 'rejected') {
            await scheduleOrderMessage(savedOrderId, customer.id, customer.optOut, normalizedPhone, EventType.payment_rejected)
          }
          if (status === 'cancelled' && paymentType === 'pix') {
            await scheduleOrderMessage(savedOrderId, customer.id, customer.optOut, normalizedPhone, EventType.pix_cancelled)
          }
        }
      }

      await webhookEventService.markProcessed(webhookEventId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const statusHttp = isRecord(err) && isRecord(err.response) ? err.response.status : undefined
      logger.error('[orderService] erro ao processar pedido', err, {
        nuvemshopOrderId,
        ...(statusHttp ? { statusHttp } : {}),
      })
      await webhookEventService.markError(webhookEventId, msg)
    }
  },
}
