import { ChatMessageType, MessageDirection, ConversationStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { normalizePhoneBrazil } from '../helpers/phoneService'

export type BackfillImportedApiSendsResult = {
  found: number
  created: number
  skipped: number
  contactsUpdated: number
  errors: number
}

type ImportedRow = Record<string, unknown>

function isPlaceholderName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase()
  return !normalized || normalized === 'sem nome' || normalized === 'cliente'
}

function normalizeCandidatePhone(phone?: string | null): string | null {
  if (!phone) return null
  return normalizePhoneBrazil(phone) ?? phone
}

function pickString(row: ImportedRow, candidates: string[]): string | null {
  for (const key of candidates) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function pickDate(row: ImportedRow, candidates: string[]): Date | null {
  for (const key of candidates) {
    const value = row[key]
    if (!value) continue

    if (value instanceof Date && !Number.isNaN(value.getTime())) return value

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }

  return null
}

function pickType(row: ImportedRow): ChatMessageType {
  const source = pickString(row, ['type', 'messageType', 'message_type', 'originType', 'sourceType'])
  if (source && ['template', 'text'].includes(source)) {
    return source as ChatMessageType
  }

  const templateName = pickString(row, ['templateName', 'template_name', 'metaTemplateName', 'meta_template_name'])
  if (templateName) return ChatMessageType.template

  return ChatMessageType.text
}

function pickBody(row: ImportedRow): string {
  const candidates = [
    'body',
    'text',
    'message',
    'content',
    'payloadText',
    'messagePreview',
    'preview',
  ]
  for (const key of candidates) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  const templateName = pickString(row, ['templateName', 'template_name', 'metaTemplateName', 'meta_template_name'])
  return templateName || '[mensagem enviada]'
}

function pickWaMessageId(row: ImportedRow): string | null {
  return pickString(row, ['waMessageId', 'wa_message_id', 'metaMessageId', 'meta_message_id', 'messageId', 'message_id'])
}

function pickPhone(row: ImportedRow): string | null {
  return (
    normalizeCandidatePhone(pickString(row, [
      'normalizedPhone',
      'normalized_phone',
      'phone',
      'customerPhone',
      'customer_phone',
      'recipientPhone',
      'recipient_phone',
      'to',
      'wa_id',
    ])) ||
    null
  )
}

function pickName(row: ImportedRow): string | null {
  return pickString(row, ['name', 'customerName', 'customer_name', 'contactName', 'contact_name', 'recipientName', 'recipient_name'])
}

function pickOriginId(row: ImportedRow): string | null {
  return pickString(row, ['id', 'importId', 'import_id', 'externalId', 'external_id', 'rowId', 'row_id'])
}

async function upsertContact(phone: string, name?: string | null) {
  const existing = await prisma.contact.findUnique({
    where: { phone },
  })
  const shouldUseName = !isPlaceholderName(name)

  if (!existing) {
    const contact = await prisma.contact.create({
      data: {
        phone,
        name: shouldUseName ? name!.trim() : null,
      },
    })
    return { contact, updated: shouldUseName, created: true }
  }

  if (shouldUseName && isPlaceholderName(existing.name)) {
    const contact = await prisma.contact.update({
      where: { id: existing.id },
      data: { name: name!.trim() },
    })
    return { contact, updated: true, created: false }
  }

  return { contact: existing, updated: false, created: false }
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

function approxWindow(date: Date, minutes = 3) {
  return {
    gte: new Date(date.getTime() - minutes * 60_000),
    lte: new Date(date.getTime() + minutes * 60_000),
  }
}

async function readImportedRows(): Promise<ImportedRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ data: ImportedRow }>>(
    'SELECT to_jsonb(t) AS data FROM "whatsapp_envios_importados" t'
  )

  return rows.map((row) => row.data || {})
}

export async function runBackfillImportedApiSends(): Promise<BackfillImportedApiSendsResult> {
  let found = 0
  let created = 0
  let skipped = 0
  let contactsUpdated = 0
  let errors = 0

  let rows: ImportedRow[] = []
  try {
    rows = await readImportedRows()
  } catch (err) {
    logger.error('[backfillImportedApiSends] falha ao ler tabela de importacao', err)
    return { found, created, skipped, contactsUpdated, errors: errors + 1 }
  }

  rows.sort((a, b) => {
    const aDate = pickDate(a, ['sentAt', 'sent_at', 'createdAt', 'created_at', 'updatedAt', 'updated_at'])?.getTime() ?? 0
    const bDate = pickDate(b, ['sentAt', 'sent_at', 'createdAt', 'created_at', 'updatedAt', 'updated_at'])?.getTime() ?? 0
    return aDate - bDate
  })

  found = rows.length

  for (const row of rows) {
    try {
      const phone = pickPhone(row)
      const name = pickName(row)
      const waMessageId = pickWaMessageId(row)
      const body = pickBody(row)
      const timestamp = pickDate(row, ['sentAt', 'sent_at', 'createdAt', 'created_at', 'importedAt', 'imported_at'])
      const importId = pickOriginId(row)

      if (!phone) {
        skipped++
        continue
      }

      const sentAt = timestamp ?? new Date()
      let duplicate = false
      if (waMessageId) {
        const existing = await prisma.chatMessage.findFirst({
          where: { waMessageId },
          select: { id: true },
        })
        duplicate = Boolean(existing)
      }

      const { contact, updated } = await upsertContact(phone, name)
      if (updated) contactsUpdated++

      const conversation = await ensureConversation(contact.id)

      if (!duplicate) {
        const existing = await prisma.chatMessage.findFirst({
          where: {
            conversationId: conversation.id,
            direction: MessageDirection.outbound,
            body,
            timestamp: approxWindow(sentAt, 5),
          },
          select: { id: true },
        })
        duplicate = Boolean(existing)
      }

      if (duplicate) {
        skipped++
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: sentAt },
        })
        continue
      }

      const messageType = pickType(row)
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          waMessageId: waMessageId ?? null,
          direction: MessageDirection.outbound,
          type: messageType,
          body,
          rawPayload: {
            source: 'imported_api_send',
            importId,
            waMessageId,
            phone,
            name: isPlaceholderName(name) ? null : name,
            body,
            type: messageType,
          },
          status: 'sent',
          timestamp: sentAt,
        },
      })

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: sentAt },
      })

      created++
    } catch (err) {
      errors++
      logger.error('[backfillImportedApiSends] erro ao espelhar envio importado', err)
    }
  }

  logger.info('[backfillImportedApiSends] concluido', {
    found,
    created,
    skipped,
    contactsUpdated,
    errors,
  })

  return { found, created, skipped, contactsUpdated, errors }
}
