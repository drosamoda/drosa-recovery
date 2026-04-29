import { Router, Request, Response } from 'express'
import { prisma } from '../config/prisma'
import { Prisma, MessageStatus, EntityType, WebhookProvider } from '@prisma/client'

const router = Router()

const DEFAULT_LIMIT = 50

// -----------------------------------------------------------------------
// GET /admin/health
// -----------------------------------------------------------------------
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'drosa-recovery',
    timestamp: new Date().toISOString(),
  })
})

// -----------------------------------------------------------------------
// GET /admin/orders
// -----------------------------------------------------------------------
router.get('/orders', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: DEFAULT_LIMIT,
    select: {
      id: true,
      nuvemshopOrderId: true,
      orderNumber: true,
      customerName: true,
      customerEmail: true,
      normalizedPhone: true,
      total: true,
      currency: true,
      paymentStatus: true,
      paymentMethod: true,
      status: true,
      webhookTopic: true,
      source: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  res.json({ count: orders.length, data: orders })
})

// -----------------------------------------------------------------------
// GET /admin/abandoned-checkouts
// -----------------------------------------------------------------------
router.get('/abandoned-checkouts', async (_req: Request, res: Response) => {
  const checkouts = await prisma.abandonedCheckout.findMany({
    orderBy: { createdAt: 'desc' },
    take: DEFAULT_LIMIT,
    select: {
      id: true,
      nuvemshopCheckoutId: true,
      customerName: true,
      customerEmail: true,
      normalizedPhone: true,
      total: true,
      currency: true,
      productsSummary: true,
      abandonedCheckoutUrl: true,
      status: true,
      firstSeenAt: true,
      lastSeenAt: true,
      convertedAt: true,
      source: true,
      createdAt: true,
    },
  })
  res.json({ count: checkouts.length, data: checkouts })
})

// -----------------------------------------------------------------------
// GET /admin/message-logs
// Filtros: status, template_name, entity_type, date_from, date_to
// -----------------------------------------------------------------------
router.get('/message-logs', async (req: Request, res: Response) => {
  const { status, template_name, entity_type, date_from, date_to } = req.query

  const where: Prisma.MessageLogWhereInput = {}

  if (status) where.status = status as MessageStatus
  if (template_name) where.templateName = String(template_name)
  if (entity_type) where.entityType = entity_type as EntityType

  if (date_from || date_to) {
    where.createdAt = {
      ...(date_from ? { gte: new Date(String(date_from)) } : {}),
      ...(date_to ? { lte: new Date(String(date_to)) } : {}),
    }
  }

  const logs = await prisma.messageLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: DEFAULT_LIMIT,
    select: {
      id: true,
      idempotencyKey: true,
      entityType: true,
      entityId: true,
      normalizedPhone: true,
      templateName: true,
      status: true,
      reason: true,
      errorCode: true,
      metaMessageId: true,
      retryCount: true,
      scheduledAt: true,
      sentAt: true,
      nextRetryAt: true,
      source: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  res.json({ count: logs.length, data: logs })
})

// -----------------------------------------------------------------------
// GET /admin/webhook-events
// Filtros: provider, processed, topic, date_from, date_to
// -----------------------------------------------------------------------
router.get('/webhook-events', async (req: Request, res: Response) => {
  const { provider, processed, topic, date_from, date_to } = req.query

  const where: Prisma.WebhookEventWhereInput = {}

  if (provider) where.provider = provider as WebhookProvider
  if (topic) where.topic = String(topic)
  if (processed !== undefined) where.processed = processed === 'true'

  if (date_from || date_to) {
    where.createdAt = {
      ...(date_from ? { gte: new Date(String(date_from)) } : {}),
      ...(date_to ? { lte: new Date(String(date_to)) } : {}),
    }
  }

  const events = await prisma.webhookEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: DEFAULT_LIMIT,
    select: {
      id: true,
      provider: true,
      topic: true,
      externalId: true,
      hmacValid: true,
      processed: true,
      processedAt: true,
      error: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  res.json({ count: events.length, data: events })
})

// -----------------------------------------------------------------------
// GET /admin/automation-rules
// -----------------------------------------------------------------------
router.get('/automation-rules', async (_req: Request, res: Response) => {
  const rules = await prisma.automationRule.findMany({
    orderBy: { eventType: 'asc' },
  })
  res.json({ count: rules.length, data: rules })
})

// POST /admin/automation-rules
router.post('/automation-rules', async (req: Request, res: Response) => {
  const { name, eventType, templateName, delayMinutes, active, maxSendsPerEntity, stopIfOrderExists } =
    req.body

  if (!name || !eventType || !templateName) {
    res.status(400).json({ error: 'name, eventType e templateName são obrigatórios' })
    return
  }

  const rule = await prisma.automationRule.create({
    data: {
      name,
      eventType,
      templateName,
      delayMinutes: delayMinutes ?? 0,
      active: active ?? true,
      maxSendsPerEntity: maxSendsPerEntity ?? 1,
      stopIfOrderExists: stopIfOrderExists ?? true,
    },
  })
  res.status(201).json(rule)
})

// PATCH /admin/automation-rules/:id
router.patch('/automation-rules/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  const { name, templateName, delayMinutes, active, maxSendsPerEntity, stopIfOrderExists } =
    req.body

  const rule = await prisma.automationRule.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(templateName !== undefined ? { templateName } : {}),
      ...(delayMinutes !== undefined ? { delayMinutes } : {}),
      ...(active !== undefined ? { active } : {}),
      ...(maxSendsPerEntity !== undefined ? { maxSendsPerEntity } : {}),
      ...(stopIfOrderExists !== undefined ? { stopIfOrderExists } : {}),
    },
  })
  res.json(rule)
})

// -----------------------------------------------------------------------
// GET /admin/whatsapp-templates
// -----------------------------------------------------------------------
router.get('/whatsapp-templates', async (_req: Request, res: Response) => {
  const templates = await prisma.whatsappTemplate.findMany({
    orderBy: { eventType: 'asc' },
  })
  res.json({ count: templates.length, data: templates })
})

// PATCH /admin/whatsapp-templates/:id
router.patch('/whatsapp-templates/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  const { name, metaTemplateName, languageCode, category, messagePreview, variables, active } =
    req.body

  const template = await prisma.whatsappTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(metaTemplateName !== undefined ? { metaTemplateName } : {}),
      ...(languageCode !== undefined ? { languageCode } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(messagePreview !== undefined ? { messagePreview } : {}),
      ...(variables !== undefined ? { variables } : {}),
      ...(active !== undefined ? { active } : {}),
    },
  })
  res.json(template)
})

export default router
