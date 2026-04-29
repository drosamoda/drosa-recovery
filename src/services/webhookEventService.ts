import { prisma } from '../config/prisma'

type SaveParams = {
  provider: 'nuvemshop' | 'meta' | 'mercado_pago_future'
  topic?: string
  externalId?: string
  hmacValid?: boolean
  rawPayload: unknown
  headers: unknown
}

export const webhookEventService = {
  async save(params: SaveParams): Promise<string> {
    const event = await prisma.webhookEvent.create({
      data: {
        provider: params.provider,
        topic: params.topic ?? null,
        externalId: params.externalId ?? null,
        hmacValid: params.hmacValid ?? null,
        rawPayload: params.rawPayload as object,
        headers: params.headers as object,
        processed: false,
      },
    })
    return event.id
  },

  async markProcessed(id: string): Promise<void> {
    await prisma.webhookEvent.update({
      where: { id },
      data: { processed: true, processedAt: new Date() },
    })
  },

  async markError(id: string, error: string): Promise<void> {
    await prisma.webhookEvent.update({
      where: { id },
      data: { error: error.slice(0, 2000) },
    })
  },
}
