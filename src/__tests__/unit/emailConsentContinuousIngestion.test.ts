import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', async () => {
  const { emailDb } = await import('../fixtures/inMemoryEmailDb')
  return { prisma: emailDb.prisma }
})

import { emailDb } from '../fixtures/inMemoryEmailDb'
import { env } from '../../config/env'
import { hashEmail, ingestObservedConsentInTx, recordEmailConsentEvent } from '../../services/emailConsentService'
import { suppressEmail } from '../../services/emailSuppressionService'

const PEPPER = 'p'.repeat(40)
const ANA = 'ana@example.com'
const T0 = new Date('2026-09-25T12:00:00Z')

const orderPayload = (accepts: unknown, updatedAt = '2026-09-25T11:00:00Z'): unknown => ({
  customer: { accepts_marketing: accepts, accepts_marketing_updated_at: updatedAt },
})
const checkoutPayload = (accepts: unknown): unknown => ({ contact_accepts_marketing: accepts })

async function ingest(
  input: Partial<Parameters<typeof ingestObservedConsentInTx>[1]> = {},
  options: { enabled?: boolean; pepper?: string } = { enabled: true, pepper: PEPPER },
) {
  return emailDb.prisma.$transaction((tx) =>
    ingestObservedConsentInTx(
      tx as never,
      { kind: 'order', externalId: 'o1', email: ANA, customerId: null, rawPayload: orderPayload(true), capturedAt: T0, ...input },
      options,
    ),
  )
}

const stateOf = (email = ANA) => emailDb.states.get(hashEmail(email, PEPPER))

beforeEach(() => {
  emailDb.reset()
  env.EMAIL_HASH_PEPPER = PEPPER
})

describe('ingestão contínua do livro-razão (evidência observada da Nuvemshop)', () => {
  it('accepts_marketing=true → evento OPT_IN + projeção OPT_IN', async () => {
    const r = await ingest()
    expect(r).toEqual({ recorded: true, status: 'OPT_IN' })
    expect(emailDb.events).toHaveLength(1)
    expect(emailDb.events[0]).toMatchObject({ source: 'NUVEMSHOP_ORDER_PAYLOAD', status: 'OPT_IN' })
    expect(stateOf()?.status).toBe('OPT_IN')
  })

  it('accepts_marketing=false → OPT_OUT', async () => {
    await ingest({ rawPayload: orderPayload(false) })
    expect(stateOf()?.status).toBe('OPT_OUT')
  })

  it('ausente / null / string "true" → nenhum evento e nenhuma projeção (não inventa evidência)', async () => {
    for (const bad of [undefined, null, 'true', 1]) {
      const r = await ingest({ rawPayload: orderPayload(bad), externalId: `o-${String(bad)}` })
      expect(r).toEqual({ recorded: false, skipped: 'no_signal' })
    }
    expect(emailDb.events).toHaveLength(0)
    expect(emailDb.states.size).toBe(0)
  })

  it('checkout usa a fonte NUVEMSHOP_CHECKOUT_PAYLOAD', async () => {
    await ingest({ kind: 'checkout', externalId: 'c1', rawPayload: checkoutPayload(true) })
    expect(emailDb.events[0].source).toBe('NUVEMSHOP_CHECKOUT_PAYLOAD')
    expect(emailDb.events[0].evidenceRef).toMatch(/^checkout:c1:/)
  })

  it('duplicata (mesmo hash+fonte+evidenceRef) → 1 evento; reprocessar é no-op', async () => {
    await ingest()
    await ingest()
    await ingest()
    expect(emailDb.events).toHaveLength(1)
  })

  it('snapshots de pedidos contraditórios → UNKNOWN/SIGNAL_CONFLICT (fail-closed); histórico preservado, append-only', async () => {
    await ingest({ externalId: 'o1', rawPayload: orderPayload(true, '2026-09-20T00:00:00Z') })
    await ingest({ externalId: 'o2', rawPayload: orderPayload(false, '2026-09-25T00:00:00Z'), capturedAt: new Date('2026-09-26T00:00:00Z') })
    expect(emailDb.events).toHaveLength(2)
    expect(stateOf()).toMatchObject({ status: 'UNKNOWN', reason: 'SIGNAL_CONFLICT' })
  })

  it('descadastro forte (CRM_UNSUBSCRIBE) continua prevalecendo sobre um OPT_IN posterior do checkout', async () => {
    await recordEmailConsentEvent({ email: ANA, status: 'OPT_OUT', source: 'CRM_UNSUBSCRIBE', evidenceRef: 'unsub:1', capturedAt: new Date('2026-09-24T00:00:00Z') }, PEPPER)
    await ingest({ rawPayload: orderPayload(true, '2026-09-26T00:00:00Z'), capturedAt: new Date('2026-09-26T00:00:00Z') })
    expect(stateOf()?.status).toBe('OPT_OUT')
  })

  it('supressão continua vencendo: o ledger registra o OPT_IN mas a linha de supressão segue existindo', async () => {
    await suppressEmail({ email: ANA, reason: 'UNSUBSCRIBE', evidenceRef: 'unsub:2' }, PEPPER)
    await ingest()
    expect(emailDb.suppressions.has(hashEmail(ANA, PEPPER))).toBe(true)
  })

  it('FLAG DESLIGADA → zero escrita (padrão)', async () => {
    const r = await ingest({}, { enabled: false, pepper: PEPPER })
    expect(r).toEqual({ recorded: false, skipped: 'disabled' })
    expect(emailDb.events).toHaveLength(0)
    expect(emailDb.states.size).toBe(0)
  })

  it('sem flag explícita usa o default do ambiente (false)', async () => {
    env.EMAIL_CONSENT_CONTINUOUS_INGESTION_ENABLED = false
    const r = await emailDb.prisma.$transaction((tx) =>
      ingestObservedConsentInTx(tx as never, { kind: 'order', externalId: 'o9', email: ANA, customerId: null, rawPayload: orderPayload(true), capturedAt: T0 }),
    )
    expect(r).toEqual({ recorded: false, skipped: 'disabled' })
    expect(emailDb.events).toHaveLength(0)
  })

  it('sem pepper → fail-closed, sem escrita e sem lançar', async () => {
    const r = await ingest({}, { enabled: true, pepper: '' })
    expect(r).toEqual({ recorded: false, skipped: 'pepper_not_configured' })
    expect(emailDb.events).toHaveLength(0)
  })

  it('sem e-mail / e-mail inválido → ignorado', async () => {
    expect(await ingest({ email: null })).toEqual({ recorded: false, skipped: 'no_email' })
    expect(await ingest({ email: 'nao-e-email' })).toEqual({ recorded: false, skipped: 'invalid_email' })
    expect(emailDb.events).toHaveLength(0)
  })

  it('durabilidade/atomicidade: se a transação do pedido falha depois, NENHUM evento órfão fica no ledger', async () => {
    await expect(
      emailDb.prisma.$transaction(async (tx) => {
        await ingestObservedConsentInTx(tx as never, { kind: 'order', externalId: 'o1', email: ANA, customerId: null, rawPayload: orderPayload(true), capturedAt: T0 }, { enabled: true, pepper: PEPPER })
        throw new Error('falha ao gravar o pedido')
      }),
    ).rejects.toThrow()
    expect(emailDb.events).toHaveLength(0)
    expect(emailDb.states.size).toBe(0)
  })

  it('nenhum e-mail em claro no ledger nem na projeção', async () => {
    await ingest()
    const dump = JSON.stringify({ events: emailDb.events, states: [...emailDb.states.values()] })
    expect(dump).not.toContain('ana@example.com')
  })
})
