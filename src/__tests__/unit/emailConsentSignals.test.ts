import { describe, expect, it } from 'vitest'
import {
  extractCheckoutConsentSignal,
  extractOrderConsentSignal,
  normalizeEmail,
} from '../../services/emailConsentSignals'

describe('normalizeEmail', () => {
  it.each([
    ['  Maria@Exemplo.COM ', 'maria@exemplo.com'],
    ['a@b.co', 'a@b.co'],
  ])('normaliza %j para %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected)
  })

  it.each([[''], ['   '], ['sem-arroba'], ['a@b'], ['a b@c.com'], [null], [undefined], [42], [{}]])(
    'rejeita %j',
    (input) => {
      expect(normalizeEmail(input)).toBeNull()
    },
  )
})

describe('extractOrderConsentSignal', () => {
  it('lê customer.accepts_marketing no payload plano do webhook', () => {
    const signal = extractOrderConsentSignal({
      id: 1,
      customer: { accepts_marketing: true, accepts_marketing_updated_at: '2026-08-01T12:00:00+0000' },
    })
    expect(signal).toEqual({
      status: 'OPT_IN',
      sourceUpdatedAt: new Date('2026-08-01T12:00:00+0000'),
      evidencePath: 'customer.accepts_marketing',
    })
  })

  it('lê o customer embrulhado em fetchedOrderPayload', () => {
    const signal = extractOrderConsentSignal({
      originalWebhookPayload: { id: 1 },
      fetchedOrderPayload: { customer: { accepts_marketing: false, accepts_marketing_updated_at: '2026-07-01T00:00:00Z' } },
    })
    expect(signal?.status).toBe('OPT_OUT')
    expect(signal?.evidencePath).toBe('fetchedOrderPayload.customer.accepts_marketing')
    expect(signal?.sourceUpdatedAt).toEqual(new Date('2026-07-01T00:00:00Z'))
  })

  it('prefere o customer da raiz quando os dois existem', () => {
    const signal = extractOrderConsentSignal({
      customer: { accepts_marketing: true },
      fetchedOrderPayload: { customer: { accepts_marketing: false } },
    })
    expect(signal?.status).toBe('OPT_IN')
    expect(signal?.evidencePath).toBe('customer.accepts_marketing')
  })

  it('mantém o sinal mas devolve sourceUpdatedAt null quando a data é ausente ou inválida', () => {
    expect(extractOrderConsentSignal({ customer: { accepts_marketing: true } })?.sourceUpdatedAt).toBeNull()
    expect(
      extractOrderConsentSignal({ customer: { accepts_marketing: true, accepts_marketing_updated_at: 'ontem' } })
        ?.sourceUpdatedAt,
    ).toBeNull()
    expect(
      extractOrderConsentSignal({ customer: { accepts_marketing: true, accepts_marketing_updated_at: 123 } })
        ?.sourceUpdatedAt,
    ).toBeNull()
  })

  // Fail-closed: valor que não é booleano NUNCA vira consentimento nem recusa.
  it.each([
    [{ customer: { accepts_marketing: 'true' } }],
    [{ customer: { accepts_marketing: 1 } }],
    [{ customer: { accepts_marketing: null } }],
    [{ customer: {} }],
    [{ customer: null }],
    [{ customer: [] }],
    [{}],
    [null],
    ['texto'],
    [[]],
  ])('não produz sinal para %j', (payload) => {
    expect(extractOrderConsentSignal(payload)).toBeNull()
  })

  it('não olha accepts_marketing fora de customer (ex.: na raiz do pedido)', () => {
    expect(extractOrderConsentSignal({ accepts_marketing: true })).toBeNull()
  })
})

describe('extractCheckoutConsentSignal', () => {
  it('lê contact_accepts_marketing e a data', () => {
    expect(
      extractCheckoutConsentSignal({
        contact_accepts_marketing: false,
        contact_accepts_marketing_updated_at: '2026-09-01T10:00:00Z',
      }),
    ).toEqual({
      status: 'OPT_OUT',
      sourceUpdatedAt: new Date('2026-09-01T10:00:00Z'),
      evidencePath: 'contact_accepts_marketing',
    })
  })

  it.each([
    [{ contact_accepts_marketing: 'false' }],
    [{ contact_accepts_marketing: null }],
    [{ accepts_marketing: true }],
    [{}],
    [null],
    [undefined],
  ])('não produz sinal para %j', (payload) => {
    expect(extractCheckoutConsentSignal(payload)).toBeNull()
  })
})
