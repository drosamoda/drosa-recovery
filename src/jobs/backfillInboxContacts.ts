import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { getTemplatePreviewMap } from '../helpers/inboxTemplatePreview'

export type BackfillInboxContactsResult = {
  contactsScanned: number
  contactsUpdated: number
  messagesUpdated: number
  skipped: number
}

const PLACEHOLDER_NAMES = new Set(['', 'sem nome', 'cliente'])

function isPlaceholderName(name?: string | null): boolean {
  return PLACEHOLDER_NAMES.has(name?.trim().toLowerCase() ?? '')
}

function normalizeCandidatePhone(phone?: string | null): string | null {
  if (!phone) return null
  return normalizePhoneBrazil(phone) ?? phone
}

type NameSource = {
  name?: string | null
}

function pickRealName(items: NameSource[]): string | null {
  const item = items.find((candidate) => !isPlaceholderName(candidate.name))
  return item?.name?.trim() ?? null
}

async function findNameFromOrder(phone: string): Promise<string | null> {
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { normalizedPhone: phone },
        { customerPhone: phone },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      customerName: true,
    },
  })

  return pickRealName(orders.map((order) => ({ name: order.customerName })))
}

async function findNameFromAbandonedCheckout(phone: string): Promise<string | null> {
  const checkouts = await prisma.abandonedCheckout.findMany({
    where: {
      OR: [
        { normalizedPhone: phone },
        { customerPhone: phone },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      customerName: true,
    },
  })

  return pickRealName(checkouts.map((checkout) => ({ name: checkout.customerName })))
}

async function backfillContactNames(): Promise<Omit<BackfillInboxContactsResult, 'messagesUpdated'>> {
  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { name: null },
        { name: '' },
        { name: 'Sem nome' },
        { name: 'Cliente' },
      ],
    },
    select: {
      id: true,
      phone: true,
      name: true,
    },
  })

  let contactsUpdated = 0
  let skipped = 0

  for (const contact of contacts) {
    if (!isPlaceholderName(contact.name)) {
      skipped++
      continue
    }

    const phone = normalizeCandidatePhone(contact.phone)
    if (!phone) {
      skipped++
      continue
    }

    const name = await findNameFromOrder(phone) ?? await findNameFromAbandonedCheckout(phone)
    if (!name) {
      skipped++
      continue
    }

    await prisma.contact.update({
      where: { id: contact.id },
      data: { name },
    })
    contactsUpdated++
  }

  return {
    contactsScanned: contacts.length,
    contactsUpdated,
    skipped,
  }
}

async function backfillTemplateBodies(): Promise<number> {
  let messagesUpdated = 0

  for (const [oldBody, newBody] of Object.entries(getTemplatePreviewMap())) {
    const result = await prisma.chatMessage.updateMany({
      where: { body: oldBody },
      data: { body: newBody },
    })
    messagesUpdated += result.count
  }

  return messagesUpdated
}

export async function runBackfillInboxContacts(): Promise<BackfillInboxContactsResult> {
  const contactResult = await backfillContactNames()
  const messagesUpdated = await backfillTemplateBodies()
  const result = {
    ...contactResult,
    messagesUpdated,
  }

  logger.info('[backfillInboxContacts] concluido', {
    contactsUpdated: result.contactsUpdated,
    messagesUpdated: result.messagesUpdated,
    skipped: result.skipped,
  })

  return result
}
