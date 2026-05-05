import { ChatMessageType, MessageDirection, MessageStatus, Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { renderTemplatePreview } from '../helpers/inboxTemplatePreview'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { env } from '../config/env'

export type BackfillInboxRenderedTemplatePreviewsResult = {
  found: number
  updatedChatMessages: number
  updatedMessageLogs: number
  skipped: number
  errors: number
}

type RowRecord = Record<string, unknown>

const SUMMARY_BODIES = new Set([
  'Confirmação de pedido enviada',
  'Lembrete de Pix pendente enviado',
  'Lembrete de boleto enviado',
  'Mensagem de carrinho abandonado enviada',
])

function isPlaceholderName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase()
  return !normalized || normalized === 'sem nome' || normalized === 'cliente'
}

function isPlaceholderBody(body?: string | null, templateName?: string | null): boolean {
  const normalized = body?.trim()
  return (
    !normalized ||
    normalized === templateName ||
    SUMMARY_BODIES.has(normalized) ||
    normalized.startsWith('Template enviado:') ||
    normalized === '[mensagem enviada]'
  )
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
  orderStatus?: string | null
  paymentStatus?: string | null
  checkoutUrl?: string | null
  productsSummary?: string | null
}): Record<string, string> {
  const variables: Record<string, string> = {
    nome_cliente: firstName(params.customerName),
  }

  if (params.orderNumber) variables.numero_pedido = params.orderNumber

  const formattedTotal = formatCurrencyBRL(params.orderTotal)
  if (formattedTotal) variables.valor_total = formattedTotal

  if (params.orderStatus) {
    variables.status_pedido = params.orderStatus
  }

  if (params.paymentStatus) {
    variables.status_pagamento = params.paymentStatus
    variables.payment_status = params.paymentStatus
  }

  if (params.checkoutUrl) {
    variables.link_checkout = params.checkoutUrl
    variables.link_boleto_pix = params.checkoutUrl
  }

  if (params.productsSummary) {
    variables.resumo_produtos = params.productsSummary
    variables.produtos_resumo = params.productsSummary
  }

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

function mergeRawPayload(existingRawPayload: unknown, next: RowRecord): RowRecord {
  const existing = asRecord(existingRawPayload) ?? {}
  return {
    ...existing,
    ...next,
  }
}

type MessageLogRecord = {
  id: string
  entityType: string
  entityId: string
  normalizedPhone: string
  templateName: string
  metaMessageId: string | null
  payload: unknown
  sentAt: Date | null
  createdAt: Date
}

type ChatMessageRecord = {
  id: string
  conversationId: string
  waMessageId: string | null
  body: string | null
  rawPayload: unknown
  timestamp: Date | null
  createdAt: Date
}

async function resolveMessageLog(chatMessage: ChatMessageRecord): Promise<MessageLogRecord | null> {
  if (chatMessage.waMessageId) {
    const byMetaId = await prisma.messageLog.findFirst({
      where: { metaMessageId: chatMessage.waMessageId },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        normalizedPhone: true,
        templateName: true,
        metaMessageId: true,
        payload: true,
        sentAt: true,
        createdAt: true,
      },
    })

    if (byMetaId) return byMetaId
  }

  const rawPayload = asRecord(chatMessage.rawPayload)
  const messageLogId = extractString(rawPayload?.messageLogId)
  if (!messageLogId) return null

  return prisma.messageLog.findUnique({
    where: { id: messageLogId },
    select: {
      id: true,
      entityType: true,
      entityId: true,
      normalizedPhone: true,
      templateName: true,
      metaMessageId: true,
      payload: true,
      sentAt: true,
      createdAt: true,
    },
  })
}

async function resolveEntityContext(messageLog: MessageLogRecord): Promise<{
  customerName?: string | null
  customerEmail?: string | null
  phone?: string | null
  orderNumber?: string | null
  orderTotal?: unknown
  orderStatus?: string | null
  paymentStatus?: string | null
  checkoutUrl?: string | null
  productsSummary?: string | null
  reason?: 'missing_order' | 'missing_checkout' | 'unsupported_template' | 'missing_context'
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
        status: true,
        paymentStatus: true,
      },
    })

    if (!order) {
      return { reason: 'missing_order' }
    }

    return {
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      phone: order.normalizedPhone || order.customerPhone || messageLog.normalizedPhone,
      orderNumber: order.orderNumber,
      orderTotal: order.total,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
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
        total: true,
        productsSummary: true,
      },
    })

    if (!checkout) {
      return { reason: 'missing_checkout' }
    }

    return {
      customerName: checkout.customerName,
      customerEmail: checkout.customerEmail,
      phone: checkout.normalizedPhone || checkout.customerPhone || messageLog.normalizedPhone,
      orderTotal: checkout.total,
      checkoutUrl: checkout.abandonedCheckoutUrl,
      productsSummary: checkout.productsSummary,
    }
  }

  return { reason: 'unsupported_template' }
}

function mergeTemplateParameters(
  existing: unknown,
  next: Record<string, string>
): Record<string, string> {
  const existingRecord = asRecord(existing)
  const merged: Record<string, string> = {}

  if (existingRecord) {
    for (const [key, value] of Object.entries(existingRecord)) {
      if (typeof value === 'string' && value.trim()) merged[key] = value.trim()
    }
  }

  for (const [key, value] of Object.entries(next)) {
    if (value.trim()) merged[key] = value.trim()
  }

  return merged
}

export async function runBackfillInboxRenderedTemplatePreviews(): Promise<BackfillInboxRenderedTemplatePreviewsResult> {
  let found = 0
  let updatedChatMessages = 0
  let updatedMessageLogs = 0
  let skipped = 0
  let errors = 0

  let skip = 0

  while (true) {
    const chatMessages = await prisma.chatMessage.findMany({
      where: {
        direction: MessageDirection.outbound,
        type: ChatMessageType.template,
        body: {
          in: Array.from(SUMMARY_BODIES),
        },
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      skip,
      take: 200,
      select: {
        id: true,
        conversationId: true,
        waMessageId: true,
        body: true,
        rawPayload: true,
        timestamp: true,
        createdAt: true,
      },
    })

    if (chatMessages.length === 0) break
    found += chatMessages.length

    for (const chatMessage of chatMessages) {
      try {
        const messageLog = await resolveMessageLog(chatMessage)

        if (!messageLog) {
          skipped++
          logger.info('[backfillInboxRenderedTemplatePreviews] ignorado', {
            reason: 'missing_message_log',
            chatMessageId: chatMessage.id,
            waMessageId: chatMessage.waMessageId ?? null,
          })
          continue
        }

        const entityContext = await resolveEntityContext(messageLog)
        if (entityContext.reason) {
          skipped++
          logger.info('[backfillInboxRenderedTemplatePreviews] ignorado', {
            reason: entityContext.reason,
            chatMessageId: chatMessage.id,
            messageLogId: messageLog.id,
            entityType: messageLog.entityType,
            entityId: messageLog.entityId,
          })
          continue
        }

        const phone = normalizeCandidatePhone(entityContext.phone || messageLog.normalizedPhone)
        if (!phone) {
          skipped++
          logger.info('[backfillInboxRenderedTemplatePreviews] ignorado', {
            reason: 'missing_context',
            chatMessageId: chatMessage.id,
            messageLogId: messageLog.id,
            entityType: messageLog.entityType,
            entityId: messageLog.entityId,
          })
          continue
        }

        const templateRecord = await prisma.whatsappTemplate.findFirst({
          where: { metaTemplateName: messageLog.templateName },
          select: {
            messagePreview: true,
          },
        })

        const payloadRecord = asRecord(messageLog.payload)
        const payloadRenderedPreview = extractString(payloadRecord?.renderedPreview)
        const payloadTemplateParameters = asRecord(payloadRecord?.templateParameters)
        const templatePreview = templateRecord?.messagePreview ?? extractString(payloadRecord?.templatePreview)

        if (!templatePreview && !payloadRenderedPreview) {
          skipped++
          logger.info('[backfillInboxRenderedTemplatePreviews] ignorado', {
            reason: 'unsupported_template',
            chatMessageId: chatMessage.id,
            messageLogId: messageLog.id,
            templateName: messageLog.templateName,
          })
          continue
        }

        const templateVariables = buildTemplateVariables({
          templateName: messageLog.templateName,
          customerName: entityContext.customerName,
          orderNumber: entityContext.orderNumber,
          orderTotal: entityContext.orderTotal,
          orderStatus: entityContext.orderStatus,
          paymentStatus: entityContext.paymentStatus,
          checkoutUrl: entityContext.checkoutUrl,
          productsSummary: entityContext.productsSummary,
        })

        const renderResult = templatePreview
          ? renderTemplatePreview(messageLog.templateName, {
              templatePreview,
              templateVariables,
            })
          : null

        const renderedPreview = payloadRenderedPreview && !isPlaceholderBody(payloadRenderedPreview, messageLog.templateName)
          ? payloadRenderedPreview
          : renderResult?.complete
            ? renderResult.renderedPreview
            : null

        if (!renderedPreview) {
          skipped++
          logger.info('[backfillInboxRenderedTemplatePreviews] ignorado', {
            reason: 'missing_context',
            chatMessageId: chatMessage.id,
            messageLogId: messageLog.id,
            templateName: messageLog.templateName,
          })
          continue
        }

        const templateParameters = mergeTemplateParameters(payloadTemplateParameters, templateVariables)
        const nextChatRawPayload = mergeRawPayload(chatMessage.rawPayload, {
          source: 'automation',
          templateName: messageLog.templateName,
          renderedPreview,
          templateParameters,
          entityType: messageLog.entityType,
          entityId: messageLog.entityId,
          messageLogId: messageLog.id,
          phone,
          customerName: entityContext.customerName ?? null,
          customerEmail: entityContext.customerEmail ?? null,
        })

        const nextMessageLogPayload = mergeRawPayload(messageLog.payload, {
          source: 'automation',
          templateName: messageLog.templateName,
          renderedPreview,
          templateParameters,
          entityType: messageLog.entityType,
          entityId: messageLog.entityId,
          phone,
          customerName: entityContext.customerName ?? null,
          customerEmail: entityContext.customerEmail ?? null,
        })

        const nextBody = renderedPreview
        const currentRendered = extractString(asRecord(chatMessage.rawPayload)?.renderedPreview)
        const currentLogRendered = extractString(asRecord(messageLog.payload)?.renderedPreview)
        const currentLogParams = JSON.stringify(asRecord(messageLog.payload)?.templateParameters ?? {})
        const nextLogParams = JSON.stringify(templateParameters)

        const chatNeedsUpdate =
          chatMessage.body?.trim() !== nextBody ||
          currentRendered !== nextBody ||
          JSON.stringify(chatMessage.rawPayload ?? {}) !== JSON.stringify(nextChatRawPayload)

        const logNeedsUpdate =
          currentLogRendered !== nextBody ||
          currentLogParams !== nextLogParams ||
          JSON.stringify(messageLog.payload ?? {}) !== JSON.stringify(nextMessageLogPayload)

        if (!chatNeedsUpdate && !logNeedsUpdate) {
          skipped++
          continue
        }

        if (chatNeedsUpdate) {
          await prisma.chatMessage.update({
            where: { id: chatMessage.id },
            data: {
              body: nextBody,
              rawPayload: nextChatRawPayload as unknown as Prisma.InputJsonValue,
              timestamp: chatMessage.timestamp ?? messageLog.sentAt ?? messageLog.createdAt,
            },
          })
          updatedChatMessages++
        }

        if (logNeedsUpdate) {
          await prisma.messageLog.update({
            where: { id: messageLog.id },
            data: {
              payload: nextMessageLogPayload as unknown as Prisma.InputJsonValue,
            },
          })
          updatedMessageLogs++
        }

        if (entityContext.customerName && !isPlaceholderName(entityContext.customerName)) {
          const contact = await upsertContact(phone, entityContext.customerName)
          if (contact.updated) {
            logger.info('[backfillInboxRenderedTemplatePreviews] contato atualizado', {
              chatMessageId: chatMessage.id,
              messageLogId: messageLog.id,
              phone,
            })
          }
        } else {
          await upsertContact(phone, entityContext.customerName ?? null)
        }

        await prisma.conversation.update({
          where: { id: chatMessage.conversationId },
          data: {
            lastMessageAt: messageLog.sentAt ?? messageLog.createdAt,
          },
        })
      } catch (err) {
        errors++
        logger.error('[backfillInboxRenderedTemplatePreviews] erro ao atualizar preview renderizado', err, {
          chatMessageId: chatMessage.id,
          waMessageId: chatMessage.waMessageId ?? null,
        })
      }
    }

    if (chatMessages.length < 200) break
    skip += chatMessages.length
  }

  logger.info('[backfillInboxRenderedTemplatePreviews] concluido', {
    found,
    updatedChatMessages,
    updatedMessageLogs,
    skipped,
    errors,
  })

  return { found, updatedChatMessages, updatedMessageLogs, skipped, errors }
}
