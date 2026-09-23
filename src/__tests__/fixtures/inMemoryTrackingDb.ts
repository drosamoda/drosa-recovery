import { emailDb } from './inMemoryEmailDb'

// Banco em memória do TRACKING de e-mail (email_sends + email_event_logs). COMPÕE o
// banco de consentimento/supressão (inMemoryEmailDb) num só `prisma` falso, para os
// testes exercitarem o caminho inteiro (webhook -> evento -> supressão -> ledger).
// Respeita as unicidades reais do schema, faz rollback de verdade e as operações
// atômicas (updateMany) são síncronas: dois claims concorrentes nunca ganham juntos.
//
// Uso: vi.mock('../../config/prisma', async () => {
//   const { trackingDb } = await import('../fixtures/inMemoryTrackingDb')
//   return { prisma: trackingDb.prisma }
// })

export interface SendRow {
  id: string
  sendKey: string
  emailHash: string
  campaignKey: string
  provider: string | null
  providerMessageId: string | null
  status: string
  attempts: number
  failureReason: string | null
  queuedAt: Date
  sentAt: Date | null
}

export interface EventRow {
  id: string
  provider: string
  providerEventId: string
  type: string
  emailHash: string
  sendId: string | null
  campaignKey: string | null
  occurredAt: Date
  orderId: string | null
  revenue: unknown
  currency: string | null
  attributionModel: string | null
}

type Where = Record<string, unknown>

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((branch) => matches(row, branch))
    const value = row[key]
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; not?: unknown; gte?: Date; lte?: Date }
      if (c.in !== undefined) return c.in.includes(value)
      if ('not' in c) return value !== c.not
      if (c.gte !== undefined && !(value instanceof Date && value.getTime() >= c.gte.getTime())) return false
      if (c.lte !== undefined && !(value instanceof Date && value.getTime() <= c.lte.getTime())) return false
      return true
    }
    return value === cond
  })
}

class InMemoryTrackingDb {
  sends: SendRow[] = []
  events: EventRow[] = []
  private seq = 0

  private readonly ownTx = {
    emailSend: {
      createMany: async ({ data }: { data: Array<Partial<SendRow> & { sendKey: string; emailHash: string; campaignKey: string }> }): Promise<{ count: number }> => {
        let count = 0
        for (const row of data) {
          const provider = row.provider ?? null
          const providerMessageId = row.providerMessageId ?? null
          const duplicate = this.sends.some(
            (s) => s.sendKey === row.sendKey || (provider !== null && providerMessageId !== null && s.provider === provider && s.providerMessageId === providerMessageId),
          )
          if (duplicate) continue
          this.sends.push({
            id: `send_${++this.seq}`,
            sendKey: row.sendKey,
            emailHash: row.emailHash,
            campaignKey: row.campaignKey,
            provider,
            providerMessageId,
            status: row.status ?? 'QUEUED',
            attempts: row.attempts ?? 0,
            failureReason: null,
            queuedAt: row.queuedAt ?? new Date(),
            sentAt: row.sentAt ?? null,
          })
          count++
        }
        return { count }
      },
      findUnique: async ({ where }: { where: Where }): Promise<SendRow | null> => {
        const found = this.sends.find((s) => matches(s as unknown as Record<string, unknown>, where))
        return found ? { ...found } : null
      },
      findFirst: async ({ where }: { where: Where }): Promise<SendRow | null> => {
        const found = this.sends.find((s) => matches(s as unknown as Record<string, unknown>, where))
        return found ? { ...found } : null
      },
      updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }): Promise<{ count: number }> => {
        const targets = this.sends.filter((s) => matches(s as unknown as Record<string, unknown>, where))
        for (const target of targets) {
          for (const [key, value] of Object.entries(data)) {
            const targetRecord = target as unknown as Record<string, unknown>
            if (value !== null && typeof value === 'object' && 'increment' in (value as Record<string, unknown>)) {
              const current = targetRecord[key] as number
              targetRecord[key] = current + (value as { increment: number }).increment
            } else {
              targetRecord[key] = value
            }
          }
        }
        return { count: targets.length }
      },
      count: async ({ where }: { where: Where }): Promise<number> =>
        this.sends.filter((s) => matches(s as unknown as Record<string, unknown>, where)).length,
    },
    emailEventLog: {
      createMany: async ({ data }: { data: Array<Partial<EventRow> & { provider: string; providerEventId: string; type: string; emailHash: string; occurredAt: Date }> }): Promise<{ count: number }> => {
        let count = 0
        for (const row of data) {
          const duplicate = this.events.some((e) => e.provider === row.provider && e.providerEventId === row.providerEventId)
          if (duplicate) continue
          this.events.push({
            id: `evt_${++this.seq}`,
            provider: row.provider,
            providerEventId: row.providerEventId,
            type: row.type,
            emailHash: row.emailHash,
            sendId: row.sendId ?? null,
            campaignKey: row.campaignKey ?? null,
            occurredAt: row.occurredAt,
            orderId: row.orderId ?? null,
            revenue: row.revenue ?? null,
            currency: row.currency ?? null,
            attributionModel: row.attributionModel ?? null,
          })
          count++
        }
        return { count }
      },
      findUnique: async ({ where }: { where: { provider_providerEventId: { provider: string; providerEventId: string } } }): Promise<EventRow | null> => {
        const { provider, providerEventId } = where.provider_providerEventId
        const found = this.events.find((e) => e.provider === provider && e.providerEventId === providerEventId)
        return found ? { ...found } : null
      },
      findFirst: async ({ where, orderBy }: { where: Where; orderBy?: { occurredAt: 'asc' | 'desc' } }): Promise<EventRow | null> => {
        const rows = this.events.filter((e) => matches(e as unknown as Record<string, unknown>, where))
        if (orderBy) {
          const direction = orderBy.occurredAt === 'desc' ? -1 : 1
          rows.sort((a, b) => direction * (a.occurredAt.getTime() - b.occurredAt.getTime()))
        }
        return rows[0] ? { ...rows[0] } : null
      },
    },
  }

  readonly prisma = {
    ...emailDb.prisma,
    emailSend: this.ownTx.emailSend,
    emailEventLog: this.ownTx.emailEventLog,
    $transaction: async <T>(fn: (client: typeof this.ownTx & Parameters<Parameters<typeof emailDb.prisma.$transaction>[0]>[0]) => Promise<T>): Promise<T> => {
      const snapshot = { sends: this.sends.map((s) => ({ ...s })), events: this.events.map((e) => ({ ...e })) }
      try {
        return await emailDb.prisma.$transaction((theirTx) => fn({ ...theirTx, ...this.ownTx }))
      } catch (error) {
        this.sends = snapshot.sends
        this.events = snapshot.events
        throw error
      }
    },
  }

  reset(): void {
    emailDb.reset()
    this.sends = []
    this.events = []
    this.seq = 0
  }
}

export const trackingDb = new InMemoryTrackingDb()
