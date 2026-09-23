import { beforeEach, describe, expect, it, vi } from 'vitest'

// env.ts lê process.env no import; o pepper existe só neste arquivo de teste.
const PEPPER = vi.hoisted(() => {
  const value = 'pepper-de-teste-0123456789-abcdefghijklmnop'
  process.env.EMAIL_HASH_PEPPER = value
  return value
})
const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }))

vi.mock('../../config/prisma', async () => {
  const { emailDb } = await import('../fixtures/inMemoryEmailDb')
  return { prisma: { ...emailDb.prisma, $queryRaw: mocks.queryRaw } }
})

import { emailDb } from '../fixtures/inMemoryEmailDb'
import {
  buildEmailAudienceSnapshot,
  EmailBaseQuality,
  EmailIdentityRow,
  EmailIdentityRowWithEmail,
  getEmailAudienceSnapshot,
  loadEmailIdentityRowsExcludingSuppressed,
  SuppressionFilterDeps,
} from '../../services/emailAudienceEngine'
import { hashEmail } from '../../services/emailConsentService'
import { suppressEmail } from '../../services/emailSuppressionService'

const NOW = new Date('2026-09-21T12:00:00.000Z')
const QUALITY: EmailBaseQuality = { totalCustomers: 10, customersWithoutEmail: 0, paidOrders: 5, paidOrdersWithoutEmail: 0, paidOrdersWithoutDate: 0 }

function row(overrides: Partial<EmailIdentityRow> = {}): EmailIdentityRow {
  return { validEmail: true, paidOrderCount: 1, paidTotal: 100, lastPaidAt: new Date('2026-09-01T00:00:00Z'), undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false, ...overrides }
}

function identity(email: string, overrides: Partial<EmailIdentityRow> = {}): EmailIdentityRowWithEmail {
  return { email, ...row(overrides) }
}

const H = (email: string): string => hashEmail(email, PEPPER)

function deps(overrides: Partial<SuppressionFilterDeps> = {}): SuppressionFilterDeps & { [K in keyof SuppressionFilterDeps]: ReturnType<typeof vi.fn> } {
  return {
    pepperConfigured: vi.fn().mockReturnValue(true),
    loadSuppressedHashes: vi.fn().mockResolvedValue(new Set<string>()),
    queryRows: vi.fn().mockResolvedValue([row(), row()]),
    queryRowsWithEmail: vi.fn().mockResolvedValue([]),
    hash: vi.fn((email: string) => H(email)),
    ...overrides,
  } as never
}

describe('loadEmailIdentityRowsExcludingSuppressed', () => {
  it('sem pepper: usa a leitura padrão (sem e-mail), não consulta a lista e declara UNAVAILABLE', async () => {
    const d = deps({ pepperConfigured: vi.fn().mockReturnValue(false) })
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, d)

    expect(result.suppression).toEqual({ status: 'UNAVAILABLE', excludedCount: 0, reason: 'PEPPER_NOT_CONFIGURED' })
    expect(result.rows).toHaveLength(2)
    expect(d.loadSuppressedHashes).not.toHaveBeenCalled()
    expect(d.queryRowsWithEmail).not.toHaveBeenCalled()
  })

  it('lista de supressão ilegível (ex.: tabela ainda não migrada): degrada só o filtro, sem vazar a causa', async () => {
    const d = deps({ loadSuppressedHashes: vi.fn().mockRejectedValue(new Error('relation "email_suppressions" does not exist')) })
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, d)

    expect(result.suppression).toEqual({ status: 'UNAVAILABLE', excludedCount: 0, reason: 'LOOKUP_FAILED' })
    expect(result.rows).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('email_suppressions')
    expect(d.queryRowsWithEmail).not.toHaveBeenCalled()
  })

  it('lista VAZIA: APPLIED com 0 excluídos, e o e-mail nem sai do banco (leitura padrão)', async () => {
    const d = deps()
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, d)

    expect(result.suppression).toEqual({ status: 'APPLIED', excludedCount: 0, reason: null })
    expect(d.queryRows).toHaveBeenCalledTimes(1)
    expect(d.queryRowsWithEmail).not.toHaveBeenCalled()
  })

  it('exclui os suprimidos, mantém os demais e devolve linhas SEM o campo email', async () => {
    const d = deps({
      loadSuppressedHashes: vi.fn().mockResolvedValue(new Set([H('suprimido@example.com')])),
      queryRowsWithEmail: vi.fn().mockResolvedValue([
        identity('suprimido@example.com', { paidOrderCount: 9 }),
        identity('ok1@example.com'),
        identity('ok2@example.com'),
      ]),
    })
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, d)

    expect(result.suppression).toEqual({ status: 'APPLIED', excludedCount: 1, reason: null })
    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((r) => !('email' in r))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('example.com')
    expect(result.rows.some((r) => r.paidOrderCount === 9)).toBe(false)
    expect(d.queryRows).not.toHaveBeenCalled()
  })

  it('a chave é a MESMA que a supressão grava: caixa e espaços diferentes ainda casam', async () => {
    const d = deps({
      loadSuppressedHashes: vi.fn().mockResolvedValue(new Set([H('Maria@Example.com')])),
      queryRowsWithEmail: vi.fn().mockResolvedValue([identity('  maria@example.com  ')]),
    })
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, d)
    expect(result.suppression.excludedCount).toBe(1)
    expect(result.rows).toHaveLength(0)
  })

  it('e-mail inválido nunca foi suprimido: fica na base como inválido, sem quebrar', async () => {
    const d = deps({
      loadSuppressedHashes: vi.fn().mockResolvedValue(new Set([H('x@example.com')])),
      queryRowsWithEmail: vi.fn().mockResolvedValue([identity('nao-e-email', { validEmail: false })]),
      hash: vi.fn().mockReturnValue(null),
    })
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, d)
    expect(result.rows).toHaveLength(1)
    expect(result.suppression.excludedCount).toBe(0)
  })

  it('falha ao calcular o hash no meio do lote: não usa filtro pela metade (tudo volta, UNAVAILABLE)', async () => {
    let calls = 0
    const d = deps({
      loadSuppressedHashes: vi.fn().mockResolvedValue(new Set([H('a@example.com')])),
      queryRowsWithEmail: vi.fn().mockResolvedValue([identity('a@example.com'), identity('b@example.com'), identity('c@example.com')]),
      hash: vi.fn((email: string) => {
        if (++calls === 2) throw new Error('boom')
        return H(email)
      }),
    })
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, d)

    expect(result.suppression).toEqual({ status: 'UNAVAILABLE', excludedCount: 0, reason: 'LOOKUP_FAILED' })
    expect(result.rows).toHaveLength(3) // nada foi excluído por um filtro incompleto
    expect(result.rows.every((r) => !('email' in r))).toBe(true)
  })

  it('erro de banco nas consultas de identidade PROPAGA (nenhum snapshot inventado)', async () => {
    const noPepper = deps({ pepperConfigured: vi.fn().mockReturnValue(false), queryRows: vi.fn().mockRejectedValue(new Error('db down')) })
    await expect(loadEmailIdentityRowsExcludingSuppressed(NOW, noPepper)).rejects.toThrow('db down')

    const withList = deps({
      loadSuppressedHashes: vi.fn().mockResolvedValue(new Set([H('a@example.com')])),
      queryRowsWithEmail: vi.fn().mockRejectedValue(new Error('db down 2')),
    })
    await expect(loadEmailIdentityRowsExcludingSuppressed(NOW, withList)).rejects.toThrow('db down 2')

    const emptyList = deps({ queryRows: vi.fn().mockRejectedValue(new Error('db down 3')) })
    await expect(loadEmailIdentityRowsExcludingSuppressed(NOW, emptyList)).rejects.toThrow('db down 3')
  })
})

describe('buildEmailAudienceSnapshot — campo suppression', () => {
  it('sem o argumento declara honestamente NOT_EVALUATED (o construtor puro não filtra nada)', () => {
    const snapshot = buildEmailAudienceSnapshot([row()], QUALITY, NOW)
    expect(snapshot.suppression).toEqual({ status: 'UNAVAILABLE', excludedCount: 0, reason: 'NOT_EVALUATED' })
  })

  it('repassa o estado informado e devolve uma cópia (não compartilha o objeto)', () => {
    const info = { status: 'APPLIED' as const, excludedCount: 4, reason: null }
    const snapshot = buildEmailAudienceSnapshot([row()], QUALITY, NOW, info)
    expect(snapshot.suppression).toEqual(info)
    expect(snapshot.suppression).not.toBe(info)
  })
})

describe('ponta a ponta: supressão gravada → contagens do painel', () => {
  beforeEach(() => {
    emailDb.reset()
    mocks.queryRaw.mockReset()
  })

  function sqlOf(call: unknown[]): string {
    return String((call[0] as { sql?: string }).sql ?? '')
  }

  it('e-mail suprimido some de base e segmentos; a consulta com e-mail só roda quando há suprimido', async () => {
    await suppressEmail({ email: 'Suprimido@Example.com', reason: 'UNSUBSCRIBE', evidenceRef: 'unsubscribe-link:s:1' }, PEPPER)
    mocks.queryRaw.mockResolvedValueOnce([
      { email: 'suprimido@example.com', ...row({ paidOrderCount: 3 }) },
      { email: 'ok1@example.com', ...row() },
      { email: 'ok2@example.com', ...row() },
      { email: 'nao-e-email', ...row({ validEmail: false }) },
    ])
    mocks.queryRaw.mockResolvedValueOnce([QUALITY])

    const snapshot = await getEmailAudienceSnapshot({ now: NOW })

    expect(snapshot.suppression).toEqual({ status: 'APPLIED', excludedCount: 1, reason: null })
    expect(snapshot.base.emailKnown).toBe(3)
    expect(snapshot.segments.find((s) => s.segmentKey === 'ALL_EMAIL_CUSTOMERS')?.audienceCount).toBe(3)
    expect(sqlOf(mocks.queryRaw.mock.calls[0])).toMatch(/p\.em AS "email"/)
    expect(JSON.stringify(snapshot)).not.toContain('example.com')
  })

  it('sem nenhum suprimido a leitura NÃO traz e-mail do banco (mesma consulta compacta de antes)', async () => {
    mocks.queryRaw.mockResolvedValueOnce([row(), row()])
    mocks.queryRaw.mockResolvedValueOnce([QUALITY])

    const snapshot = await getEmailAudienceSnapshot({ now: NOW })

    expect(snapshot.suppression).toEqual({ status: 'APPLIED', excludedCount: 0, reason: null })
    expect(snapshot.base.emailKnown).toBe(2)
    const identitySql = sqlOf(mocks.queryRaw.mock.calls[0])
    expect(identitySql).not.toMatch(/p\.em AS "email"/)
    expect(identitySql).toMatch(/SELECT \(length\(p\.em\)/)
  })

  it('a lista some do banco (tabela sem permissão): o painel continua, com o filtro declarado indisponível', async () => {
    const original = emailDb.prisma.emailSuppression.findMany
    emailDb.prisma.emailSuppression.findMany = async () => { throw new Error('permission denied for table email_suppressions') }
    try {
      mocks.queryRaw.mockResolvedValueOnce([row(), row(), row()])
      mocks.queryRaw.mockResolvedValueOnce([QUALITY])

      const snapshot = await getEmailAudienceSnapshot({ now: NOW })

      expect(snapshot.suppression).toEqual({ status: 'UNAVAILABLE', excludedCount: 0, reason: 'LOOKUP_FAILED' })
      expect(snapshot.base.emailKnown).toBe(3)
      expect(snapshot.sendEligibility).toBe('NOT_READY')
      expect(JSON.stringify(snapshot)).not.toContain('permission denied')
    } finally {
      emailDb.prisma.emailSuppression.findMany = original
    }
  })

  it('nenhuma contagem vira "elegível para envio": sendEligibleCount segue null mesmo com o filtro aplicado', async () => {
    await suppressEmail({ email: 'x@example.com', reason: 'HARD_BOUNCE', evidenceRef: 'provider:mock:1' }, PEPPER)
    mocks.queryRaw.mockResolvedValueOnce([{ email: 'y@example.com', ...row() }])
    mocks.queryRaw.mockResolvedValueOnce([QUALITY])

    const snapshot = await getEmailAudienceSnapshot({ now: NOW })
    expect(snapshot.segments.every((s) => s.sendEligibleCount === null)).toBe(true)
  })
})
