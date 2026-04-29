import { Router, Request, Response } from 'express'
import { nuvemshopWebhookValidator } from '../middlewares/nuvemshopWebhookValidator'
import { webhookEventService } from '../services/webhookEventService'
import { orderService } from '../services/orderService'
import { logger } from '../config/logger'

const router = Router()

router.post('/orders', nuvemshopWebhookValidator, async (req: Request, res: Response) => {
  const payload = req.body
  const headers = req.headers as Record<string, string | string[] | undefined>
  const topic = (headers['x-linkedstore-topic'] as string) ?? undefined
  const externalId = payload?.id ? String(payload.id) : undefined

  // Salva evento imediatamente e responde 200 — processamento é assíncrono
  const eventId = await webhookEventService.save({
    provider: 'nuvemshop',
    topic,
    externalId,
    hmacValid: true,
    rawPayload: payload,
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])
    ),
  })

  res.status(200).json({ received: true })

  // Processamento assíncrono — nunca bloqueia a resposta HTTP
  setImmediate(() => {
    orderService
      .handleNuvemshopOrderWebhook({ payload, headers, webhookEventId: eventId })
      .catch((err) => {
        logger.error('[webhook/nuvemshop] erro no processamento assíncrono', { error: String(err) })
        webhookEventService.markError(eventId, String(err)).catch(() => {})
      })
  })
})

export default router
