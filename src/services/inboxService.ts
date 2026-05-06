import {
  ChatMessageType,
  ConversationStatus,
  MessageDirection,
  Prisma,
} from '@prisma/client'
import { prisma } from '../config/prisma'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { env } from '../config/env'
import {
  WHATSAPP_24H_WINDOW_ERROR,
  isWithinWhatsappCustomerCareWindow,
} from '../helpers/inboxWindow'
import {
  extractTemplatePreview,
  getFriendlyTemplatePreview,
  looksLikeCorruptedText,
} from '../helpers/inboxTemplatePreview'
import { whatsappService } from './whatsappService'

export type InboxMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'interactive'
  | 'template'
  | 'other'

type SaveInboundMessageParams = {
  phone: string
  name?: string
  waMessageId?: string
  type: InboxMessageType
  body?: string
  rawPayload?: unknown
  timestamp?: Date
}

type SaveSimulatedInboundMessageParams = {
  phone: string
  name?: string
  text: string
}

type SendManualImageMessageParams = {
  fileBuffer: Buffer
  mimeType: string
  caption?: string
  replyToMessageId?: string
  fileName?: string
}

type ReplyContext = {
  id: string
  body?: string | null
  type?: InboxMessageType | string | null
  waMessageId?: string | null
}

type MirrorAutomationMessageParams = {
  phone: string
  metaMessageId: string
  templateName: string
  status: string
  body?: string
  sentAt?: Date
  messageLogId?: string
  entityType?: string
  entityId?: string
  payload?: unknown
}

type AutomationEntityContext = {
  customerName?: string | null
  customerEmail?: string | null
  phone?: string | null
  orderId?: string | null
  checkoutId?: string | null
}

type MetaContact = {
  wa_id?: string
  profile?: {
    name?: string
  }
}

type MetaMessage = {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: {
    body?: string
  }
  image?: {
    id?: string
    caption?: string
    mime_type?: string
    sha256?: string
  }
  sticker?: {
    id?: string
    mime_type?: string
    sha256?: string
    animated?: boolean
  }
  audio?: {
    id?: string
    mime_type?: string
  }
  document?: {
    id?: string
    filename?: string
    mime_type?: string
    sha256?: string
  }
  video?: {
    id?: string
    caption?: string
    mime_type?: string
    sha256?: string
  }
  reaction?: {
    emoji?: string
    action?: string
    message_id?: string
  }
}

function toChatMessageType(type?: string): ChatMessageType {
  const allowed = new Set([
    'text',
    'image',
    'audio',
    'document',
    'sticker',
    'interactive',
    'template',
  ])

  return (allowed.has(type ?? '') ? type : 'other') as ChatMessageType
}

function parseMetaTimestamp(timestamp?: string): Date | undefined {
  if (!timestamp) return undefined
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds)) return undefined
  return new Date(seconds * 1000)
}

function extractContactName(contacts: MetaContact[], phone: string): string | undefined {
  const contact = contacts.find((item) => item.wa_id === phone)
  return contact?.profile?.name
}

function extractMessageBody(msg: MetaMessage): string | undefined {
  const text = msg.text?.body?.trim()
  if (msg.type === 'text') return text
  if (msg.type === 'image') return msg.image?.caption?.trim() || '[imagem]'
  if (msg.type === 'sticker') return '[figurinha]'
  if (msg.type === 'audio') return '[áudio]'
  if (msg.type === 'document') return msg.document?.filename?.trim() || '[documento]'
  if (msg.type === 'video') return msg.video?.caption?.trim() || '[vídeo]'
  if (msg.type === 'reaction') return msg.reaction?.emoji?.trim() || '[reação]'
  if (msg.type === 'interactive') return undefined
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractTemplateParameters(payload: unknown): Record<string, string> | null {
  if (!isRecord(payload)) return null
  const candidate = payload.templateParameters ?? payload.template_parameters ?? payload.parameters
  if (!isRecord(candidate)) return null

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value === 'string' && value.trim()) {
      result[key] = value.trim()
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

function isPlaceholderName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase()
  return !normalized || normalized === 'sem nome' || normalized === 'cliente'
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

const MAX_MANUAL_IMAGE_BYTES = 5 * 1024 * 1024

function normalizeImageMimeType(mimeType: string): string | null {
  const normalized = mimeType.trim().toLowerCase()
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalized)) return null
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized
}

function getReplyContextLabel(type?: string | null): string {
  switch (type) {
    case 'image':
      return 'Respondendo à imagem'
    case 'audio':
      return 'Respondendo ao áudio'
    case 'document':
      return 'Respondendo ao documento'
    case 'sticker':
      return 'Respondendo à figurinha'
    case 'video':
      return 'Respondendo ao vídeo'
    case 'reaction':
      return 'Respondendo à reação'
    case 'other':
      return 'Respondendo à mensagem'
    default:
      return 'Respondendo à mensagem'
  }
}

async function getReplyContext(conversationId: string, replyToMessageId?: string): Promise<ReplyContext | null> {
  if (!replyToMessageId) return null

  const replyMessage = await prisma.chatMessage.findFirst({
    where: {
      id: replyToMessageId,
      conversationId,
    },
    select: {
      id: true,
      body: true,
      type: true,
      waMessageId: true,
    },
  })

  if (!replyMessage) return null

  return {
    id: replyMessage.id,
    body: replyMessage.body,
    type: replyMessage.type,
    waMessageId: replyMessage.waMessageId,
  }
}

async function getAutomationEntityContext(params: MirrorAutomationMessageParams): Promise<AutomationEntityContext> {
  if (!params.entityType || !params.entityId) return {}

  if (params.entityType === 'order') {
    const order = await prisma.order.findUnique({
      where: { id: params.entityId },
    })
    if (!order) return {}

    return {
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      phone: order.normalizedPhone || order.customerPhone,
      orderId: order.nuvemshopOrderId,
    }
  }

  if (params.entityType === 'abandoned_checkout') {
    const checkout = await prisma.abandonedCheckout.findUnique({
      where: { id: params.entityId },
    })
    if (!checkout) return {}

    return {
      customerName: checkout.customerName,
      customerEmail: checkout.customerEmail,
      phone: checkout.normalizedPhone || checkout.customerPhone,
      checkoutId: checkout.nuvemshopCheckoutId,
    }
  }

  return {}
}

async function upsertAutomationContact(phone: string, name?: string | null) {
  const existing = await prisma.contact.findUnique({
    where: { phone },
  })
  const shouldUseName = !isPlaceholderName(name)

  if (!existing) {
    return prisma.contact.create({
      data: {
        phone,
        name: shouldUseName ? name!.trim() : null,
      },
    })
  }

  if (shouldUseName && isPlaceholderName(existing.name)) {
    return prisma.contact.update({
      where: { id: existing.id },
      data: { name: name!.trim() },
    })
  }

  return existing
}

export const inboxService = {
  async saveInboundMessage(params: SaveInboundMessageParams): Promise<{ created: boolean; conversationId?: string }> {
    if (params.waMessageId) {
      const existing = await prisma.chatMessage.findFirst({
        where: { waMessageId: params.waMessageId },
        select: { conversationId: true },
      })
      if (existing) {
        return { created: false, conversationId: existing.conversationId }
      }
    }

    const contact = await prisma.contact.upsert({
      where: { phone: params.phone },
      update: {
        ...(params.name ? { name: params.name } : {}),
      },
      create: {
        phone: params.phone,
        name: params.name ?? null,
      },
    })

    let conversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        status: ConversationStatus.open,
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          contactId: contact.id,
          status: ConversationStatus.open,
        },
      })
    }

    const messageDate = params.timestamp ?? new Date()

    try {
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          waMessageId: params.waMessageId ?? null,
          direction: MessageDirection.inbound,
          type: params.type as ChatMessageType,
          body: params.body ?? null,
          rawPayload: params.rawPayload as object | undefined,
          status: 'received',
          timestamp: params.timestamp ?? null,
        },
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        params.waMessageId
      ) {
        return { created: false, conversationId: conversation.id }
      }
      throw err
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: messageDate,
        lastInboundAt: messageDate,
      },
    })

    return { created: true, conversationId: conversation.id }
  },

  async saveInboundMessagesFromMetaPayload(payload: unknown): Promise<{ saved: number; skipped: number }> {
    const body = payload as Record<string, unknown>
    const entries = (body?.entry as unknown[]) ?? []
    let saved = 0
    let skipped = 0

    for (const entry of entries) {
      const changes = ((entry as Record<string, unknown>)?.changes as unknown[]) ?? []
      for (const change of changes) {
        const value = (change as Record<string, unknown>)?.value as Record<string, unknown>
        if (!value) continue

        const contacts = ((value.contacts as MetaContact[]) ?? []) as MetaContact[]
        const messages = ((value.messages as MetaMessage[]) ?? []) as MetaMessage[]

        for (const msg of messages) {
          const rawPhone = msg.from
          if (!rawPhone) {
            skipped++
            continue
          }

          const phone = normalizePhoneBrazil(rawPhone) ?? rawPhone
          const result = await inboxService.saveInboundMessage({
            phone,
            name: extractContactName(contacts, rawPhone),
            waMessageId: msg.id,
            type: toChatMessageType(msg.type),
            body: extractMessageBody(msg),
            rawPayload: msg,
            timestamp: parseMetaTimestamp(msg.timestamp),
          })

          if (result.created) saved++
          else skipped++
        }
      }
    }

    return { saved, skipped }
  },

  async saveSimulatedInboundMessage(params: SaveSimulatedInboundMessageParams) {
    const phone = normalizePhoneBrazil(params.phone) ?? params.phone
    const timestamp = new Date()

    const result = await inboxService.saveInboundMessage({
      phone,
      name: params.name,
      type: 'text',
      body: params.text,
      rawPayload: {
        source: 'dev_simulate_inbound',
        phone,
        name: params.name ?? null,
        text: params.text,
      },
      timestamp,
    })

    if (!result.conversationId) {
      throw new Error('Falha ao criar conversa simulada')
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: result.conversationId },
      include: { contact: true },
    })

    const message = await prisma.chatMessage.findFirst({
      where: {
        conversationId: result.conversationId,
        direction: MessageDirection.inbound,
      },
      orderBy: { createdAt: 'desc' },
    })

    return { conversation, message }
  },

  async mirrorAutomationMessage(params: MirrorAutomationMessageParams): Promise<{ created: boolean; conversationId?: string }> {
    const entityContext = await getAutomationEntityContext(params)
    const rawPhone = entityContext.phone || params.phone
    const phone = normalizePhoneBrazil(rawPhone) ?? rawPhone
    const contact = await upsertAutomationContact(phone, entityContext.customerName)

    const existing = await prisma.chatMessage.findFirst({
      where: { waMessageId: params.metaMessageId },
      select: { conversationId: true },
    })

    if (existing) {
      return { created: false, conversationId: existing.conversationId }
    }

    let conversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        status: ConversationStatus.open,
      },
      orderBy: { updatedAt: 'desc' },
    })

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          contactId: contact.id,
          status: ConversationStatus.open,
        },
      })
    }

    const timestamp = params.sentAt ?? new Date()
    const renderedPreview = extractTemplatePreview(params.payload)
    const safeRenderedPreview = renderedPreview && !looksLikeCorruptedText(renderedPreview) ? renderedPreview : null
    const body =
      safeRenderedPreview ||
      params.body?.trim() ||
      getFriendlyTemplatePreview(params.templateName)

    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        waMessageId: params.metaMessageId,
        direction: MessageDirection.outbound,
        type: ChatMessageType.template,
        body,
        rawPayload: {
          source: 'automation_mirror',
          templateName: params.templateName,
          renderedPreview: safeRenderedPreview,
          templateParameters: extractTemplateParameters(params.payload),
          entityType: params.entityType ?? null,
          entityId: params.entityId ?? null,
          orderId: entityContext.orderId ?? null,
          checkoutId: entityContext.checkoutId ?? null,
          customerName: entityContext.customerName ?? null,
          customerEmail: entityContext.customerEmail ?? null,
          messageLogId: params.messageLogId ?? null,
          payload: params.payload ?? null,
        },
        status: params.status,
        timestamp,
      },
    })

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: timestamp },
    })

    return { created: true, conversationId: conversation.id }
  },

  async listConversations() {
    const conversations = await prisma.conversation.findMany({
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      take: 100,
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    return Promise.all(conversations.map(async (conversation) => {
      const lastOutbound = await prisma.chatMessage.findFirst({
        where: {
          conversationId: conversation.id,
          direction: MessageDirection.outbound,
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })

      const unansweredCount = await prisma.chatMessage.count({
        where: {
          conversationId: conversation.id,
          direction: MessageDirection.inbound,
          ...(lastOutbound ? { createdAt: { gt: lastOutbound.createdAt } } : {}),
        },
      })

      const lastOrder = await prisma.order.findFirst({
        where: {
          OR: [
            { normalizedPhone: conversation.contact.phone },
            ...(conversation.contact.phone ? [{ customerPhone: conversation.contact.phone }] : []),
          ],
        },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          nuvemshopOrderId: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          total: true,
          orderUrl: true,
          createdAt: true,
        },
      })

      const lastMessage = conversation.messages[0]

      return {
        id: conversation.id,
        status: conversation.status,
        assignedTo: conversation.assignedTo,
        contactName: conversation.contact.name,
        phone: conversation.contact.phone,
        lastOrder,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              direction: lastMessage.direction,
              type: lastMessage.type,
              body: lastMessage.body,
              createdAt: lastMessage.createdAt,
              timestamp: lastMessage.timestamp,
            }
          : null,
        lastMessageAt: conversation.lastMessageAt,
        lastInboundAt: conversation.lastInboundAt,
        unansweredCount,
      }
    }))
  },

  async listMessages(conversationId: string) {
    return prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: [
        { timestamp: 'asc' },
        { createdAt: 'asc' },
      ],
        select: {
          id: true,
          waMessageId: true,
          direction: true,
          type: true,
          body: true,
          rawPayload: true,
          status: true,
          timestamp: true,
          createdAt: true,
          updatedAt: true,
        },
    })
  },

  async updateConversation(conversationId: string, data: { status?: ConversationStatus; assignedTo?: string | null }) {
    return prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}),
      },
      include: { contact: true },
    })
  },

  async sendManualTextMessage(conversationId: string, text: string, replyToMessageId?: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    })

    if (!conversation) {
      return { success: false as const, statusCode: 404, error: 'Conversa nao encontrada' }
    }

    if (!isWithinWhatsappCustomerCareWindow(conversation.lastInboundAt)) {
      return { success: false as const, statusCode: 400, error: WHATSAPP_24H_WINDOW_ERROR }
    }

    const replyContext = await getReplyContext(conversationId, replyToMessageId)
    if (replyToMessageId && !replyContext) {
      return {
        success: false as const,
        statusCode: 400,
        error: 'replyToMessageId invalido ou fora da conversa atual',
      }
    }

    if (env.NODE_ENV !== 'production' && env.INBOX_SEND_DRY_RUN) {
      const now = new Date()
      const message = await prisma.chatMessage.create({
        data: {
          conversationId,
          waMessageId: null,
          direction: MessageDirection.outbound,
          type: ChatMessageType.text,
          body: text,
          rawPayload: {
            dry_run: true,
            to: conversation.contact.phone,
            text,
            replyToMessageId: replyContext?.id || null,
            replyToWaMessageId: replyContext?.waMessageId || null,
            replyToBody: replyContext?.body || null,
            replyToType: replyContext?.type || null,
          },
          status: 'dry_run',
          timestamp: now,
        },
      })

      await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      })

      return { success: true as const, dryRun: true as const, message }
    }

    const result = await whatsappService.sendTextMessage({
      to: conversation.contact.phone,
      text,
      contextMessageId: replyContext?.waMessageId || undefined,
    })

    if (!result.success) {
      return {
        success: false as const,
        statusCode: 502,
        error: result.reason ?? 'Falha ao enviar mensagem pela WhatsApp Cloud API',
      }
    }

    const now = new Date()
    const message = await prisma.chatMessage.create({
      data: {
        conversationId,
        waMessageId: result.metaMessageId ?? null,
        direction: MessageDirection.outbound,
        type: ChatMessageType.text,
        body: text,
        rawPayload: {
          source: 'manual_inbox',
          mediaType: 'text',
          text,
          replyToMessageId: replyContext?.id || null,
          replyToWaMessageId: replyContext?.waMessageId || null,
          replyToBody: replyContext?.body || null,
          replyToType: replyContext?.type || null,
          ...(result.response ? { metaResponse: result.response } : {}),
        },
        status: 'sent',
        timestamp: now,
      },
    })

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    })

    return { success: true as const, dryRun: false as const, message }
  },

  async sendManualImageMessage(conversationId: string, params: SendManualImageMessageParams) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    })

    if (!conversation) {
      return { success: false as const, statusCode: 404, error: 'Conversa nao encontrada' }
    }

    if (!isWithinWhatsappCustomerCareWindow(conversation.lastInboundAt)) {
      return { success: false as const, statusCode: 400, error: WHATSAPP_24H_WINDOW_ERROR }
    }

    const normalizedMimeType = normalizeImageMimeType(params.mimeType)
    if (!normalizedMimeType) {
      return {
        success: false as const,
        statusCode: 400,
        error: 'Mime type invalido. Use jpg, jpeg, png ou webp.',
      }
    }

    if (params.fileBuffer.length > MAX_MANUAL_IMAGE_BYTES) {
      return {
        success: false as const,
        statusCode: 413,
        error: 'Imagem muito grande. Limite maximo de 5 MB.',
      }
    }

    const caption = params.caption?.trim() || ''
    const replyToMessage = await getReplyContext(conversationId, params.replyToMessageId)
    if (params.replyToMessageId && !replyToMessage) {
      return {
        success: false as const,
        statusCode: 400,
        error: 'replyToMessageId invalido ou fora da conversa atual',
      }
    }

    const result = await whatsappService.sendImageMessage({
      to: conversation.contact.phone,
      fileBuffer: params.fileBuffer,
      mimeType: normalizedMimeType,
      caption: caption || undefined,
      contextMessageId: replyToMessage?.waMessageId || undefined,
      fileName: params.fileName,
    })

    if (!result.success) {
      return {
        success: false as const,
        statusCode: 502,
        error: result.reason ?? 'Falha ao enviar imagem pela WhatsApp Cloud API',
      }
    }

    const now = new Date()
    const message = await prisma.chatMessage.create({
      data: {
        conversationId,
        waMessageId: result.metaMessageId ?? null,
        direction: MessageDirection.outbound,
        type: ChatMessageType.image,
        body: caption || '[imagem]',
        rawPayload: {
          source: 'manual_inbox',
          mediaType: 'image',
          caption: caption || null,
          mimeType: normalizedMimeType,
          fileName: params.fileName || null,
          mediaId: result.mediaId ?? null,
          replyToMessageId: replyToMessage?.id || null,
          replyToWaMessageId: replyToMessage?.waMessageId || null,
          replyToBody: replyToMessage?.body || null,
          replyToType: replyToMessage?.type || null,
          contextMessageId: replyToMessage?.waMessageId || null,
        },
        status: 'sent',
        timestamp: now,
      },
    })

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    })

    return { success: true as const, dryRun: false as const, message }
  },
}
