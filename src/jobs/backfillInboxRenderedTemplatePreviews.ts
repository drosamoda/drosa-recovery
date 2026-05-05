import { MessageStatus, ConversationStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { getFriendlyTemplatePreview, renderTemplatePreview } from '../helpers/inboxTemplatePreview'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { env } from '../config/env'

export type BackfillInboxRenderedTemplatePreviewsResult = {
  found: number
  created: number
  skipped: number
  contactsUpdated: number
  errors: number
}

type RowRecord = Record<string, unknown>

function isPlaceholderName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase()
  return !normalized || normalized === 'sem nome' || normalized === 'cliente'
}

function normalizeCandidatePhone(phone?: string | null): string | null {
  if (!phone) return null
  return normalizePhoneBrazil(phone) ?? phone
}

function asRecord(value: unknown): RowRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RowRecord) : null
}

function extractString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function pickTemplateVariables(payload: unknown): Record<string, string> {
  const record = asRecord(payload)
  const params = asRecord(record?.templateParameters) ?? asRecord(record?.template_parameters) ?? null
  const result: Record<string, string> = {}

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.trim()) {
        result[key] = value.trim()
      }
    }
  }

  return result
}

function firstName(fullName?: string | null): string {
  const normalized = fullName?.trim()
  if (!normalized) return 'Cliente'
  return normalized.split(/\s+/)[0] ?? normalized
}

function formatCurrencyBRL(value?: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const numeric =
    typeof value === 'number'
      ? value
      : Number(String(typeof value === 'object' ? value.toString?.() ?? value : value).replace(',', '.'))
  if (!Number.isFinite(numeric)) return null
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numeric)
}

function buildTemplateVariables(params: {
  templateName: string
  customerName?: string | null
  orderNumber?: string | null
  orderTotal?: unknown
  checkoutUrl?: string | null
}): Record<string, string> {
  const variables: Record<string, string> = {
    nome_cliente: firstName(params.customerName),
  }

  if (params.orderNumber) variables.numero_pedido = params.orderNumber
  const formattedTotal = formatCurrencyBRL(params.orderTotal)
  if (formattedTotal) variables.valor_total = formattedTotal
  if (params.checkoutUrl) variables.link_checkout = params.checkoutUrl

  if (
    params.templateName === 'confirmacao_pedido_drosa' ||
    params.templateName === 'pagamento_confirmado_drosa_01' ||
    params.templateName === 'pix_cancelado_drosa_01'
  ) {
    variables.link_grupo_vip = env.GRUPO_VIP_LINK
  }

  return variables
}

async function upsertContact(phone: string, name?: string | null) {
  const existing = await prisma.contact.findUnique({
    where: { phone },
  })

  const shouldUseName = !isPlaceholderName(name)

  if (!existing) {
    const created = await prisma.contact.create({
      data: {
        phone,
        name: shouldUseName ? name!.trim() : null,
      },
    })
    return { contact: created, updated: shouldUseName }
  }

  if (shouldUseName && isPlaceholderName(existing.name)) {
    const updated = await prisma.contact.update({
      where: { id: existing.id },
      data: { name: name!.trim() },
    })
    return { contact: updated, updated: true }
  }

  return { contact: existing, updated: false }
}

async function ensureConversation(contactId: string) {
  let conversation = await prisma.conversation.findFirst({
    where: {
      contactId,
      status: ConversationStatus.open,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        contactId,
        status: ConversationStatus.open,
      },
    })
  }

  return conversation
}

async function getEntityContext(messageLog: {
  entityType: string
  entityId: string
  normalizedPhone: string
}): Promise<{
  customerName?: string | null
  customerEmail?: string | null
  phone?: string | null
  orderNumber?: string | null
  orderTotal?: unknown
  checkoutUrl?: string | null
}> {
  if (messageLog.entityType === 'order') {
    const order = await prisma.order.findUnique({
      where: { id: messageLog.entityId },
      select: {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        normalizedPhone: true,
        orderNumber: true,
        total: true,
        orderUrl: true,
      },
    })

    if (!order) return { phone: messageLog.normalizedPhone }

    return {
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      phone: order.normalizedPhone || order.customerPhone || messageLog.normalizedPhone,
      orderNumber: order.orderNumber,
      orderTotal: order.total,
      checkoutUrl: order.orderUrl,
    }
  }

  if (messageLog.entityType === 'abandoned_checkout') {
    const checkout = await prisma.abandonedCheckout.findUnique({
      where: { id: messageLog.entityId },
      select: {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        normalizedPhone: true,
        abandonedCheckoutUrl: true,
      },
    })

    if (!checkout) return { phone: messageLog.normalizedPhone }

    return {
      customerName: checkout.customerName,
      customerEmail: checkout.customerEmail,
      phone: checkout.normalizedPhone || checkout.customerPhone || messageLog.normalizedPhone,
      checkoutUrl: checkout.abandonedCheckoutUrl,
    }
  }

  return { phone: messageLog.normalizedPhone }
}

function needsBackfill(body?: string | null, templateName?: string | null): boolean {
  if (!body) return true
  const normalized = body.trim()
  return (
    normalized === templateName ||
    normalized === getFriendlyTemplatePreview(templateName ?? '') ||
    normalized.startsWith('Template enviado:') ||
    normalized === '[mensagem enviada]'
  )
}

function mergeRawPayload(existingRawPayload: unknown, next: RowRecord): RowRecord {
  const existing = asRecord(existingRawPayload) ?? {}
  return {
    ...existing,
    ...next,
  }
}

export async function runBackfillInboxRenderedTemplatePreviews(): Promise<BackfillInboxRenderedTemplatePreviewsResult> {
  let found = 0
  let created = 0
  let skipped = 0
  let contactsUpdated = 0
  let errors = 0

  let skip = 0

  while (true) {
    const logs = await prisma.messageLog.findMany({
      where: {
        metaMessageId: { not: null },
        status: { in: [MessageStatus.sent, MessageStatus.delivered, MessageStatus.read] },
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      skip,
      take: 200,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        normalizedPhone: true,
        templateName: true,
        metaMessageId: true,
        payload: true,
        response: true,
        sentAt: true,
        createdAt: true,
      },
    })

    if (logs.length === 0) break
    found += logs.length

    for (const messageLog of logs) {
      try {
        if (!messageLog.metaMessageId) {
          skipped++
          continue
        }

        const chatMessage = await prisma.chatMessage.findFirst({
          where: { waMessageId: messageLog.metaMessageId },
          select: {
            id: true,
            conversationId: true,
            body: true,
            rawPayload: true,
            timestamp: true,
          },
        })

        if (!chatMessage) {
          skipped++
          continue
        }

        const payloadRecord = asRecord(messageLog.payload)
        const payloadRenderedPreview = extractString(payloadRecord?.renderedPreview)
        const entityContext = await getEntityContext(messageLog)
        const phone = normalizeCandidatePhone(entityContext.phone || messageLog.normalizedPhone)

        if (!phone) {
          skipped++
          continue
        }

        const { contact, updated } = await upsertContact(phone, entityContext.customerName)
        if (updated) contactsUpdated++

        const conversation = await ensureConversation(contact.id)
        const existingRawPayload = asRecord(chatMessage.rawPayload)
        const templateVariablesFromPayload = pickTemplateVariables(messageLog.payload)
        const templateVariables = {
          ...templateVariablesFromPayload,
          ...(entityContext.customerName ? { nome_cliente: firstName(entityContext.customerName) } : {}),
          ...(entityContext.orderNumber ? { numero_pedido: entityContext.orderNumber } : {}),
          ...(entityContext.orderTotal !== undefined ? { valor_total: formatCurrencyBRL(entityContext.orderTotal) ?? '' } : {}),
          ...(entityContext.checkoutUrl ? { link_checkout: entityContext.checkoutUrl } : {}),
          ...(entityContext.checkoutUrl ? { link_boleto_pix: entityContext.checkoutUrl } : {}),
        }

        if (
          messageLog.templateName === 'confirmacao_pedido_drosa' ||
          messageLog.templateName === 'pagamento_confirmado_drosa_01' ||
          messageLog.templateName === 'pix_cancelado_drosa_01'
        ) {
          templateVariables.link_grupo_vip = env.GRUPO_VIP_LINK
        }

        const templateRecord = await prisma.whatsappTemplate.findFirst({
          where: { metaTemplateName: messageLog.templateName },
          select: {
            messagePreview: true,
          },
        })

        const fallbackPreview = renderTemplatePreview(messageLog.templateName, {
          templatePreview: templateRecord?.messagePreview ?? payloadRecord?.templatePreview ?? null,
          templateVariables,
        })

        const renderedPreview =
          payloadRenderedPreview ??
          fallbackPreview.renderedPreview ??
          getFriendlyTemplatePreview(messageLog.templateName)

        const shouldUpdateBody = needsBackfill(chatMessage.body, messageLog.templateName) || chatMessage.body !== renderedPreview

        if (!shouldUpdateBody && existingRawPayload?.renderedPreview === renderedPreview) {
          skipped++
          continue
        }

        await prisma.chatMessage.update({
          where: { id: chatMessage.id },
          data: {
            body: renderedPreview,
            rawPayload: mergeRawPayload(chatMessage.rawPayload, {
              source: 'automation',
              templateName: messageLog.templateName,
              renderedPreview,
              templateParameters: templateVariables,
              entityType: messageLog.entityType,
              entityId: messageLog.entityId,
              messageLogId: messageLog.id,
            }),
            timestamp: chatMessage.timestamp ?? messageLog.sentAt ?? messageLog.createdAt,
          },
        })

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: messageLog.sentAt ?? messageLog.createdAt,
          },
        })

        created++
      } catch (err) {
        errors++
        logger.error('[backfillInboxRenderedTemplatePreviews] erro ao atualizar preview renderizado', err, {
          messageLogId: messageLog.id,
          metaMessageId: messageLog.metaMessageId,
        })
      }
    }

    if (logs.length < 200) break
    skip += logs.length
  }

  logger.info('[backfillInboxRenderedTemplatePreviews] concluido', {
    found,
    created,
    skipped,
    contactsUpdated,
    errors,
  })

  return { found, created, skipped, contactsUpdated, errors }
}
