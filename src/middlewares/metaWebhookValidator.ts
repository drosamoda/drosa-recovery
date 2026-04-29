import { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '../config/env'
import { logger } from '../config/logger'

export function metaWebhookValidator(req: Request, res: Response, next: NextFunction): void {
  const secret = env.META_APP_SECRET

  if (!secret) {
    if (env.NODE_ENV === 'development') {
      logger.warn('[meta] META_APP_SECRET não configurado — bypass em desenvolvimento')
      next()
      return
    }
    logger.error('[meta] META_APP_SECRET não configurado em produção')
    res.status(401).json({ error: 'Webhook não autorizado' })
    return
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined

  if (!signature) {
    res.status(401).json({ error: 'Assinatura ausente' })
    return
  }

  const rawBody = req.rawBody
  if (!rawBody) {
    res.status(400).json({ error: 'Body inválido' })
    return
  }

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`

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
