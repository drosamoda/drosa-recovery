import { Router, Request, Response } from 'express'
import { metaWebhookValidator } from '../middlewares/metaWebhookValidator'
import { webhookEventService } from '../services/webhookEventService'
import { messageService } from '../services/messageService'
import { customerService } from '../services/customerService'
import { inboxService } from '../services/inboxService'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { MessageStatus } from '@prisma/client'
import { env } from '../config/env'
import { logger } from '../config/logger'

const router = Router()

const OPT_OUT_KEYWORDS = [
  'parar',
  'sair',
  'cancelar',
  'remover',
  'não quero',
  'nao quero',
  'descadastrar',
  'stop',
]

function detectOptOut(text: string): boolean {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
  return OPT_OUT_KEYWORDS.some((kw) => normalized === kw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
}

// -----------------------------------------------------------------------
// GET — verificação do webhook pelo Meta (challenge)
// -----------------------------------------------------------------------
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string
  const token = req.query['hub.verify_token'] as string
  const challenge = req.query['hub.challenge'] as string

  if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN) {
    res.status(200).send(challenge)
    return
  }

  res.status(403).json({ error: 'Verificação falhou' })
})

// -----------------------------------------------------------------------
// POST — recebe eventos de status e mensagens do Meta
// -----------------------------------------------------------------------
router.post('/', metaWebhookValidator, async (req: Request, res: Response) => {
  const payload = req.body
  const headers = req.headers as Record<string, string | string[] | undefined>

  const eventId = await webhookEventService.save({
    provider: 'meta',
    hmacValid: true,
    rawPayload: payload,
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])
    ),
  })

  res.status(200).json({ received: true })

  setImmediate(() => {
    processMetaWebhook(payload, eventId).catch((err) => {
      logger.error('[webhook/meta] erro no processamento assíncrono', { error: String(err) })
      webhookEventService.markError(eventId, String(err)).catch(() => {})
    })
  })
})

async function processMetaWebhook(payload: unknown, eventId: string): Promise<void> {
  try {
    const result = await inboxService.saveInboundMessagesFromMetaPayload(payload)
    if (result.saved > 0) {
      logger.info('[webhook/meta] mensagens inbound salvas na inbox', result)
    }
  } catch (err) {
    logger.error('[webhook/meta] falha ao salvar mensagens na inbox', err)
  }

  const body = payload as Record<string, unknown>
  const entries = (body?.entry as unknown[]) ?? []

  for (const entry of entries) {
    const changes = ((entry as Record<string, unknown>)?.changes as unknown[]) ?? []
    for (const change of changes) {
      const value = (change as Record<string, unknown>)?.value as Record<string, unknown>
      if (!value) continue

      // ---- Atualizações de status de mensagens enviadas ----
      const statuses = (value.statuses as unknown[]) ?? []
      for (const statusObj of statuses) {
        const s = statusObj as Record<string, unknown>
        const metaMessageId = s.id as string
        const statusStr = s.status as string

        if (!metaMessageId || !statusStr) continue

        const statusMap: Record<string, MessageStatus> = {
          sent: MessageStatus.sent,
          delivered: MessageStatus.delivered,
          read: MessageStatus.read,
          failed: MessageStatus.failed,
        }

        const mappedStatus = statusMap[statusStr]
        if (!mappedStatus) continue

        const errorCode = (s.errors as Array<{ code?: number }>)?.[0]?.code
        await messageService.updateStatusByMetaMessageId(metaMessageId, mappedStatus, {
          response: s as object,
          errorCode: errorCode ? String(errorCode) : undefined,
          sentAt: mappedStatus === MessageStatus.sent ? new Date() : undefined,
        })
      }

      // ---- Mensagens recebidas (opt-out inbound) ----
      const messages = (value.messages as unknown[]) ?? []
      for (const msgObj of messages) {
        const msg = msgObj as Record<string, unknown>
        const text = (msg.text as Record<string, string>)?.body ?? ''
        const fromRaw = msg.from as string

        if (!fromRaw) continue

        // O número "from" da Meta já vem com código do país (ex: 5531...)
        const normalizedPhone = normalizePhoneBrazil(fromRaw) ?? fromRaw

        if (text && detectOptOut(text)) {
          await customerService.applyOptOutByPhone(normalizedPhone)
          logger.info('[webhook/meta] opt-out registrado via keyword inbound')
        }
      }
    }
  }

  await webhookEventService.markProcessed(eventId)
}

export default router
