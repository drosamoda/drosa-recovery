import { prisma } from '../config/prisma'
import { EntityType, MessageStatus, MessageLog } from '@prisma/client'

type CreatePendingParams = {
  entityType: 'order' | 'abandoned_checkout'
  entityId: string
  customerId?: string | null
  normalizedPhone: string
  templateName: string
  scheduledAt: Date
  source?: string
}

const BLOCKING_STATUSES: MessageStatus[] = [
  MessageStatus.pending,
  MessageStatus.processing,
  MessageStatus.sent,
  MessageStatus.delivered,
  MessageStatus.read,
  MessageStatus.skipped,
]

export const messageService = {
  generateIdempotencyKey(
    entityType: 'order' | 'abandoned_checkout',
    entityId: string,
    templateName: string
  ): string {
    return `${entityType}:${entityId}:${templateName}`
  },

  async createPendingMessageIfNotExists(params: CreatePendingParams): Promise<MessageLog> {
    const key = messageService.generateIdempotencyKey(
      params.entityType,
      params.entityId,
      params.templateName
    )

    const existing = await prisma.messageLog.findUnique({
      where: { idempotencyKey: key },
    })

    if (existing) {
      // Já existe — só cria nova tentativa se a anterior falhou
      if (existing.status !== MessageStatus.failed) {
        return existing
      }
      // Status failed: só retry explícito (feito em etapa futura)
      return existing
    }

    return prisma.messageLog.create({
      data: {
        idempotencyKey: key,
        entityType: params.entityType as EntityType,
        entityId: params.entityId,
        customerId: params.customerId ?? null,
        normalizedPhone: params.normalizedPhone,
        templateName: params.templateName,
        status: MessageStatus.pending,
        scheduledAt: params.scheduledAt,
        source: params.source ?? null,
      },
    })
  },

  // Verifica se já existe log não-cancelável para esse entity+template
  async existsBlockingLog(
    entityType: 'order' | 'abandoned_checkout',
    entityId: string,
    templateName: string
  ): Promise<boolean> {
    const key = messageService.generateIdempotencyKey(entityType, entityId, templateName)
    const existing = await prisma.messageLog.findUnique({
      where: { idempotencyKey: key },
      select: { status: true },
    })
    if (!existing) return false
    return BLOCKING_STATUSES.includes(existing.status)
  },

  // Marca logs pending de um checkout como skipped (quando pedido é criado)
  async skipPendingCheckoutLogs(
    checkoutId: string,
    reason: string
  ): Promise<void> {
    await prisma.messageLog.updateMany({
      where: {
        entityType: EntityType.abandoned_checkout,
        entityId: checkoutId,
        status: MessageStatus.pending,
      },
      data: {
        status: MessageStatus.skipped,
        reason,
      },
    })
  },

  // Atualiza status pelo metaMessageId (usado pelo webhook da Meta)
  async updateStatusByMetaMessageId(
    metaMessageId: string,
    status: MessageStatus,
    extra?: { response?: object; errorCode?: string; sentAt?: Date }
  ): Promise<void> {
    await prisma.messageLog.updateMany({
      where: { metaMessageId },
      data: {
        status,
        response: extra?.response ?? undefined,
        errorCode: extra?.errorCode ?? undefined,
        sentAt: extra?.sentAt ?? undefined,
      },
    })
  },
}
