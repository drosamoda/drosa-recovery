import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }))
vi.mock('../../config/prisma', () => ({ prisma: { $queryRaw: mocks.queryRaw } }))

import {
  EMAIL_SEGMENT_KEYS,
  RECENCY_BUCKETS,
  EmailBaseQuality,
  EmailIdentityRow,
  EmailSegmentKey,
  assignPrimaryTrack,
  buildEmailAudienceSnapshot,
  classifyRecency,
  getEmailAudienceSnapshot,
  isHighValueNonVip,
  isVip,
  segmentsForRow,
} from '../../services/emailAudienceEngine'

const NOW = new Date('2026-09-19T12:00:00.000Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

const QUALITY: EmailBaseQuality = { totalCustomers: 10, customersWithoutEmail: 2, paidOrders: 8, paidOrdersWithoutEmail: 1, paidOrdersWithoutDate: 0 }

function row(overrides: Partial<EmailIdentityRow> = {}): EmailIdentityRow {
  return { validEmail: true, paidOrderCount: 0, paidTotal: 0, lastPaidAt: null, undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false, ...overrides }
}
const buyer = (ageDays: number, extra: Partial<EmailIdentityRow> = {}) => row({ paidOrderCount: 1, paidTotal: 100, lastPaidAt: daysAgo(ageDays), ...extra })

function seg(snapshot: ReturnType<typeof buildEmailAudienceSnapshot>, key: EmailSegmentKey) {
  return snapshot.segments.find(s => s.segmentKey === key)!
}

describe('emailAudienceEngine — classificação de recência (buckets mutuamente exclusivos)', () => {
  it.each([
    [0, '0_30'], [30, '0_30'], [31, '31_60'], [60, '31_60'], [61, '61_90'], [90, '61_90'],
    [91, '91_180'], [180, '91_180'], [181, '181_365'], [365, '181_365'], [366, '365_PLUS'], [2000, '365_PLUS'],
  ])('última compra há %i dias => bucket %s', (age, bucket) => {
    expect(classifyRecency(buyer(age), NOW)).toBe(bucket)
  })

  it('nunca comprou => NO_PURCHASE', () => {
    expect(classifyRecency(row(), NOW)).toBe('NO_PURCHASE')
  })

  it('compra paga sem nenhuma data => UNDATED (nunca datada por chute)', () => {
    expect(classifyRecency(row({ paidOrderCount: 2, paidTotal: 50, lastPaidAt: null, undatedPaidOrders: 2 }), NOW)).toBe('UNDATED')
  })

  it('data no futuro é anomalia => UNDATED, não "compra recente"', () => {
    expect(classifyRecency(row({ paidOrderCount: 1, lastPaidAt: new Date(NOW.getTime() + 5 * DAY) }), NOW)).toBe('UNDATED')
  })

  it('cada idade inteira de 0 a 800 dias cai em EXATAMENTE um bucket, sem lacuna nem sobreposição', () => {
    const seen = new Map<string, number>()
    for (let age = 0; age <= 800; age++) {
      const bucket = classifyRecency(buyer(age), NOW)
      expect(RECENCY_BUCKETS).toContain(bucket)
      seen.set(bucket, (seen.get(bucket) ?? 0) + 1)
    }
    expect([...seen.values()].reduce((a, b) => a + b, 0)).toBe(801)
    expect(seen.get('0_30')).toBe(31)
    expect(seen.get('31_60')).toBe(30)
    expect(seen.get('61_90')).toBe(30)
    expect(seen.get('91_180')).toBe(90)
    expect(seen.get('181_365')).toBe(185)
  })
})

describe('emailAudienceEngine — segmentos por número de compras e VIP', () => {
  it('exatamente 1 compra => ONE_TIME_BUYERS e nunca REPEAT_BUYERS', () => {
    const keys = segmentsForRow(buyer(10), '0_30')
    expect(keys).toContain('ONE_TIME_BUYERS')
    expect(keys).not.toContain('REPEAT_BUYERS')
  })

  it('2+ compras => REPEAT_BUYERS e nunca ONE_TIME_BUYERS', () => {
    const keys = segmentsForRow(row({ paidOrderCount: 2, paidTotal: 100, lastPaidAt: daysAgo(10) }), '0_30')
    expect(keys).toContain('REPEAT_BUYERS')
    expect(keys).not.toContain('ONE_TIME_BUYERS')
  })

  it('VIP usa os limites CONFIGURADOS (3 pedidos e R$ 500 por padrão): exige os DOIS', () => {
    expect(isVip(row({ paidOrderCount: 3, paidTotal: 500 }))).toBe(true)
    expect(isVip(row({ paidOrderCount: 3, paidTotal: 499.99 }))).toBe(false)
    expect(isVip(row({ paidOrderCount: 2, paidTotal: 5000 }))).toBe(false)
  })

  it('REPEAT_BUYER + VIP é permitido ao mesmo tempo (atributos ortogonais)', () => {
    const keys = segmentsForRow(row({ paidOrderCount: 4, paidTotal: 900, lastPaidAt: daysAgo(10) }), '0_30')
    expect(keys).toEqual(expect.arrayContaining(['REPEAT_BUYERS', 'VIP_CUSTOMERS']))
  })

  it('HIGH_VALUE_NON_VIP: gasto já atinge o limite VIP mas os pedidos ainda não', () => {
    expect(isHighValueNonVip(row({ paidOrderCount: 2, paidTotal: 800 }))).toBe(true)
    expect(isHighValueNonVip(row({ paidOrderCount: 3, paidTotal: 800 }))).toBe(false)
    expect(isHighValueNonVip(row({ paidOrderCount: 1, paidTotal: 100 }))).toBe(false)
  })

  it('cliente que nunca comprou entra em NO_PURCHASE_CUSTOMERS e em nenhum segmento de compra', () => {
    const keys = segmentsForRow(row(), 'NO_PURCHASE')
    expect(keys).toEqual(expect.arrayContaining(['ALL_EMAIL_CUSTOMERS', 'NO_PURCHASE_CUSTOMERS']))
    expect(keys).not.toContain('ONE_TIME_BUYERS')
    expect(keys).not.toContain('REPEAT_BUYERS')
  })
})

describe('emailAudienceEngine — prioridade e conflitos entre campanhas', () => {
  it('carrinho abandonado recente tem prioridade sobre pós-compra', () => {
    expect(assignPrimaryTrack(buyer(5, { recentAbandonedCart: true }), '0_30')).toBe('CART_RECOVERY')
  })

  it('compra nova retira o cliente de win-back: 1 compra há 120 dias é REACTIVATION; ao comprar de novo vira ciclo de vida', () => {
    const before = buyer(120)
    expect(assignPrimaryTrack(before, classifyRecency(before, NOW))).toBe('REACTIVATION')
    const after = row({ paidOrderCount: 2, paidTotal: 200, lastPaidAt: daysAgo(0) })
    const recency = classifyRecency(after, NOW)
    expect(recency).toBe('0_30')
    expect(assignPrimaryTrack(after, recency)).toBe('REPEAT_ACTIVE')
    expect(segmentsForRow(after, recency)).not.toContain('LAPSED_91_180D')
  })

  it('cliente recente nunca aparece como inativo: 0–30 é pós-compra, nunca reativação', () => {
    const recent = buyer(10)
    const recency = classifyRecency(recent, NOW)
    expect(assignPrimaryTrack(recent, recency)).toBe('POST_PURCHASE')
    expect(segmentsForRow(recent, recency).filter(k => k.startsWith('LAPSED_') || k === 'DORMANT_365D_PLUS')).toHaveLength(0)
  })

  it.each([
    [buyer(45), 'SECOND_PURCHASE'],
    [row({ paidOrderCount: 2, paidTotal: 100, lastPaidAt: daysAgo(45) }), 'REPEAT_ACTIVE'],
    [row({ paidOrderCount: 3, paidTotal: 700, lastPaidAt: daysAgo(45) }), 'VIP_RELATIONSHIP'],
    [buyer(70), 'REACTIVATION'],
    [buyer(400), 'REACTIVATION'],
    [row(), 'FIRST_PURCHASE'],
    [row({ paidOrderCount: 1, paidTotal: 10, lastPaidAt: null, undatedPaidOrders: 1 }), 'GENERAL'],
  ])('trilha primária determinística (%#)', (r, track) => {
    expect(assignPrimaryTrack(r, classifyRecency(r, NOW))).toBe(track)
  })
})

describe('emailAudienceEngine — snapshot agregado', () => {
  const rows: EmailIdentityRow[] = [
    buyer(5), buyer(40), buyer(75), buyer(120), buyer(250), buyer(500),
    row({ paidOrderCount: 3, paidTotal: 900, lastPaidAt: daysAgo(20) }),
    row({ paidOrderCount: 2, paidTotal: 700, lastPaidAt: daysAgo(100) }),
    row(), row({ validEmail: false }),
    row({ paidOrderCount: 1, paidTotal: 30, lastPaidAt: null, undatedPaidOrders: 1 }),
    buyer(3, { recentAbandonedCart: true }),
    buyer(200, { whatsappOptOut: true }),
  ]
  const snapshot = buildEmailAudienceSnapshot(rows, QUALITY, NOW)

  it('a soma dos buckets de recência NÃO tem sobreposição: bucketsSum == compradores datados', () => {
    expect(snapshot.recencyCheck.overlapFree).toBe(true)
    const sum = (['RECENT_BUYERS_0_30D', 'LAPSED_31_60D', 'LAPSED_61_90D', 'LAPSED_91_180D', 'LAPSED_181_365D', 'DORMANT_365D_PLUS'] as EmailSegmentKey[])
      .reduce((s, k) => s + (seg(snapshot, k).audienceCount ?? 0), 0)
    expect(sum).toBe(snapshot.recencyCheck.datedBuyers)
    expect(sum + seg(snapshot, 'UNDATED_BUYERS').audienceCount!).toBe(snapshot.base.buyers)
  })

  it('conta corretamente cada segmento', () => {
    expect(seg(snapshot, 'ALL_EMAIL_CUSTOMERS').audienceCount).toBe(rows.length)
    expect(seg(snapshot, 'ONE_TIME_BUYERS').audienceCount).toBe(9)
    expect(seg(snapshot, 'REPEAT_BUYERS').audienceCount).toBe(2)
    expect(seg(snapshot, 'VIP_CUSTOMERS').audienceCount).toBe(1)
    expect(seg(snapshot, 'NO_PURCHASE_CUSTOMERS').audienceCount).toBe(2)
    expect(seg(snapshot, 'RECENT_CART_ABANDONER').audienceCount).toBe(1)
    expect(seg(snapshot, 'HIGH_VALUE_NON_VIP').audienceCount).toBe(1)
    expect(seg(snapshot, 'UNDATED_BUYERS').audienceCount).toBe(1)
  })

  it('e-mail inválido entra na audiência mas NÃO em withValidEmailCount e vira blockedCount', () => {
    const all = seg(snapshot, 'ALL_EMAIL_CUSTOMERS')
    expect(all.audienceCount! - all.withValidEmailCount!).toBe(1)
    expect(all.blockedCount).toBe(1)
    expect(all.exclusions.find(e => e.reason === 'INVALID_EMAIL')?.count).toBe(1)
    expect(snapshot.base.emailInvalid).toBe(1)
  })

  it('sem fonte de consentimento: sendEligibleCount é NULL e o status diz por quê', () => {
    expect(snapshot.consentSource).toBe('NOT_CONFIGURED')
    expect(snapshot.sendEligibility).toBe('NOT_READY')
    for (const s of snapshot.segments.filter(x => x.status === 'READY')) {
      expect(s.sendEligibleCount).toBeNull()
      expect(s.eligibilityStatus).toBe('EMAIL_CONSENT_SOURCE_NOT_CONFIGURED')
    }
  })

  it('opt-out de WhatsApp NÃO reduz a audiência nem vira opt-out de e-mail — só aparece como aviso de revisão', () => {
    const lapsed = seg(snapshot, 'LAPSED_181_365D')
    expect(lapsed.audienceCount).toBe(2) // buyer(250) e buyer(200, optOut)
    expect(lapsed.blockedCount).toBe(0)
    const review = lapsed.exclusions.find(e => e.reason === 'WHATSAPP_OPT_OUT_REVIEW')
    expect(review?.count).toBe(1)
    expect(review?.note).toMatch(/NÃO é opt-out de e-mail/)
  })

  it('segmentos sem dado real ficam NEEDS_DATA com null (nunca 0 inventado) e explicam o que falta', () => {
    for (const key of ['CATEGORY_AFFINITY', 'ENGAGED_EMAIL_NO_PURCHASE', 'BROWSE_NO_PURCHASE'] as EmailSegmentKey[]) {
      const s = seg(snapshot, key)
      expect(s.status).toBe('NEEDS_DATA')
      expect(s.audienceCount).toBeNull()
      expect(s.withValidEmailCount).toBeNull()
      expect(s.eligibilityStatus).toBe('NEEDS_DATA')
      expect(s.missingData).toMatch(/Dados necessários ainda não são coletados/)
    }
  })

  it('cooldown honesto: sem histórico de envio de e-mail não é aplicável', () => {
    expect(snapshot.cooldownStatus).toBe('NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY')
    for (const s of snapshot.segments) expect(s.cooldownStatus).toBe('NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY')
  })

  it('a trilha primária reivindica cada membro exatamente uma vez: soma por trilha == audiência do segmento', () => {
    for (const s of snapshot.segments.filter(x => x.status === 'READY')) {
      const total = Object.values(s.trackBreakdown).reduce((a, b) => a + b, 0)
      expect(total).toBe(s.audienceCount)
    }
  })

  it('cliente/pedido sem e-mail fica fora do universo e é reportado só em base', () => {
    expect(snapshot.base.customersWithoutEmail).toBe(2)
    expect(snapshot.base.paidOrdersWithoutEmail).toBe(1)
    expect(snapshot.base.emailKnown).toBe(rows.length)
  })

  it('expõe todos os segmentos oficiais exigidos', () => {
    for (const key of ['ALL_EMAIL_CUSTOMERS', 'ONE_TIME_BUYERS', 'REPEAT_BUYERS', 'VIP_CUSTOMERS', 'RECENT_BUYERS_0_30D', 'LAPSED_31_60D', 'LAPSED_61_90D', 'LAPSED_91_180D', 'LAPSED_181_365D', 'DORMANT_365D_PLUS', 'NO_PURCHASE_CUSTOMERS'] as EmailSegmentKey[]) {
      expect(EMAIL_SEGMENT_KEYS).toContain(key)
    }
  })

  it('base vazia: tudo zero (READY) e NEEDS_DATA continua null — nunca quebra', () => {
    const empty = buildEmailAudienceSnapshot([], { totalCustomers: 0, customersWithoutEmail: 0, paidOrders: 0, paidOrdersWithoutEmail: 0, paidOrdersWithoutDate: 0 }, NOW)
    expect(seg(empty, 'ALL_EMAIL_CUSTOMERS').audienceCount).toBe(0)
    expect(seg(empty, 'CATEGORY_AFFINITY').audienceCount).toBeNull()
    expect(empty.recencyCheck.overlapFree).toBe(true)
  })
})

describe('emailAudienceEngine — acesso a dados (SQL)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  function captureSql(): string[] {
    return mocks.queryRaw.mock.calls.map(call => String((call[0] as { sql?: string; strings?: string[] }).sql ?? (call[0] as { strings: string[] }).strings.join('?')))
  }

  it('agrega no PostgreSQL: pedido pago não cancelado/refundado, sem LIMIT silencioso, sem rawPayload', async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ validEmail: true, paidOrderCount: 1, paidTotal: 100, lastPaidAt: daysAgo(10), undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false }])
    mocks.queryRaw.mockResolvedValueOnce([{ totalCustomers: 5, customersWithoutEmail: 1, paidOrders: 3, paidOrdersWithoutEmail: 0, paidOrdersWithoutDate: 0 }])
    const snapshot = await getEmailAudienceSnapshot({ now: NOW })
    const [identitySql, qualitySql] = captureSql()
    for (const sql of [identitySql, qualitySql]) {
      expect(sql).toMatch(/"paymentStatus" = 'paid'/)
      expect(sql).toMatch(/NOT IN \('cancelled', 'canceled', 'refunded'\)/)
      expect(sql).not.toMatch(/\blimit\b/i)
      expect(sql).not.toMatch(/rawPayload/)
    }
    // Sem fallback para createdAt: só a data de origem do pedido.
    expect(identitySql).toMatch(/"sourceCreatedAt"/)
    expect(identitySql).not.toMatch(/o\."createdAt"/)
    expect(snapshot.base.emailKnown).toBe(1)
    expect(seg(snapshot, 'ALL_EMAIL_CUSTOMERS').audienceCount).toBe(1)
  })

  it('a linha devolvida por identidade nunca inclui o e-mail (só validEmail/contagens/datas)', async () => {
    mocks.queryRaw.mockResolvedValueOnce([])
    mocks.queryRaw.mockResolvedValueOnce([{ totalCustomers: 0, customersWithoutEmail: 0, paidOrders: 0, paidOrdersWithoutEmail: 0, paidOrdersWithoutDate: 0 }])
    await getEmailAudienceSnapshot({ now: NOW })
    const [identitySql] = captureSql()
    const finalSelect = identitySql.slice(identitySql.lastIndexOf('SELECT (length(p.em)'))
    expect(finalSelect).not.toMatch(/p\.em AS/)
    expect(finalSelect).toMatch(/AS "validEmail"/)
    expect(finalSelect).not.toMatch(/AS "email"/)
  })

  it('base grande não é truncada: 60 mil linhas voltam integralmente contadas', async () => {
    const big: EmailIdentityRow[] = Array.from({ length: 60_000 }, (_, i) => buyer(i % 400))
    mocks.queryRaw.mockResolvedValueOnce(big)
    mocks.queryRaw.mockResolvedValueOnce([{ totalCustomers: 60000, customersWithoutEmail: 0, paidOrders: 60000, paidOrdersWithoutEmail: 0, paidOrdersWithoutDate: 0 }])
    const snapshot = await getEmailAudienceSnapshot({ now: NOW })
    expect(seg(snapshot, 'ALL_EMAIL_CUSTOMERS').audienceCount).toBe(60_000)
    expect(snapshot.recencyCheck.overlapFree).toBe(true)
  })

  it('erro de banco propaga (fail-closed): nenhum snapshot inventado', async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error('db down'))
    await expect(getEmailAudienceSnapshot({ now: NOW })).rejects.toThrow('db down')
  })
})
