import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface LedgerRow {
  emailHash: string
  customerId: string | null
  status: 'OPT_IN' | 'OPT_OUT' | 'UNKNOWN'
  source: string
  evidenceRef: string
  sourceUpdatedAt: Date | null
  capturedAt: Date
}

interface StateRow {
  emailHash: string
  status: 'OPT_IN' | 'OPT_OUT' | 'UNKNOWN'
  reason: string
  eventCount: number
  lastEventAt: Date | null
}

// Livro-razão em memória que respeita a unicidade real do schema
// (emailHash, source, evidenceRef) — assim a idempotência é testada de verdade.
const { store, tx, prismaMock } = vi.hoisted(() => {
  const store = { events: [] as LedgerRow[], states: new Map<string, StateRow>() }
  const tx = {
    emailConsentEvent: {
      createMany: vi.fn(async ({ data }: { data: LedgerRow[] }) => {
        let count = 0
        for (const row of data) {
          const duplicate = store.events.some(
            (e) => e.emailHash === row.emailHash && e.source === row.source && e.evidenceRef === row.evidenceRef,
          )
          if (!duplicate) {
            store.events.push({ ...row })
            count++
          }
        }
        return { count }
      }),
      findMany: vi.fn(async ({ where }: { where: { emailHash: { in: string[] } } }) =>
        store.events.filter((e) => where.emailHash.in.includes(e.emailHash)),
      ),
    },
    emailMarketingConsent: {
      upsert: vi.fn(async ({ where, create, update }: { where: { emailHash: string }; create: StateRow; update: Partial<StateRow> }) => {
        const existing = store.states.get(where.emailHash)
        store.states.set(where.emailHash, existing ? { ...existing, ...update } : { ...create })
      }),
    },
  }
  const prismaMock = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    emailMarketingConsent: { findUnique: vi.fn() },
  }
  return { store, tx, prismaMock }
})

vi.mock('../../config/prisma', () => ({ prisma: prismaMock }))

import {
  buildBackfillEvents,
  EmailHashPepperNotConfiguredError,
  getEmailConsentState,
  hashEmail,
  InvalidConsentEventError,
  previewBackfill,
  recordEmailConsentEvent,
  writeBackfill,
} from '../../services/emailConsentService'

const PEPPER = 'p'.repeat(32)
const T = (iso: string): Date => new Date(iso)

beforeEach(() => {
  vi.clearAllMocks()
  store.events.length = 0
  store.states.clear()
})

describe('hashEmail', () => {
  it('é o HMAC-SHA256 do e-mail normalizado com o pepper', () => {
    const expected = createHmac('sha256', PEPPER).update('maria@exemplo.com').digest('hex')
    expect(hashEmail('maria@exemplo.com', PEPPER)).toBe(expected)
  })

  it('ignora caixa e espaços', () => {
    expect(hashEmail('  Maria@Exemplo.COM ', PEPPER)).toBe(hashEmail('maria@exemplo.com', PEPPER))
  })

  it('muda com o pepper e não contém o e-mail', () => {
    const a = hashEmail('maria@exemplo.com', PEPPER)
    expect(a).not.toBe(hashEmail('maria@exemplo.com', 'q'.repeat(32)))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toContain('maria')
  })

  it.each([[''], ['curto'], ['x'.repeat(31)]])('recusa pepper ausente/curto (%j)', (pepper) => {
    expect(() => hashEmail('maria@exemplo.com', pepper)).toThrow(EmailHashPepperNotConfiguredError)
  })

  it('a mensagem de erro de e-mail inválido não vaza o valor', () => {
    expect(() => hashEmail('segredo-sem-arroba', PEPPER)).toThrowError(/inválido/)
    try {
      hashEmail('segredo-sem-arroba', PEPPER)
    } catch (error) {
      expect(String(error)).not.toContain('segredo')
    }
  })
})

describe('recordEmailConsentEvent', () => {
  const base = { email: 'maria@exemplo.com', evidenceRef: 'order:1:customer.accepts_marketing' }

  it('grava só o hash (nunca o e-mail) e devolve o estado resolvido', async () => {
    const resolution = await recordEmailConsentEvent(
      { ...base, status: 'OPT_IN', source: 'NUVEMSHOP_ORDER_PAYLOAD', sourceUpdatedAt: T('2026-08-01T00:00:00Z'), capturedAt: T('2026-08-01T00:00:00Z') },
      PEPPER,
    )
    expect(resolution.state).toBe('CONFIRMED_OPT_IN')

    const written = tx.emailConsentEvent.createMany.mock.calls[0][0]
    expect(written.data[0].emailHash).toBe(hashEmail(base.email, PEPPER))
    expect(JSON.stringify(written)).not.toContain('maria')
    expect(JSON.stringify([...store.states.values()])).not.toContain('maria')
    expect(store.states.get(hashEmail(base.email, PEPPER))).toMatchObject({ status: 'OPT_IN', reason: 'SNAPSHOTS_UNANIMOUS', eventCount: 1 })
  })

  it('é idempotente: o mesmo evento duas vezes não duplica nem muda o estado', async () => {
    const input = { ...base, status: 'OPT_IN', source: 'NUVEMSHOP_ORDER_PAYLOAD', capturedAt: T('2026-08-01T00:00:00Z') } as const
    await recordEmailConsentEvent(input, PEPPER)
    const second = await recordEmailConsentEvent(input, PEPPER)
    expect(store.events).toHaveLength(1)
    expect(second.eventCount).toBe(1)
  })

  it('um descadastro no CRM depois do opt-in torna o estado OPT_OUT e bloqueia um novo true da loja', async () => {
    await recordEmailConsentEvent({ ...base, status: 'OPT_IN', source: 'NUVEMSHOP_ORDER_PAYLOAD', capturedAt: T('2026-08-01T00:00:00Z') }, PEPPER)
    const afterUnsub = await recordEmailConsentEvent(
      { email: base.email, status: 'OPT_OUT', source: 'CRM_UNSUBSCRIBE', evidenceRef: 'unsub:token-1', capturedAt: T('2026-08-10T00:00:00Z') },
      PEPPER,
    )
    expect(afterUnsub).toMatchObject({ state: 'CONFIRMED_OPT_OUT', reason: 'HARD_REVOCATION' })

    const afterNewOrder = await recordEmailConsentEvent(
      { email: base.email, status: 'OPT_IN', source: 'NUVEMSHOP_ORDER_PAYLOAD', evidenceRef: 'order:2:customer.accepts_marketing', capturedAt: T('2026-09-01T00:00:00Z') },
      PEPPER,
    )
    expect(afterNewOrder.state).toBe('CONFIRMED_OPT_OUT')
  })

  it('recusa OPT_IN vindo de fonte só-recusa e evidenceRef vazio, sem tocar no banco', async () => {
    await expect(recordEmailConsentEvent({ ...base, status: 'OPT_IN', source: 'CRM_UNSUBSCRIBE' }, PEPPER)).rejects.toThrow(InvalidConsentEventError)
    await expect(recordEmailConsentEvent({ ...base, status: 'OPT_IN', source: 'PROVIDER_EVENT' }, PEPPER)).rejects.toThrow(InvalidConsentEventError)
    await expect(recordEmailConsentEvent({ ...base, evidenceRef: '  ', status: 'OPT_OUT', source: 'CRM_UNSUBSCRIBE' }, PEPPER)).rejects.toThrow(InvalidConsentEventError)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('falha alto sem pepper, sem gravar nada', async () => {
    await expect(recordEmailConsentEvent({ ...base, status: 'OPT_OUT', source: 'CRM_UNSUBSCRIBE' }, '')).rejects.toThrow(EmailHashPepperNotConfiguredError)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

describe('getEmailConsentState', () => {
  it('sem linha é NOT_COLLECTED', async () => {
    prismaMock.emailMarketingConsent.findUnique.mockResolvedValue(null)
    expect(await getEmailConsentState('maria@exemplo.com', PEPPER)).toEqual({ state: 'NOT_COLLECTED', reason: null })
  })

  it.each([
    ['OPT_IN', 'CONFIRMED_OPT_IN'],
    ['OPT_OUT', 'CONFIRMED_OPT_OUT'],
    ['UNKNOWN', 'UNKNOWN'],
  ] as const)('mapeia %s para %s', async (status, state) => {
    prismaMock.emailMarketingConsent.findUnique.mockResolvedValue({ status, reason: 'X' })
    expect(await getEmailConsentState('maria@exemplo.com', PEPPER)).toEqual({ state, reason: 'X' })
  })

  it('consulta pela hash, não pelo e-mail', async () => {
    prismaMock.emailMarketingConsent.findUnique.mockResolvedValue(null)
    await getEmailConsentState('maria@exemplo.com', PEPPER)
    expect(prismaMock.emailMarketingConsent.findUnique.mock.calls[0][0].where).toEqual({ emailHash: hashEmail('maria@exemplo.com', PEPPER) })
  })

  it('e-mail inválido é NOT_COLLECTED (fail-closed) sem consultar o banco; falta de pepper propaga', async () => {
    expect(await getEmailConsentState('lixo', PEPPER)).toEqual({ state: 'NOT_COLLECTED', reason: null })
    expect(prismaMock.emailMarketingConsent.findUnique).not.toHaveBeenCalled()
    await expect(getEmailConsentState('maria@exemplo.com', '')).rejects.toThrow(EmailHashPepperNotConfiguredError)
  })
})

// Cenário que espelha a política conservadora da auditoria de 21/09/2026
// (2.122 / 1.532 / 97 / 4) em miniatura.
const order = (id: string, email: string | null, accepts: unknown, at = '2026-08-01T00:00:00Z') => ({
  nuvemshopOrderId: id,
  email,
  customerId: null,
  rawPayload: { customer: { accepts_marketing: accepts, accepts_marketing_updated_at: at } },
  capturedAt: T('2026-08-02T00:00:00Z'),
})
const checkout = (id: string, email: string | null, accepts: unknown) => ({
  nuvemshopCheckoutId: id,
  email,
  customerId: null,
  rawPayload: { contact_accepts_marketing: accepts, contact_accepts_marketing_updated_at: '2026-08-05T00:00:00Z' },
  capturedAt: T('2026-08-06T00:00:00Z'),
})

const fixtureRows = {
  orders: [
    order('1', 'a@x.com', true), // A: opt-in por pedido
    order('2', 'd@x.com', true, '2026-07-01T00:00:00Z'), // D: dois pedidos true
    order('3', 'D@x.com', true, '2026-08-01T00:00:00Z'),
    order('4', 'c@x.com', true), // C: pedido true + checkout false = conflito
    order('5', 'e@x.com', false, '2026-07-01T00:00:00Z'), // E: dois false
    order('6', 'e@x.com', false, '2026-08-01T00:00:00Z'),
    order('7', 'f@x.com', 'true'), // F: valor não booleano → sem sinal
    order('8', null, true), // sem e-mail
    order('9', 'sem-arroba', true), // e-mail inválido
  ],
  checkouts: [checkout('c1', 'b@x.com', false), checkout('c2', 'c@x.com', false)],
}

describe('buildBackfillEvents / previewBackfill', () => {
  it('monta eventos com evidenceRef por origem e caminho, sem PII', () => {
    const plan = buildBackfillEvents(fixtureRows, PEPPER)
    const refs = plan.events.map((e) => e.evidenceRef)
    expect(refs).toContain('order:1:customer.accepts_marketing')
    expect(refs).toContain('checkout:c1:contact_accepts_marketing')
    expect(JSON.stringify(plan.events)).not.toMatch(/@x\.com/)
    expect(plan.skipped).toEqual({ noEmail: 1, invalidEmail: 1, noSignal: 1 })
  })

  it('usa o customer embrulhado em fetchedOrderPayload', () => {
    const plan = buildBackfillEvents(
      { orders: [{ nuvemshopOrderId: '10', email: 'g@x.com', customerId: 'cus_1', rawPayload: { fetchedOrderPayload: { customer: { accepts_marketing: true } } }, capturedAt: T('2026-08-02T00:00:00Z') }], checkouts: [] },
      PEPPER,
    )
    expect(plan.events[0]).toMatchObject({ evidenceRef: 'order:10:fetchedOrderPayload.customer.accepts_marketing', customerId: 'cus_1', sourceUpdatedAt: null })
  })

  it('a prévia reproduz a política conservadora: agrega por e-mail sem escrever nada', () => {
    const preview = previewBackfill(buildBackfillEvents(fixtureRows, PEPPER))
    expect(preview.emailsWithEvents).toBe(5) // a, b, c, d, e (f não tem sinal)
    expect(preview.byState).toEqual({ CONFIRMED_OPT_IN: 2, CONFIRMED_OPT_OUT: 2, UNKNOWN: 1, NOT_COLLECTED: 0 })
    expect(preview.byReason).toMatchObject({ SNAPSHOTS_UNANIMOUS: 4, SIGNAL_CONFLICT: 1 })
    expect(preview.eventsBySource).toEqual({ NUVEMSHOP_ORDER_PAYLOAD: 6, NUVEMSHOP_CHECKOUT_PAYLOAD: 2 })
    expect(preview.eventsTotal).toBe(8)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('normaliza o e-mail: D@x.com e d@x.com são a mesma identidade', () => {
    const plan = buildBackfillEvents({ orders: [order('2', 'd@x.com', true), order('3', 'D@x.com', true)], checkouts: [] }, PEPPER)
    expect(new Set(plan.events.map((e) => e.emailHash)).size).toBe(1)
  })
})

describe('writeBackfill', () => {
  it('grava eventos e estados em lotes e devolve só contagens', async () => {
    const plan = buildBackfillEvents(fixtureRows, PEPPER)
    const result = await writeBackfill(plan, 2)
    expect(result).toEqual({ eventsInserted: 8, statesWritten: 5 })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(3) // 5 hashes em lotes de 2
    expect(store.events).toHaveLength(8)
    const byStatus = [...store.states.values()].reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }), {})
    expect(byStatus).toEqual({ OPT_IN: 2, OPT_OUT: 2, UNKNOWN: 1 })
  })

  it('é idempotente: reexecutar não insere de novo e chega ao mesmo estado', async () => {
    const plan = buildBackfillEvents(fixtureRows, PEPPER)
    await writeBackfill(plan)
    const snapshot = JSON.stringify([...store.states.entries()])
    const second = await writeBackfill(plan)
    expect(second.eventsInserted).toBe(0)
    expect(JSON.stringify([...store.states.entries()])).toBe(snapshot)
  })

  it('não apaga nem sobrescreve uma revogação já registrada no livro-razão', async () => {
    await recordEmailConsentEvent(
      { email: 'a@x.com', status: 'OPT_OUT', source: 'CRM_UNSUBSCRIBE', evidenceRef: 'unsub:1', capturedAt: T('2026-08-10T00:00:00Z') },
      PEPPER,
    )
    await writeBackfill(buildBackfillEvents(fixtureRows, PEPPER))
    expect(store.states.get(hashEmail('a@x.com', PEPPER))).toMatchObject({ status: 'OPT_OUT', reason: 'HARD_REVOCATION' })
  })

  it('plano vazio não abre transação', async () => {
    expect(await writeBackfill({ events: [], skipped: { noEmail: 0, invalidEmail: 0, noSignal: 0 } })).toEqual({ eventsInserted: 0, statesWritten: 0 })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
