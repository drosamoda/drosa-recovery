import { Request, Response, Router } from 'express'
import { logger } from '../config/logger'
import { InvalidWebhookSignatureError, MalformedWebhookPayloadError } from '../services/emailProviderAdapter'
import { getEmailProviderAdapter } from '../services/emailProviderFactory'
import { ingestProviderWebhook } from '../services/emailTrackingService'

const router = Router()

router.post('/resend', async (req: Request, res: Response) => {
  const adapter = getEmailProviderAdapter()
  if (adapter === null) {
    res.status(503).json({ error: 'EMAIL_PROVIDER_NOT_CONFIGURED' })
    return
  }

  try {
    const summary = await ingestProviderWebhook(adapter, {
      rawBody: req.rawBody ?? '',
      headers: {
        'svix-id': req.get('svix-id') ?? undefined,
        'svix-timestamp': req.get('svix-timestamp') ?? undefined,
        'svix-signature': req.get('svix-signature') ?? undefined,
      },
    })

    res.status(200).json({ ok: true, ...summary })
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError || error instanceof MalformedWebhookPayloadError) {
      logger.warn('[email/webhook] evento rejeitado', { errorName: error.name })
      res.status(400).json({ error: 'INVALID_EMAIL_WEBHOOK' })
      return
    }

    logger.error('[email/webhook] falha ao processar evento', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    res.status(500).json({ error: 'EMAIL_WEBHOOK_PROCESSING_FAILED' })
  }
})

export default router
