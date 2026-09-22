import { beforeEach, describe, expect, it, vi } from 'vitest'

interface LedgerRow {
  emailHash: string
  source: string
  evidenceRef: string
  status: 'OPT_IN' | 'OPT_OUT' | 'UNKNOWN'
  sourceUpdatedAt: Date | null
  capturedAt: Date
}

const { store, tx, prismaMock } = vi.hoisted(() => {
  const store = { events: [] as LedgerRow[], states: new Map<string, unknown>() }
  const tx = {
    // As leituras do job rodam em transação READ ONLY: $executeRawUnsafe recebe o SET
    // TRANSACTION e $queryRaw delega para o mock de leitura de prismaMock.
    $executeRawUnsafe: vi.fn(async (_sql: string) => 0),
    $queryRaw: (...args: unknown[]) => prismaMock.$queryRaw(...args),
    emailConsentEvent: {
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        let count = 0
        for (const row of data) {
          const dup = store.events.some((e) => e.emailHash === row.emailHash && e.source === row.source && e.evidenceRef === row.evidenceRef)
          if (!dup) {
            store.events.push({ ...row })
            count++
          }
        }
        return { count }
      }),
      findMany: vi.fn(async ({ where }: { where: { emailHash: { in: string[] } } }) => store.events.filter((e) => where.emailHash.in.includes(e.emailHash))),
    },
    emailMarketingConsent: {
      upsert: vi.fn(async ({ where, create }: { where: { emailHash: string }; create: unknown }) => {
        store.states.set(where.emailHash, create)
      }),
    },
  }
  const prismaMock = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { store, tx, prismaMock }
})

vi.mock('../../config/prisma', () => ({ prisma: prismaMock }))

import { env } from '../../config/env'
import { EmailConsentBackfillRefusedError, runBackfillEmailConsent } from '../../jobs/backfillEmailConsent'
import { EmailHashPepperNotConfiguredError } from '../../services/emailConsentService'

const PEPPER = 'p'.repeat(32)
const AT = new Date('2026-08-02T00:00:00Z')

const orderRow = (id: string, email: string | null, accepts: boolean) => ({
  nuvemshopOrderId: id,
  email,
  customerId: null,
  capturedAt: AT,
  rawPayload: { customer: { accepts_marketing: accepts, accepts_marketing_updated_at: '2026-08-01T00:00:00Z' } },
})
const checkoutRow = (id: string, email: string, accepts: boolean) => ({
  nuvemshopCheckoutId: id,
  email,
  customerId: null,
  capturedAt: AT,
  rawPayload: { contact_accepts_marketing: accepts, contact_accepts_marketing_updated_at: '2026-08-05T00:00:00Z' },
})

function mockReads(): void {
  prismaMock.$queryRaw
    .mockResolvedValueOnce([
      orderRow('1', 'a@x.com', true),
      orderRow('2', 'd@x.com', true),
      orderRow('3', 'd@x.com', true),
      orderRow('4', 'c@x.com', true),
      orderRow('5', 'e@x.com', false),
      orderRow('6', 'e@x.com', false),
      orderRow('7', 'fora@x.com', true), // tem sinal mas não está no universo
      orderRow('8', null, true), // sem e-mail
    ])
    .mockResolvedValueOnce([checkoutRow('c1', 'b@x.com', false), checkoutRow('c2', 'c@x.com', false)])
    .mockResolvedValueOnce(['a', 'b', 'c', 'd', 'e', 'z'].map((k) => ({ em: `${k}@x.com` })).concat([{ em: 'lixo' }]))
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.$queryRaw.mockReset()
  store.events.length = 0
  store.states.clear()
  env.CRM_PREVIEW_READONLY = false
})

describe('runBackfillEmailConsent — dry-run (padrão)', () => {
  it('só lê (3 leituras em transação READ ONLY), não escreve e reproduz a classificação conservadora por universo', async () => {
    mockReads()
    const result = await runBackfillEmailConsent()

    expect(result.mode).toBe('DRY_RUN')
    expect(result.write).toBeNull()
    // Cada leitura abriu uma transação e a marcou READ ONLY antes da consulta.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3)
    expect(tx.$executeRawUnsafe.mock.calls.map((call) => call[0])).toEqual([
      'SET TRANSACTION READ ONLY',
      'SET TRANSACTION READ ONLY',
      'SET TRANSACTION READ ONLY',
    ])
    // Nenhuma escrita em nenhuma tabela.
    expect(tx.emailConsentEvent.createMany).not.toHaveBeenCalled()
    expect(tx.emailMarketingConsent.upsert).not.toHaveBeenCalled()
    expect(store.events).toHaveLength(0)

    expect(result.ordersRead).toBe(8)
    expect(result.checkoutsRead).toBe(2)
    // universo: a,b,c,d,e,z (o "lixo" é descartado)
    expect(result.universe.size).toBe(6)
    expect(result.universe.byState).toEqual({ CONFIRMED_OPT_IN: 2, CONFIRMED_OPT_OUT: 2, UNKNOWN: 1, NOT_COLLECTED: 1 })
    // eventos existem também para quem está fora do universo (fora@x.com)
    expect(result.preview.emailsWithEvents).toBe(6)
    expect(result.preview.skipped.noEmail).toBe(1)
  })

  it('funciona sem EMAIL_HASH_PEPPER configurado (pepper efêmero) e não vaza e-mail nem hash na saída', async () => {
    expect(env.EMAIL_HASH_PEPPER).toBe('')
    mockReads()
    const serialized = JSON.stringify(await runBackfillEmailConsent({ dryRun: true }))
    expect(serialized).not.toMatch(/@/)
    expect(serialized).not.toMatch(/[0-9a-f]{64}/)
  })

  it('a consulta de pedidos projeta só as chaves de consentimento (sem nome, telefone, documento, endereço)', async () => {
    mockReads()
    await runBackfillEmailConsent()
    const ordersSql = String(prismaMock.$queryRaw.mock.calls[0][0].sql)
    expect(ordersSql).toContain('accepts_marketing')
    expect(ordersSql).not.toMatch(/customerName|customerPhone|normalizedPhone|document|address|cpf/i)
    const checkoutSql = String(prismaMock.$queryRaw.mock.calls[1][0].sql)
    expect(checkoutSql).not.toMatch(/customerName|customerPhone|normalizedPhone|document|address|cpf/i)
  })

  it('lê uma consulta por vez (sem paralelismo) para respeitar o limite de conexões', async () => {
    let inFlight = 0
    let maxInFlight = 0
    prismaMock.$queryRaw.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return []
    })
    await runBackfillEmailConsent()
    expect(maxInFlight).toBe(1)
  })
})

describe('runBackfillEmailConsent — escrita', () => {
  it('recusa gravar sem o pepper real, antes de ler ou escrever qualquer coisa', async () => {
    await expect(runBackfillEmailConsent({ dryRun: false })).rejects.toThrow(EmailHashPepperNotConfiguredError)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('recusa gravar em ambiente Preview read-only', async () => {
    env.CRM_PREVIEW_READONLY = true
    await expect(runBackfillEmailConsent({ dryRun: false, pepper: PEPPER })).rejects.toThrow(EmailConsentBackfillRefusedError)
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('grava o livro-razão e o estado, e é idempotente numa segunda execução', async () => {
    mockReads()
    const first = await runBackfillEmailConsent({ dryRun: false, pepper: PEPPER })
    expect(first.mode).toBe('WRITE')
    expect(first.write).toEqual({ eventsInserted: 9, statesWritten: 6 })
    expect(store.events).toHaveLength(9)
    expect(store.states.size).toBe(6)

    mockReads()
    const second = await runBackfillEmailConsent({ dryRun: false, pepper: PEPPER })
    expect(second.write?.eventsInserted).toBe(0)
    expect(store.events).toHaveLength(9)
  })

  it('só grava com dryRun explicitamente false (qualquer outro valor é dry-run)', async () => {
    mockReads()
    const result = await runBackfillEmailConsent({ dryRun: undefined, pepper: PEPPER })
    expect(result.mode).toBe('DRY_RUN')
    expect(tx.emailConsentEvent.createMany).not.toHaveBeenCalled()
    expect(tx.emailMarketingConsent.upsert).not.toHaveBeenCalled()
  })
})
