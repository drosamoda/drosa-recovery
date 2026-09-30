import { describe, expect, it, vi } from 'vitest'

const PEPPER = vi.hoisted(() => {
  const value = 'pepper-de-teste-0123456789-abcdefghijklmnop'
  process.env.EMAIL_HASH_PEPPER = value
  return value
})

import {
  buildEmailAudienceSnapshot,
  EmailBaseQuality,
  EmailIdentityRow,
  EmailIdentityRowWithEmail,
  loadEmailIdentityRowsExcludingSuppressed,
  SuppressionFilterDeps,
} from '../../services/emailAudienceEngine'
import { hashEmail } from '../../services/emailConsentService'

const NOW = new Date('2026-09-29T12:00:00.000Z')
const QUALITY: EmailBaseQuality = { totalCustomers: 5, customersWithoutEmail: 0, paidOrders: 5, paidOrdersWithoutEmail: 0, paidOrdersWithoutDate: 0 }
const H = (email: string): string => hashEmail(email, PEPPER)

function row(overrides: Partial<EmailIdentityRow> = {}): EmailIdentityRow {
  return { validEmail: true, paidOrderCount: 1, paidTotal: 100, lastPaidAt: new Date('2026-09-20T00:00:00Z'), undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false, ...overrides }
}
const identity = (email: string): EmailIdentityRowWithEmail => ({ email, ...row() })

function deps(overrides: Partial<SuppressionFilterDeps> = {}): SuppressionFilterDeps {
  return {
    pepperConfigured: () => true,
    loadSuppressedHashes: async () => new Set<string>(),
    loadOptInHashes: async () => new Set<string>(),
    queryRows: async () => [],
    queryRowsWithEmail: async () => [],
    hash: (email: string) => H(email),
    ...overrides,
  }
}

const ALL = (snapshot: ReturnType<typeof buildEmailAudienceSnapshot>) => snapshot.segments.find((s) => s.segmentKey === 'ALL_EMAIL_CUSTOMERS')!

describe('audiência × consentimento (ledger)', () => {
  it('e-mails válidos ≠ elegíveis por consentimento: só opt-in confirmado entra em consentOptInCount', async () => {
    const optIn = 'optin@example.test', optOut = 'optout@example.test', conflict = 'conflito@example.test', none = 'semledger@example.test', suppressedOptIn = 'suprimido@example.test'
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, deps({
      queryRowsWithEmail: async () => [identity(optIn), identity(optOut), identity(conflict), identity(none), identity(suppressedOptIn)],
      loadOptInHashes: async () => new Set([H(optIn), H(suppressedOptIn)]),
      loadSuppressedHashes: async () => new Set([H(suppressedOptIn)]),
    }))

    expect(result.consent).toEqual({ status: 'APPLIED' })
    expect(result.rows).toHaveLength(4) // o suprimido saiu
    const snapshot = buildEmailAudienceSnapshot(result.rows, QUALITY, NOW, result.suppression, result.consent)
    const all = ALL(snapshot)
    expect(all.withValidEmailCount).toBe(4) // bruto (menos suprimidos)
    expect(all.consentOptInCount).toBe(1) // só o opt-in não suprimido
  })

  it('contato sem ledger, em conflito ou em opt-out NÃO é contado como opt-in', async () => {
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, deps({
      queryRowsWithEmail: async () => [identity('a@example.test'), identity('b@example.test'), identity('c@example.test')],
      loadOptInHashes: async () => new Set<string>(), // ninguém com OPT_IN
    }))
    const all = ALL(buildEmailAudienceSnapshot(result.rows, QUALITY, NOW, result.suppression, result.consent))
    expect(all.consentOptInCount).toBe(0)
    expect(all.withValidEmailCount).toBe(3)
  })

  it('consentOptInCount NUNCA vira sendEligibleCount (envio ainda passa por gate, cooldown e consentimento ao vivo)', async () => {
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, deps({
      queryRowsWithEmail: async () => [identity('a@example.test')],
      loadOptInHashes: async () => new Set([H('a@example.test')]),
    }))
    const snapshot = buildEmailAudienceSnapshot(result.rows, QUALITY, NOW, result.suppression, result.consent)
    expect(snapshot.segments.every((s) => s.sendEligibleCount === null)).toBe(true)
  })

  it('ledger indisponível → contagem null (não zero) e o motivo é declarado', async () => {
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, deps({
      queryRowsWithEmail: async () => [identity('a@example.test')],
      loadOptInHashes: async () => { throw new Error('relation "email_marketing_consents" does not exist') },
    }))
    expect(result.consent).toEqual({ status: 'UNAVAILABLE' })
    const snapshot = buildEmailAudienceSnapshot(result.rows, QUALITY, NOW, result.suppression, result.consent)
    expect(ALL(snapshot).consentOptInCount).toBeNull()
    expect(snapshot.consent).toEqual({ status: 'UNAVAILABLE' })
  })

  it('sem o argumento de consentimento o construtor puro declara que não avaliou (null)', () => {
    const snapshot = buildEmailAudienceSnapshot([row()], QUALITY, NOW)
    expect(ALL(snapshot).consentOptInCount).toBeNull()
  })

  it('sem pepper: nada é hasheado e a contagem fica null', async () => {
    const result = await loadEmailIdentityRowsExcludingSuppressed(NOW, deps({ pepperConfigured: () => false, queryRows: async () => [row()] }))
    expect(result.consent).toEqual({ status: 'UNAVAILABLE' })
  })
})
