import { describe, expect, it } from 'vitest'
import {
  ConsentEventInput,
  EmailConsentSource,
  EmailConsentStatus,
  isConsentSendEligible,
  resolveEmailConsent,
} from '../../services/emailConsentResolver'

const CAPTURED = new Date('2026-09-01T00:00:00Z')

function ev(
  source: EmailConsentSource,
  status: EmailConsentStatus,
  sourceUpdatedAt: string | null,
  capturedAt: Date = CAPTURED,
): ConsentEventInput {
  return { source, status, sourceUpdatedAt: sourceUpdatedAt ? new Date(sourceUpdatedAt) : null, capturedAt }
}

const ORDER = 'NUVEMSHOP_ORDER_PAYLOAD' as const
const CHECKOUT = 'NUVEMSHOP_CHECKOUT_PAYLOAD' as const
const API = 'NUVEMSHOP_CUSTOMER_API' as const
const NUBESDK = 'NUBESDK_EXPLICIT' as const
const UNSUB = 'CRM_UNSUBSCRIBE' as const
const PROVIDER = 'PROVIDER_EVENT' as const
const MANUAL = 'MANUAL_IMPORT' as const

describe('resolveEmailConsent — sem sinal', () => {
  it('lista vazia é NOT_COLLECTED e nunca elegível', () => {
    const r = resolveEmailConsent([])
    expect(r).toMatchObject({ state: 'NOT_COLLECTED', status: null, reason: 'NO_SIGNAL', eventCount: 0, lastEventAt: null })
    expect(isConsentSendEligible(r.state)).toBe(false)
  })
})

// Política conservadora medida na auditoria (2.122 / 1.532 / 97 / 4): só
// snapshots de pedido/checkout, qualquer divergência impede o opt-in.
describe('resolveEmailConsent — só snapshots da Nuvemshop', () => {
  it('um único true é OPT_IN', () => {
    expect(resolveEmailConsent([ev(ORDER, 'OPT_IN', '2026-08-01T00:00:00Z')])).toMatchObject({
      state: 'CONFIRMED_OPT_IN',
      reason: 'SNAPSHOTS_UNANIMOUS',
    })
  })

  it('vários true (pedido + checkout) continuam OPT_IN', () => {
    const r = resolveEmailConsent([ev(ORDER, 'OPT_IN', '2026-08-01T00:00:00Z'), ev(CHECKOUT, 'OPT_IN', '2026-08-20T00:00:00Z')])
    expect(r.state).toBe('CONFIRMED_OPT_IN')
    expect(r.eventCount).toBe(2)
  })

  it('um único false é OPT_OUT e todos false também', () => {
    expect(resolveEmailConsent([ev(CHECKOUT, 'OPT_OUT', '2026-08-01T00:00:00Z')]).state).toBe('CONFIRMED_OPT_OUT')
    expect(
      resolveEmailConsent([ev(ORDER, 'OPT_OUT', '2026-08-01T00:00:00Z'), ev(CHECKOUT, 'OPT_OUT', '2026-08-02T00:00:00Z')]).state,
    ).toBe('CONFIRMED_OPT_OUT')
  })

  it.each([
    ['o mais recente é true', 'OPT_OUT', '2026-07-01T00:00:00Z', 'OPT_IN', '2026-08-01T00:00:00Z'],
    ['o mais recente é false', 'OPT_IN', '2026-07-01T00:00:00Z', 'OPT_OUT', '2026-08-01T00:00:00Z'],
  ] as const)('true e false entre snapshots é conflito (UNKNOWN) quando %s', (_label, s1, t1, s2, t2) => {
    const r = resolveEmailConsent([ev(ORDER, s1, t1), ev(CHECKOUT, s2, t2)])
    expect(r).toMatchObject({ state: 'UNKNOWN', status: 'UNKNOWN', reason: 'SIGNAL_CONFLICT' })
    expect(isConsentSendEligible(r.state)).toBe(false)
  })

  it('conflito entre dois pedidos da mesma fonte também é UNKNOWN', () => {
    const r = resolveEmailConsent([ev(ORDER, 'OPT_IN', '2026-07-01T00:00:00Z'), ev(ORDER, 'OPT_OUT', '2026-08-01T00:00:00Z')])
    expect(r.reason).toBe('SIGNAL_CONFLICT')
  })

  it('MANUAL_IMPORT com OPT_IN é só mais um snapshot: não substitui nem levanta nada', () => {
    const r = resolveEmailConsent([ev(ORDER, 'OPT_OUT', '2026-07-01T00:00:00Z'), ev(MANUAL, 'OPT_IN', '2026-08-01T00:00:00Z')])
    expect(r.state).toBe('UNKNOWN')
  })

  it('usa capturedAt quando o payload não trouxe data do consentimento', () => {
    const r = resolveEmailConsent([
      ev(ORDER, 'OPT_OUT', null, new Date('2026-06-01T00:00:00Z')),
      ev(API, 'OPT_IN', '2026-07-01T00:00:00Z'),
    ])
    // API (07-01) é mais nova que o snapshot (capturedAt 06-01) → API decide.
    expect(r).toMatchObject({ state: 'CONFIRMED_OPT_IN', reason: 'AUTHORITATIVE_LATEST' })
  })
})

describe('resolveEmailConsent — revogação explícita é permanente', () => {
  it.each([UNSUB, PROVIDER, NUBESDK, MANUAL] as const)('%s OPT_OUT vence snapshot true mais NOVO da Nuvemshop', (source) => {
    const r = resolveEmailConsent([
      ev(ORDER, 'OPT_IN', '2026-07-01T00:00:00Z'),
      ev(source, 'OPT_OUT', '2026-08-01T00:00:00Z'),
      ev(ORDER, 'OPT_IN', '2026-09-01T00:00:00Z'),
    ])
    expect(r).toMatchObject({ state: 'CONFIRMED_OPT_OUT', reason: 'HARD_REVOCATION' })
  })

  it('a API da Nuvemshop dizendo true, mesmo mais nova, não levanta a revogação', () => {
    const r = resolveEmailConsent([ev(UNSUB, 'OPT_OUT', '2026-08-01T00:00:00Z'), ev(API, 'OPT_IN', '2026-09-01T00:00:00Z')])
    expect(r.state).toBe('CONFIRMED_OPT_OUT')
  })

  it('só um NUBESDK_EXPLICIT OPT_IN estritamente posterior levanta a revogação', () => {
    const revoked = ev(UNSUB, 'OPT_OUT', '2026-08-01T00:00:00Z')
    const lift = ev(NUBESDK, 'OPT_IN', '2026-08-02T00:00:00Z')
    expect(resolveEmailConsent([revoked, lift])).toMatchObject({ state: 'CONFIRMED_OPT_IN', reason: 'AUTHORITATIVE_LATEST' })
    // Mesmo instante NÃO levanta.
    expect(resolveEmailConsent([revoked, ev(NUBESDK, 'OPT_IN', '2026-08-01T00:00:00Z')]).state).toBe('CONFIRMED_OPT_OUT')
    // Um opt-in ANTERIOR à revogação não a levanta.
    expect(resolveEmailConsent([ev(NUBESDK, 'OPT_IN', '2026-07-01T00:00:00Z'), revoked]).state).toBe('CONFIRMED_OPT_OUT')
  })

  it('MANUAL_IMPORT OPT_IN não levanta revogação', () => {
    const r = resolveEmailConsent([ev(UNSUB, 'OPT_OUT', '2026-08-01T00:00:00Z'), ev(MANUAL, 'OPT_IN', '2026-09-01T00:00:00Z')])
    expect(r.state).toBe('CONFIRMED_OPT_OUT')
  })

  it('depois de levantada, snapshots ANTERIORES à revogação não votam mais', () => {
    const r = resolveEmailConsent([
      ev(ORDER, 'OPT_OUT', '2026-07-01T00:00:00Z'),
      ev(UNSUB, 'OPT_OUT', '2026-08-01T00:00:00Z'),
      ev(NUBESDK, 'OPT_IN', '2026-08-10T00:00:00Z'),
    ])
    expect(r.state).toBe('CONFIRMED_OPT_IN')
  })

  it('depois de levantada, um snapshot false POSTERIOR ao opt-in gera conflito (fail-closed)', () => {
    const r = resolveEmailConsent([
      ev(UNSUB, 'OPT_OUT', '2026-08-01T00:00:00Z'),
      ev(NUBESDK, 'OPT_IN', '2026-08-10T00:00:00Z'),
      ev(ORDER, 'OPT_OUT', '2026-08-20T00:00:00Z'),
    ])
    expect(r).toMatchObject({ state: 'UNKNOWN', reason: 'SIGNAL_CONFLICT' })
  })

  it('uma nova revogação depois do opt-in explícito volta a bloquear', () => {
    const r = resolveEmailConsent([
      ev(UNSUB, 'OPT_OUT', '2026-08-01T00:00:00Z'),
      ev(NUBESDK, 'OPT_IN', '2026-08-10T00:00:00Z'),
      ev(PROVIDER, 'OPT_OUT', '2026-09-01T00:00:00Z'),
    ])
    expect(r).toMatchObject({ state: 'CONFIRMED_OPT_OUT', reason: 'HARD_REVOCATION' })
  })
})

describe('resolveEmailConsent — fonte autoritativa substitui snapshots antigos', () => {
  it('API true mais nova resolve o conflito dos snapshots', () => {
    const r = resolveEmailConsent([
      ev(ORDER, 'OPT_OUT', '2026-06-01T00:00:00Z'),
      ev(CHECKOUT, 'OPT_IN', '2026-07-01T00:00:00Z'),
      ev(API, 'OPT_IN', '2026-09-01T00:00:00Z'),
    ])
    expect(r).toMatchObject({ state: 'CONFIRMED_OPT_IN', reason: 'AUTHORITATIVE_LATEST' })
  })

  it('API false mais nova vence snapshots true', () => {
    const r = resolveEmailConsent([ev(ORDER, 'OPT_IN', '2026-06-01T00:00:00Z'), ev(API, 'OPT_OUT', '2026-09-01T00:00:00Z')])
    expect(r).toMatchObject({ state: 'CONFIRMED_OPT_OUT', reason: 'AUTHORITATIVE_LATEST' })
  })

  it('snapshot MAIS NOVO que a API volta a votar: divergência é conflito', () => {
    const r = resolveEmailConsent([ev(API, 'OPT_IN', '2026-07-01T00:00:00Z'), ev(ORDER, 'OPT_OUT', '2026-08-01T00:00:00Z')])
    expect(r).toMatchObject({ state: 'UNKNOWN', reason: 'SIGNAL_CONFLICT' })
  })

  it('snapshot mais novo que a API mas concordando mantém o estado', () => {
    const r = resolveEmailConsent([ev(API, 'OPT_IN', '2026-07-01T00:00:00Z'), ev(ORDER, 'OPT_IN', '2026-08-01T00:00:00Z')])
    expect(r.state).toBe('CONFIRMED_OPT_IN')
  })

  it('API com valor desconhecido (null na loja) torna o estado UNKNOWN mesmo com snapshot true antigo', () => {
    const r = resolveEmailConsent([ev(ORDER, 'OPT_IN', '2026-06-01T00:00:00Z'), ev(API, 'UNKNOWN', '2026-09-01T00:00:00Z')])
    expect(r).toMatchObject({ state: 'UNKNOWN', reason: 'UNKNOWN_SIGNAL' })
  })

  it('duas leituras autoritativas no mesmo instante que discordam são conflito', () => {
    const r = resolveEmailConsent([ev(API, 'OPT_IN', '2026-09-01T00:00:00Z'), ev(NUBESDK, 'OPT_IN', '2026-09-01T00:00:00Z'), ev(API, 'OPT_OUT', '2026-09-01T00:00:00Z')])
    // NUBESDK OPT_IN no mesmo instante NÃO levanta nada aqui (não há revogação) e vota junto.
    expect(r.state).toBe('UNKNOWN')
  })
})

describe('resolveEmailConsent — eventos inválidos e metadados', () => {
  it('OPT_IN vindo de CRM_UNSUBSCRIBE ou PROVIDER_EVENT é descartado (nunca prova consentimento)', () => {
    expect(resolveEmailConsent([ev(UNSUB, 'OPT_IN', '2026-08-01T00:00:00Z'), ev(PROVIDER, 'OPT_IN', '2026-08-01T00:00:00Z')])).toMatchObject({
      state: 'NOT_COLLECTED',
      eventCount: 0,
    })
    expect(resolveEmailConsent([ev(ORDER, 'OPT_OUT', '2026-07-01T00:00:00Z'), ev(UNSUB, 'OPT_IN', '2026-08-01T00:00:00Z')]).state).toBe(
      'CONFIRMED_OPT_OUT',
    )
  })

  it('UNKNOWN vindo de fonte só-recusa também é descartado', () => {
    expect(resolveEmailConsent([ev(PROVIDER, 'UNKNOWN', '2026-08-01T00:00:00Z')]).state).toBe('NOT_COLLECTED')
  })

  it('eventCount e lastEventAt refletem só os eventos válidos', () => {
    const r = resolveEmailConsent([
      ev(ORDER, 'OPT_IN', '2026-07-01T00:00:00Z'),
      ev(CHECKOUT, 'OPT_IN', '2026-08-15T00:00:00Z'),
      ev(UNSUB, 'OPT_IN', '2027-01-01T00:00:00Z'),
    ])
    expect(r.eventCount).toBe(2)
    expect(r.lastEventAt).toEqual(new Date('2026-08-15T00:00:00Z'))
  })

  it('o resultado não depende da ordem dos eventos', () => {
    const events = [
      ev(ORDER, 'OPT_OUT', '2026-06-01T00:00:00Z'),
      ev(UNSUB, 'OPT_OUT', '2026-07-01T00:00:00Z'),
      ev(NUBESDK, 'OPT_IN', '2026-07-05T00:00:00Z'),
      ev(CHECKOUT, 'OPT_IN', '2026-08-01T00:00:00Z'),
      ev(API, 'OPT_IN', '2026-08-02T00:00:00Z'),
    ]
    const expected = resolveEmailConsent(events)
    for (let shift = 1; shift < events.length; shift++) {
      const rotated = [...events.slice(shift), ...events.slice(0, shift)]
      expect(resolveEmailConsent(rotated)).toEqual(expected)
    }
    expect(resolveEmailConsent([...events].reverse())).toEqual(expected)
  })
})

describe('isConsentSendEligible', () => {
  it.each([
    ['CONFIRMED_OPT_IN', true],
    ['CONFIRMED_OPT_OUT', false],
    ['UNKNOWN', false],
    ['NOT_COLLECTED', false],
  ] as const)('%s → %s', (state, expected) => {
    expect(isConsentSendEligible(state)).toBe(expected)
  })
})
