import { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '../config/env'
import { logger } from '../config/logger'

export function nuvemshopWebhookValidator(req: Request, res: Response, next: NextFunction): void {
  const secret = env.WEBHOOK_SECRET

  if (!secret) {
    if (env.NODE_ENV === 'development') {
      logger.warn('[nuvemshop] WEBHOOK_SECRET não configurado — bypass em desenvolvimento')
      next()
      return
    }
    logger.error('[nuvemshop] WEBHOOK_SECRET não configurado em produção')
    res.status(401).json({ error: 'Webhook não autorizado' })
    return
  }

  const signature =
    (req.headers['x-linkedstore-hmac-sha256'] as string | undefined) ??
    (req.headers['http_x_linkedstore_hmac_sha256'] as string | undefined)

  if (!signature) {
    res.status(401).json({ error: 'Assinatura ausente' })
    return
  }

  const rawBody = req.rawBody
  if (!rawBody) {
    res.status(400).json({ error: 'Body inválido' })
    return
  }

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')

  let valid = false
  try {
    valid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    valid = false
  }

  if (!valid) {
    res.status(401).json({ error: 'Assinatura inválida' })
    return
  }

  next()
}
