import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { EmailBaseQuality, EmailIdentityRow, buildEmailAudienceSnapshot } from '../../services/emailAudienceEngine'
import { EMAIL_DATA_CAPABILITIES } from '../../services/emailCampaignLibrary'
import {
  EmailRecommendation,
  SEGMENT_TO_OPPORTUNITY_TYPE,
  buildEmailRecommendations,
  campaignsForSegment,
  emailOpportunityId,
  isTargetableSegment,
  parseEmailOpportunityId,
} from '../../services/emailCampaignRecommendationService'
import { buildEmailOpportunities } from '../../services/emailOpportunityService'

const NOW = new Date('2026-09-19T12:00:00.000Z')
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)
const QUALITY: EmailBaseQuality = { totalCustomers: 0, customersWithoutEmail: 0, paidOrders: 0, paidOrdersWithoutEmail: 0, paidOrdersWithoutDate: 0 }

function row(overrides: Partial<EmailIdentityRow> = {}): EmailIdentityRow {
  return { validEmail: true, paidOrderCount: 0, paidTotal: 0, lastPaidAt: null, undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false, ...overrides }
}
const buyer = (age: number, extra: Partial<EmailIdentityRow> = {}) => row({ paidOrderCount: 1, paidTotal: 100, lastPaidAt: daysAgo(age), ...extra })
const repeat = (age: number, orders = 2, total = 200) => row({ paidOrderCount: orders, paidTotal: total, lastPaidAt: daysAgo(age) })

// 10 clientes 0–30d (1 compra), 8 em 31–60d, 6 em 61–90d, 5 em 91–180d, 4 em 181–365d, 3 dormentes,
// 4 recorrentes ativos, 2 VIP ativos, 7 nunca compraram, 2 com carrinho recente.
const rows: EmailIdentityRow[] = [
  ...Array.from({ length: 10 }, () => buyer(10)),
  ...Array.from({ length: 8 }, () => buyer(45)),
  ...Array.from({ length: 6 }, () => buyer(75)),
  ...Array.from({ length: 5 }, () => buyer(120)),
  ...Array.from({ length: 4 }, () => buyer(250)),
  ...Array.from({ length: 3 }, () => buyer(500)),
  ...Array.from({ length: 4 }, () => repeat(20)),
  ...Array.from({ length: 2 }, () => repeat(20, 4, 900)),
  ...Array.from({ length: 7 }, () => row()),
  ...Array.from({ length: 2 }, () => row({ recentAbandonedCart: true })),
]
const snapshot = buildEmailAudienceSnapshot(rows, QUALITY, NOW)
const result = buildEmailRecommendations(snapshot)
const find = (campaignKey: string, segmentKey: string): EmailRecommendation => result.recommendations.find(r => r.campaignKey === campaignKey && r.segmentKey === segmentKey)!

describe('emailCampaignRecommendationService — cruzamento audiência × biblioteca', () => {
  it('cada recomendação traz todos os campos exigidos', () => {
    expect(result.recommendations.length).toBeGreaterThan(30)
    for (const rec of result.recommendations) {
      expect(rec).toEqual(expect.objectContaining({
        campaignKey: expect.any(String), campaignName: expect.any(String), segmentKey: expect.any(String),
        whyNow: expect.any(String), objective: expect.any(String), priority: expect.any(Number),
        cooldown: expect.objectContaining({ days: expect.any(Number), status: 'NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY' }),
        requirementsStatus: expect.stringMatching(/^(READY|NEEDS_DATA)$/),
        blockedReasons: expect.any(Array), confidence: expect.stringMatching(/^(low|medium|high)$/),
      }))
    }
  })

  it('ONE_TIME_BUYERS => SECOND_PURCHASE, POST_PURCHASE_STYLE e POST_PURCHASE_DISCOVERY', () => {
    const keys = campaignsForSegment('ONE_TIME_BUYERS').map(c => c.key)
    expect(keys).toEqual(expect.arrayContaining(['SECOND_PURCHASE', 'POST_PURCHASE_STYLE', 'POST_PURCHASE_DISCOVERY']))
    for (const key of ['SECOND_PURCHASE', 'POST_PURCHASE_STYLE', 'POST_PURCHASE_DISCOVERY']) expect(find(key, 'ONE_TIME_BUYERS')).toBeDefined()
  })

  it('LAPSED_61_90D => WINBACK_61_90, NEW_ARRIVALS e CATALOG_DISCOVERY', () => {
    const keys = campaignsForSegment('LAPSED_61_90D').map(c => c.key)
    expect(keys).toEqual(expect.arrayContaining(['WINBACK_61_90', 'NEW_ARRIVALS', 'CATALOG_DISCOVERY']))
    expect(find('WINBACK_61_90', 'LAPSED_61_90D').actionable).toBe(true)
    expect(find('CATALOG_DISCOVERY', 'LAPSED_61_90D').actionable).toBe(true)
  })

  it('NEW_ARRIVALS fica NEEDS_DATA e NÃO acionável, dizendo exatamente qual dado falta', () => {
    const rec = find('NEW_ARRIVALS', 'LAPSED_61_90D')
    expect(rec.requirementsStatus).toBe('NEEDS_DATA')
    expect(rec.actionable).toBe(false)
    expect(rec.blockedReasons).toContain('CAMPAIGN_NEEDS_DATA:NEWNESS_EVIDENCE')
    expect(rec.missingRequirements[0]).toEqual(expect.objectContaining({ key: 'NEWNESS_EVIDENCE', evidence: expect.stringMatching(/novidade/i) }))
  })

  it('a audiência vem do snapshot determinístico (nunca da IA) e é exibida como audiência, não como "pronto para enviar"', () => {
    const rec = find('WINBACK_61_90', 'LAPSED_61_90D')
    expect(rec.audienceCount).toBe(6)
    expect(rec.withValidEmailCount).toBe(6)
    expect(rec.sendEligibleCount).toBeNull()
    expect(rec.sendEligibility).toBe('SEND_ELIGIBILITY_UNVERIFIED')
    expect(rec.sendBlockers).toEqual(expect.arrayContaining(['EMAIL_CONSENT_SOURCE_NOT_CONFIGURED', 'NO_EMAIL_PROVIDER_CONFIGURED', 'EMAIL_SEND_DISABLED', 'HUMAN_APPROVAL_REQUIRED']))
    expect(result.consentSource).toBe('NOT_CONFIGURED')
    expect(result.sendEligibility).toBe('NOT_READY')
  })

  it('prioridade e conflito: WINBACK_31_60 é coberto por campanhas de ciclo de vida (segunda compra/recorrente/VIP) => SUPERSEDED, não acionável', () => {
    const rec = find('WINBACK_31_60', 'LAPSED_31_60D')
    expect(rec.audienceCount).toBe(8)
    expect(rec.exclusiveAudienceCount).toBe(0)
    expect(rec.blockedReasons).toContain('SUPERSEDED_BY_HIGHER_PRIORITY')
    expect(rec.actionable).toBe(false)
  })

  it('SECOND_PURCHASE só alcança quem está na janela de segunda compra; quem passou de 60 dias é reativação (não recebe as duas)', () => {
    const second = find('SECOND_PURCHASE', 'ONE_TIME_BUYERS')
    expect(second.audienceCount).toBe(8 + 10 + 6 + 5 + 4 + 3) // todos os de 1 compra
    expect(second.exclusiveAudienceCount).toBe(8) // 31–60d
    const post = find('POST_PURCHASE_STYLE', 'ONE_TIME_BUYERS')
    expect(post.exclusiveAudienceCount).toBe(10) // 0–30d
    const winback = find('WINBACK_91_180', 'LAPSED_91_180D')
    expect(winback.exclusiveAudienceCount).toBe(5)
    // 1 pessoa só numa trilha: 10 + 8 + winbacks(6+5+4+3) == audiência de compradores de 1 compra
    expect(second.exclusiveAudienceCount! + post.exclusiveAudienceCount! + 6 + 5 + 4 + 3).toBe(second.audienceCount)
  })

  it('carrinho abandonado recente tem a MAIOR prioridade e lidera o ranking "o que fazer agora"', () => {
    const top = result.recommendations[0]
    expect(top.campaignKey).toBe('CART_RECOVERY_EMAIL')
    expect(top.priority).toBe(2)
    expect(top.actionable).toBe(true)
  })

  it('ranking: acionáveis primeiro, e dentro deles prioridade crescente (número menor = mais urgente)', () => {
    const firstBlocked = result.recommendations.findIndex(r => !r.actionable)
    expect(firstBlocked).toBeGreaterThan(0)
    expect(result.recommendations.slice(firstBlocked).every(r => !r.actionable)).toBe(true)
    const actionable = result.recommendations.slice(0, firstBlocked)
    for (let i = 1; i < actionable.length; i++) expect(actionable[i].priority).toBeGreaterThanOrEqual(actionable[i - 1].priority)
  })

  it('cooldown honesto: sem histórico de envio de e-mail não é aplicável, mas a recomendação existe', () => {
    for (const rec of result.recommendations) expect(rec.cooldown.status).toBe('NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY')
    expect(find('WINBACK_91_180', 'LAPSED_91_180D').cooldown.days).toBe(30)
    expect(result.cooldownStatus).toBe('NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY')
  })

  it('campanhas de segmento NEEDS_DATA (categoria) nunca são acionáveis e apontam o segmento', () => {
    const rec = find('REPEAT_BUYER_CATEGORY', 'CATEGORY_AFFINITY')
    expect(rec.actionable).toBe(false)
    expect(rec.blockedReasons).toContain('SEGMENT_NEEDS_DATA')
    expect(rec.audienceCount).toBeNull()
  })

  it('audiência vazia bloqueia a geração (EMPTY_AUDIENCE) em vez de gerar copy para ninguém', () => {
    const empty = buildEmailRecommendations(buildEmailAudienceSnapshot([], QUALITY, NOW))
    expect(empty.recommendations.every(r => !r.actionable)).toBe(true)
    expect(empty.recommendations.find(r => r.campaignKey === 'CATALOG_DISCOVERY')!.blockedReasons).toContain('EMPTY_AUDIENCE')
    expect(empty.summary.actionable).toBe(0)
  })

  it('a evidência real destrava a recomendação: com newness comprovada NEW_ARRIVALS passa a ser acionável', () => {
    const caps = { ...EMAIL_DATA_CAPABILITIES, NEWNESS_EVIDENCE: { available: true, evidence: 'teste' }, CANDIDATE_PRODUCTS: { available: true, evidence: 'teste' } }
    const unlocked = buildEmailRecommendations(snapshot, caps).recommendations.find(r => r.campaignKey === 'NEW_ARRIVALS' && r.segmentKey === 'ALL_EMAIL_CUSTOMERS')!
    expect(unlocked.requirementsStatus).toBe('READY')
    expect(unlocked.actionable).toBe(true)
  })

  it('confiança nunca é "high" sem fonte de consentimento comprovada', () => {
    for (const rec of result.recommendations) expect(rec.confidence).not.toBe('high')
    expect(find('NEW_ARRIVALS', 'LAPSED_61_90D').confidence).toBe('low')
  })

  it('o resumo conta acionáveis, NEEDS_DATA e cobertas por prioridade', () => {
    expect(result.summary.total).toBe(result.recommendations.length)
    expect(result.summary.actionable).toBe(result.recommendations.filter(r => r.actionable).length)
    expect(result.summary.needsData).toBeGreaterThan(0)
    expect(result.summary.superseded).toBeGreaterThan(0)
  })
})

describe('oportunidades de e-mail (channel=email)', () => {
  const opportunities = buildEmailOpportunities(snapshot)

  it('são determinísticas, marcadas channel=email e nunca com elegibilidade inventada', () => {
    expect(opportunities.length).toBeGreaterThanOrEqual(10)
    for (const o of opportunities) {
      expect(o.channel).toBe('email')
      expect(o.recommendedChannel).toBe('email')
      expect(o.eligibleCount).toBeNull()
      expect(o.sendEligibleCount).toBeNull()
      expect(o.eligibilityStatus).toBe('EMAIL_CONSENT_SOURCE_NOT_CONFIGURED')
      expect(o.type).toMatch(/^EMAIL_/)
      expect(o.id).toMatch(/^opp_email_[a-z0-9_]+_2026-09-19$/)
    }
  })

  it('cobre os tipos exigidos e ignora segmentos sem público real ou NEEDS_DATA/diagnóstico', () => {
    const types = opportunities.map(o => o.type)
    for (const t of ['EMAIL_ALL_CUSTOMERS', 'EMAIL_ONE_TIME_BUYERS', 'EMAIL_REPEAT_BUYERS', 'EMAIL_VIP', 'EMAIL_LAPSED_31_60', 'EMAIL_LAPSED_61_90', 'EMAIL_LAPSED_91_180', 'EMAIL_LAPSED_181_365', 'EMAIL_DORMANT_365_PLUS', 'EMAIL_NO_PURCHASE']) {
      expect(types, t).toContain(t)
    }
    expect(types).not.toContain('EMAIL_HIGH_VALUE_NON_VIP') // ninguém neste conjunto
    expect(opportunities.some(o => (o.segmentKey as string) === 'UNDATED_BUYERS' || (o.segmentKey as string) === 'CATEGORY_AFFINITY')).toBe(false)
  })

  it('oportunidades de WhatsApp continuam com o próprio contrato — as de e-mail nunca reutilizam os tipos delas', () => {
    for (const o of opportunities) expect(['ABANDONED_CART', 'PIX_PENDING', 'BOLETO_PENDING', 'REPEAT_PURCHASE', 'WINBACK', 'VIP', 'RECENT_CUSTOMER', 'ENGAGED_NO_PURCHASE']).not.toContain(o.type)
  })

  it('lista só campanhas ACIONÁVEIS como recomendadas para o segmento', () => {
    const lapsed = opportunities.find(o => o.type === 'EMAIL_LAPSED_61_90')!
    expect(lapsed.recommendedCampaignKeys).toContain('WINBACK_61_90')
    expect(lapsed.recommendedCampaignKeys).toContain('CATALOG_DISCOVERY')
    expect(lapsed.recommendedCampaignKeys).not.toContain('NEW_ARRIVALS')
  })

  it('id de oportunidade faz roundtrip e rejeita segmentos não-targetable', () => {
    const id = emailOpportunityId('LAPSED_61_90D', NOW.toISOString())
    expect(id).toBe('opp_email_lapsed_61_90d_2026-09-19')
    expect(parseEmailOpportunityId(id)).toEqual({ segmentKey: 'LAPSED_61_90D', date: '2026-09-19' })
    expect(parseEmailOpportunityId('opp_email_undated_buyers_2026-09-19')).toBeNull()
    expect(parseEmailOpportunityId('opp_email_category_affinity_2026-09-19')).toBeNull()
    expect(parseEmailOpportunityId('opp_recent_customer_2026-09-19')).toBeNull()
    expect(isTargetableSegment('ALL_EMAIL_CUSTOMERS')).toBe(true)
    expect(isTargetableSegment('BROWSE_NO_PURCHASE')).toBe(false)
    expect(Object.keys(SEGMENT_TO_OPPORTUNITY_TYPE)).toHaveLength(13)
  })
})
