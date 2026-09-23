// Banco em memória para os testes de e-mail (consentimento + supressão). Respeita
// as unicidades reais do schema e faz ROLLBACK de verdade quando a transação
// lança — assim a atomicidade (bloqueio + evento no livro-razão) é testada, não
// presumida. Nunca toca rede nem Postgres.
//
// Uso: vi.mock('../../config/prisma', async () => {
//   const { emailDb } = await import('../fixtures/inMemoryEmailDb')
//   return { prisma: emailDb.prisma }
// })

type Status = 'OPT_IN' | 'OPT_OUT' | 'UNKNOWN'

export interface LedgerRow {
  emailHash: string
  customerId: string | null
  status: Status
  source: string
  evidenceRef: string
  sourceUpdatedAt: Date | null
  capturedAt: Date
}

export interface StateRow {
  emailHash: string
  status: Status
  reason: string
  eventCount: number
  lastEventAt: Date | null
}

export interface SuppressionRow {
  emailHash: string
  reason: string
  evidenceRef: string
  suppressedAt: Date
}

class InMemoryEmailDb {
  events: LedgerRow[] = []
  states = new Map<string, StateRow>()
  suppressions = new Map<string, SuppressionRow>()
  // Quando true, a próxima escrita no livro-razão lança (simula falha no meio da transação).
  failNextLedgerWrite = false

  readonly tx = {
    emailConsentEvent: {
      createMany: async ({ data }: { data: LedgerRow[] }): Promise<{ count: number }> => {
        if (this.failNextLedgerWrite) {
          this.failNextLedgerWrite = false
          throw new Error('falha simulada no livro-razão')
        }
        let count = 0
        for (const row of data) {
          const duplicate = this.events.some(
            (e) => e.emailHash === row.emailHash && e.source === row.source && e.evidenceRef === row.evidenceRef,
          )
          if (!duplicate) {
            this.events.push({ ...row })
            count++
          }
        }
        return { count }
      },
      findMany: async ({ where }: { where: { emailHash: { in: string[] } } }): Promise<LedgerRow[]> =>
        this.events.filter((e) => where.emailHash.in.includes(e.emailHash)),
    },
    emailMarketingConsent: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { emailHash: string }
        create: StateRow
        update: Partial<StateRow>
      }): Promise<void> => {
        const existing = this.states.get(where.emailHash)
        this.states.set(where.emailHash, existing ? { ...existing, ...update } : { ...create })
      },
      findUnique: async ({ where }: { where: { emailHash: string } }): Promise<{ status: Status; reason: string } | null> => {
        const row = this.states.get(where.emailHash)
        return row ? { status: row.status, reason: row.reason } : null
      },
    },
    emailSuppression: {
      createMany: async ({ data }: { data: SuppressionRow[] }): Promise<{ count: number }> => {
        let count = 0
        for (const row of data) {
          if (!this.suppressions.has(row.emailHash)) {
            this.suppressions.set(row.emailHash, { ...row })
            count++
          }
        }
        return { count }
      },
      findUnique: async ({ where }: { where: { emailHash: string } }): Promise<{ emailHash: string } | null> =>
        this.suppressions.has(where.emailHash) ? { emailHash: where.emailHash } : null,
      findMany: async (): Promise<Array<{ emailHash: string }>> =>
        [...this.suppressions.keys()].map((emailHash) => ({ emailHash })),
    },
  }

  readonly prisma = {
    emailConsentEvent: this.tx.emailConsentEvent,
    emailMarketingConsent: this.tx.emailMarketingConsent,
    emailSuppression: this.tx.emailSuppression,
    // Stub mínimo: o gate por destinatário (emailSendGate.ts) também checa cooldown
    // via emailTrackingService.hasRecentEmailSend, que consulta emailSend.count.
    // Este banco em memória não modela envios (ver inMemoryTrackingDb.ts, que
    // COMPÕE este arquivo para isso) — aqui "sempre sem envio recente" é o
    // suficiente para não bloquear por engano os testes de consentimento/supressão.
    emailSend: { count: async (): Promise<number> => 0 },
    $transaction: async <T>(fn: (client: typeof this.tx) => Promise<T>): Promise<T> => {
      const snapshot = {
        events: this.events.map((e) => ({ ...e })),
        states: new Map(this.states),
        suppressions: new Map(this.suppressions),
      }
      try {
        return await fn(this.tx)
      } catch (error) {
        this.events = snapshot.events
        this.states = snapshot.states
        this.suppressions = snapshot.suppressions
        throw error
      }
    },
  }

  // Atalho para preparar um estado de consentimento sem passar pelo livro-razão.
  seedConsent(emailHash: string, status: Status): void {
    this.states.set(emailHash, { emailHash, status, reason: 'SNAPSHOTS_UNANIMOUS', eventCount: 1, lastEventAt: new Date() })
  }

  reset(): void {
    this.events = []
    this.states = new Map()
    this.suppressions = new Map()
    this.failNextLedgerWrite = false
  }
}

export const emailDb = new InMemoryEmailDb()
