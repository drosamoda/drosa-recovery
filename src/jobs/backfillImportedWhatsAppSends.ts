import { ChatMessageType, ConversationStatus, MessageDirection } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { normalizePhoneBrazil } from '../helpers/phoneService'

export type BackfillImportedWhatsAppSendsResult = {
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

function pickPhone(row: ImportedRow): string | null {
  return (
    normalizeCandidatePhone(
      pickString(row, ['telefone', 'phone', 'normalizedPhone', 'normalized_phone', 'to', 'wa_id'])
    ) || null
  )
}

function pickName(row: ImportedRow): string | null {
  return pickString(row, ['nome', 'name', 'customerName', 'customer_name', 'contactName', 'contact_name'])
}

function pickWaMessageId(row: ImportedRow): string | null {
  return pickString(row, ['wa_message_id', 'waMessageId', 'metaMessageId', 'meta_message_id', 'messageId'])
}

function pickImportId(row: ImportedRow): string | null {
  return pickString(row, ['id', 'importId', 'import_id', 'externalId', 'external_id'])
}

function pickStatus(row: ImportedRow): string | null {
  return pickString(row, ['status'])
}

function pickOrigin(row: ImportedRow): string | null {
  return pickString(row, ['origem', 'origin', 'source'])
}

function pickMessageType(row: ImportedRow): ChatMessageType {
  const rawType = pickString(row, ['tipo_mensagem', 'type', 'messageType', 'message_type'])
  const allowed = new Set(Object.values(ChatMessageType))
  if (rawType && allowed.has(rawType as ChatMessageType)) {
    return rawType as ChatMessageType
  }
  return ChatMessageType.text
}

function pickBody(row: ImportedRow): string {
  const body =
    pickString(row, ['corpo', 'body', 'text', 'message', 'content']) ||
    pickString(row, ['tipo_mensagem', 'type']) ||
    pickString(row, ['origem', 'origin']) ||
    '[mensagem enviada]'

  return body
}

function pickTimestamp(row: ImportedRow): Date | null {
  const sentAt = pickDate(row, ['enviado_em'])
  if (sentAt) return sentAt

  const createdAt = pickDate(row, ['criado_em'])
  if (createdAt) return createdAt

  const importedAt = pickDate(row, ['imported_at'])
  if (importedAt) return importedAt

  return null
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

function approxWindow(date: Date, minutes = 5) {
  return {
    gte: new Date(date.getTime() - minutes * 60_000),
    lte: new Date(date.getTime() + minutes * 60_000),
  }
}

async function readRows(): Promise<ImportedRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ data: ImportedRow }>>(
    'SELECT to_jsonb(t) AS data FROM "whatsapp_envios_importados" t'
  )

  return rows.map((row) => row.data || {})
}

function isDuplicateCandidate(existing: { id: string } | null | undefined): boolean {
  return Boolean(existing)
}

export async function runBackfillImportedWhatsAppSends(): Promise<BackfillImportedWhatsAppSendsResult> {
  let found = 0
  let created = 0
  let skipped = 0
  let contactsUpdated = 0
  let errors = 0

  let rows: ImportedRow[] = []
  try {
    rows = await readRows()
  } catch (err) {
    logger.error('[backfillImportedWhatsAppSends] falha ao ler tabela de importacao', err)
    return { found, created, skipped, contactsUpdated, errors: errors + 1 }
  }

  rows.sort((a, b) => {
    const aDate = pickTimestamp(a)?.getTime() ?? 0
    const bDate = pickTimestamp(b)?.getTime() ?? 0
    return aDate - bDate
  })

  found = rows.length

  for (const row of rows) {
    try {
      const phone = pickPhone(row)
      const name = pickName(row)
      const waMessageId = pickWaMessageId(row)
      const body = pickBody(row)
      const sentAt = pickTimestamp(row) ?? new Date()
      const importId = pickImportId(row)
      const status = pickStatus(row)
      const origem = pickOrigin(row)
      const messageType = pickMessageType(row)

      if (!phone) {
        skipped++
        continue
      }

      if (waMessageId) {
        const existingByWaId = await prisma.chatMessage.findFirst({
          where: { waMessageId },
          select: { id: true },
        })
        if (isDuplicateCandidate(existingByWaId)) {
          skipped++
          continue
        }
      }

      const { contact, updated } = await upsertContact(phone, name)
      if (updated) contactsUpdated++

      const conversation = await ensureConversation(contact.id)

      const existingByContent = await prisma.chatMessage.findFirst({
        where: {
          conversationId: conversation.id,
          direction: MessageDirection.outbound,
          body,
          timestamp: approxWindow(sentAt),
        },
        select: { id: true },
      })
      if (isDuplicateCandidate(existingByContent)) {
        skipped++
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: sentAt },
        })
        continue
      }

      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          waMessageId: waMessageId || null,
          direction: MessageDirection.outbound,
          type: messageType,
          body,
          rawPayload: {
            source: 'whatsapp_envios_importados',
            origem,
            id: importId,
            status,
            imported_at: pickTimestamp(row)?.toISOString() ?? null,
            wa_message_id: waMessageId,
            telefone: phone,
            nome: isPlaceholderName(name) ? null : name,
            tipo_mensagem: pickString(row, ['tipo_mensagem']),
            corpo: pickString(row, ['corpo']),
            enviado_em: pickString(row, ['enviado_em']),
            criado_em: pickString(row, ['criado_em']),
          },
          status: status || 'sent',
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
      logger.error('[backfillImportedWhatsAppSends] erro ao espelhar envio importado', err)
    }
  }

  logger.info('[backfillImportedWhatsAppSends] concluido', {
    found,
    created,
    skipped,
    contactsUpdated,
    errors,
  })

  return { found, created, skipped, contactsUpdated, errors }
}
