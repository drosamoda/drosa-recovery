import { Router, Request, Response } from 'express'
import { ConversationStatus } from '@prisma/client'
import { inboxService } from '../services/inboxService'
import { env } from '../config/env'

const router = Router()

const VALID_STATUSES = new Set<string>([
  ConversationStatus.open,
  ConversationStatus.pending,
  ConversationStatus.closed,
])

function validateDevSimulationAccess(req: Request, res: Response): boolean {
  if (env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Rota nao encontrada' })
    return false
  }

  const secret = req.headers['x-inbox-admin-secret']
  if (!env.INBOX_ADMIN_SECRET || secret !== env.INBOX_ADMIN_SECRET) {
    res.status(401).json({ error: 'Nao autorizado' })
    return false
  }

  return true
}

router.post('/dev/simulate-inbound', async (req: Request, res: Response) => {
  if (!validateDevSimulationAccess(req, res)) return

  const { phone, name, text } = req.body as {
    phone?: string
    name?: string
    text?: string
  }

  if (!phone || !text || !text.trim()) {
    res.status(400).json({ error: 'Campos "phone" e "text" sao obrigatorios' })
    return
  }

  const result = await inboxService.saveSimulatedInboundMessage({
    phone,
    name,
    text: text.trim(),
  })

  res.status(201).json({ success: true, data: result })
})

router.get('/conversations', async (_req: Request, res: Response) => {
  const conversations = await inboxService.listConversations()
  res.json({ count: conversations.length, data: conversations })
})

router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  const messages = await inboxService.listMessages(req.params.id)
  res.json({ count: messages.length, data: messages })
})

router.patch('/conversations/:id', async (req: Request, res: Response) => {
  const { status, assignedTo } = req.body as {
    status?: string
    assignedTo?: string | null
  }

  if (status !== undefined && !VALID_STATUSES.has(status)) {
    res.status(400).json({ error: 'Status invalido' })
    return
  }

  const conversation = await inboxService.updateConversation(req.params.id, {
    status: status as ConversationStatus | undefined,
    assignedTo,
  })

  res.json(conversation)
})

router.post('/conversations/:id/messages', async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string }

  if (!text || !text.trim()) {
    res.status(400).json({ error: 'Campo "text" e obrigatorio' })
    return
  }

  const result = await inboxService.sendManualTextMessage(req.params.id, text.trim())

  if (!result.success) {
    res.status(result.statusCode).json({ error: result.error })
    return
  }

  res.status(201).json({ success: true, dryRun: result.dryRun, data: result.message })
})

export default router
