import { Router, Request, Response, NextFunction } from 'express'
import axios from 'axios'
import { nuvemshopWebhookValidator } from '../middlewares/nuvemshopWebhookValidator'
import { webhookEventService } from '../services/webhookEventService'
import { orderService } from '../services/orderService'
import { logger } from '../config/logger'
import { env } from '../config/env'

const router = Router()

function getNuvemshopOrderId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const id = (payload as { id?: unknown }).id
  return id === undefined || id === null || id === '' ? undefined : String(id)
}

function validateNuvemshopOrderPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Body deve ser um objeto JSON'
  }

  if (!getNuvemshopOrderId(payload)) {
    return 'Campo id do pedido ausente'
  }

  return null
}

// ── OAuth callback — troca code por access_token ───────────────────
router.get('/oauth', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined

  if (!code) {
    res.status(400).json({ error: 'Parâmetro code ausente' })
    return
  }

  try {
    const response = await axios.post(
      'https://www.nuvemshop.com.br/apps/authorize/token',
      {
        client_id: env.NUVEMSHOP_CLIENT_ID,
        client_secret: env.NUVEMSHOP_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      },
      { headers: { 'Content-Type': 'application/json' } }
    )

    const { access_token, user_id } = response.data as { access_token: string; user_id: number }

    logger.info('[oauth/nuvemshop] token obtido com sucesso', { user_id })

    // Exibe o token na resposta para o admin copiar e configurar no Railway
    res.status(200).json({
      ok: true,
      message: 'Copie o access_token abaixo e adicione como NUVEMSHOP_ACCESS_TOKEN no Railway',
      access_token,
      user_id,
    })
  } catch (err) {
    logger.error('[oauth/nuvemshop] erro ao trocar code por token', { error: String(err) })
    res.status(500).json({ error: 'Falha ao obter token', detail: String(err) })
  }
})

router.post('/orders', nuvemshopWebhookValidator, async (req: Request, res: Response) => {
  const payload = req.body
  const headers = req.headers as Record<string, string | string[] | undefined>
  const topic = ((headers['x-linkedstore-topic'] as string | undefined) ?? (payload as { event?: string })?.event) ?? undefined
  const externalId = getNuvemshopOrderId(payload)
  const payloadError = validateNuvemshopOrderPayload(payload)

  if (payloadError) {
    logger.warn('[webhook/nuvemshop] payload invalido', {
      nuvemshopOrderId: externalId,
      details: payloadError,
    })
    res.status(400).json({ error: 'Payload inválido', details: payloadError })
    return
  }

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

router.use('/orders', (err: Error, req: Request, res: Response, _next: NextFunction) => {
  const nuvemshopOrderId = getNuvemshopOrderId(req.body)
  const details = err instanceof Error ? err.message : String(err)

  logger.error('[webhook/nuvemshop] erro ao receber pedido', {
    nuvemshopOrderId,
    error: details,
  })

  if (res.headersSent) return
  res.status(400).json({ error: 'Payload inválido', details })
})

export default router
