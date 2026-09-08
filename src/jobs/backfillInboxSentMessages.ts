import { ChatMessageType, MessageDirection, MessageStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { getFriendlyTemplatePreview } from '../helpers/inboxTemplatePreview'

export type BackfillInboxSentMessagesResult = {
  found: number
  created: number
  skipped: number
  contactsUpdated: number
  errors: number
}

type EntityContext = {
  customerName?: string | null
  phone?: string | null
}

function isPlaceholderName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase()
  return !normalized || normalized === 'sem nome' || normalized === 'cliente'
}

function normalizeCandidatePhone(phone?: string | null): string | null {
  if (!phone) return null
  return normalizePhoneBrazil(phone) ?? phone
}

async function getEntityContext(messageLog: {
  entityType: string
  entityId: string
  normalizedPhone: string
}): Promise<EntityContext> {
  if (messageLog.entityType === 'order') {
    const order = await prisma.order.findUnique({
      where: { id: messageLog.entityId },
      select: {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        normalizedPhone: true,
      },
    })

    if (!order) return { phone: messageLog.normalizedPhone }
    return {
      customerName: order.customerName,
      phone: order.normalizedPhone || order.customerPhone || messageLog.normalizedPhone,
    }
  }

  if (messageLog.entityType === 'abandoned_checkout') {
    const checkout = await prisma.abandonedCheckout.findUnique({
      where: { id: messageLog.entityId },
      select: {
        customerName: true,
        customerPhone: true,
        normalizedPhone: true,
      },
    })

    if (!checkout) return { phone: messageLog.normalizedPhone }
    return {
      customerName: checkout.customerName,
      phone: checkout.normalizedPhone || checkout.customerPhone || messageLog.normalizedPhone,
    }
  }

  return { phone: messageLog.normalizedPhone }
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
    return { contact: created, updated: Boolean(shouldUseName), created: true }
  }

  if (shouldUseName && isPlaceholderName(existing.name)) {
    const updated = await prisma.contact.update({
      where: { id: existing.id },
      data: { name: name!.trim() },
    })
    return { contact: updated, updated: true, created: false }
  }

  return { contact: existing, updated: false, created: false }
}

async function ensureConversation(contactId: string) {
  let conversation = await prisma.conversation.findFirst({
    where: {
      contactId,
      status: 'open',
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        contactId,
        status: 'open',
      },
    })
  }

  return conversation
}

function getMessageBody(templateName: string, rawPayload: unknown): string {
  if (rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)) {
    const candidate = (rawPayload as Record<string, unknown>).messagePreview
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  return getFriendlyTemplatePreview(templateName)
}

export async function runBackfillInboxSentMessages(): Promise<BackfillInboxSentMessagesResult> {
  let found = 0
  let created = 0
  let skipped = 0
  let contactsUpdated = 0
  let errors = 0

  let skip = 0

  for (;;) {
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
        status: true,
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

        const existing = await prisma.chatMessage.findFirst({
          where: { waMessageId: messageLog.metaMessageId },
          select: { id: true, conversationId: true },
        })

        const entityContext = await getEntityContext(messageLog)
        const phone = normalizeCandidatePhone(entityContext.phone || messageLog.normalizedPhone)

        if (!phone) {
          skipped++
          continue
        }

        const { contact, updated } = await upsertContact(phone, entityContext.customerName)
        if (updated) contactsUpdated++

        const conversation = await ensureConversation(contact.id)
        const timestamp = messageLog.sentAt ?? messageLog.createdAt
        const body = getMessageBody(messageLog.templateName, messageLog.payload ?? messageLog.response)

        if (existing) {
          skipped++
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              lastMessageAt: timestamp,
            },
          })
          continue
        }

        await prisma.chatMessage.create({
          data: {
            conversationId: conversation.id,
            waMessageId: messageLog.metaMessageId,
            direction: MessageDirection.outbound,
            type: ChatMessageType.template,
            body,
            rawPayload: {
              source: 'message_log_backfill',
              messageLogId: messageLog.id,
              entityType: messageLog.entityType,
              entityId: messageLog.entityId,
              templateName: messageLog.templateName,
              status: messageLog.status,
              metaMessageId: messageLog.metaMessageId,
              payload: messageLog.payload ?? null,
              response: messageLog.response ?? null,
              customerName: entityContext.customerName ?? null,
              phone,
            },
            status: messageLog.status,
            timestamp,
          },
        })

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: timestamp,
          },
        })

        created++
      } catch (err) {
        errors++
        logger.error('[backfillInboxSentMessages] erro ao espelhar mensagem enviada', err, {
          messageLogId: messageLog.id,
          metaMessageId: messageLog.metaMessageId,
        })
      }
    }

    if (logs.length < 200) break
    skip += logs.length
  }

  logger.info('[backfillInboxSentMessages] concluido', {
    found,
    created,
    skipped,
    contactsUpdated,
    errors,
  })

  return {
    found,
    created,
    skipped,
    contactsUpdated,
    errors,
  }
}
