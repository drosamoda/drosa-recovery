import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))

import { EMAIL_SEGMENT_KEYS, TRACK_PRIORITY } from '../../services/emailAudienceEngine'
import {
  EMAIL_CAMPAIGN_KEYS,
  EMAIL_DATA_CAPABILITIES,
  RequirementKey,
  evaluateCampaignReadiness,
  evidenceFlagsFromCapabilities,
  getEmailCampaign,
  listEmailCampaigns,
} from '../../services/emailCampaignLibrary'
import { resolveDirectionDefinitions } from '../../services/ai/strategyPlaybook'

const campaigns = listEmailCampaigns()

// Campanhas cuja premissa exige um dado que o sistema hoje NÃO coleta — o nome
// da campanha nunca é prova (Fase 4/10).
const EXPECTED_NEEDS_DATA = [
  'NEW_ARRIVALS', 'BEST_SELLERS', 'WEEKLY_SELECTION', 'CATEGORY_SPOTLIGHT', 'RESTOCK', 'COMPLEMENTARY_PURCHASE',
  'REPEAT_BUYER_NEWNESS', 'REPEAT_BUYER_CATEGORY', 'REPEAT_BUYER_CROSS_SELL', 'VIP_CURATED_SELECTION', 'VIP_NEW_ARRIVALS',
  'BROWSE_RECOVERY', 'BACK_IN_STOCK', 'CATEGORY_AFFINITY',
]

describe('emailCampaignLibrary — biblioteca oficial', () => {
  it('tem pelo menos 30 campanhas (33 oficiais), chaves únicas e todas as chaves declaradas', () => {
    expect(campaigns.length).toBeGreaterThanOrEqual(30)
    expect(campaigns).toHaveLength(EMAIL_CAMPAIGN_KEYS.length)
    expect(new Set(campaigns.map(c => c.key)).size).toBe(campaigns.length)
    expect(campaigns.map(c => c.key).sort()).toEqual([...EMAIL_CAMPAIGN_KEYS].sort())
  })

  it('cada campanha tem todos os campos exigidos pelo contrato da biblioteca', () => {
    for (const c of campaigns) {
      expect(c.key).toMatch(/^[A-Z0-9_]+$/)
      expect(c.name.length).toBeGreaterThan(3)
      expect(c.objective.length).toBeGreaterThan(5)
      expect(c.description.length).toBeGreaterThan(10)
      expect(c.allowedSegments.length).toBeGreaterThan(0)
      expect(Array.isArray(c.excludedSegments)).toBe(true)
      expect(c.recommendedCooldownDays).toBeGreaterThan(0)
      expect(c.recommendedCadence).toContain(String(c.recommendedCooldownDays))
      expect(['AWARENESS', 'CONSIDERATION', 'CONVERSION', 'RETENTION', 'REACTIVATION']).toContain(c.funnelStage)
      expect(c.primaryMetric.length).toBeGreaterThan(3)
      expect(c.whyNow.length).toBeGreaterThan(10)
      expect(Array.isArray(c.requirements)).toBe(true)
    }
  })

  it('só referencia segmentos oficiais (permitidos e excluídos)', () => {
    for (const c of campaigns) {
      for (const seg of [...c.allowedSegments, ...c.excludedSegments]) expect(EMAIL_SEGMENT_KEYS).toContain(seg)
      // um segmento nunca é permitido e excluído ao mesmo tempo
      expect(c.allowedSegments.filter(s => c.excludedSegments.includes(s))).toEqual([])
    }
  })

  it('prioridade é a da trilha (carrinho 2 < pós-compra 3 < segunda compra 4 < recorrente 5 < VIP 6 < reativação 7 < geral 8)', () => {
    for (const c of campaigns) expect(c.priority).toBe(TRACK_PRIORITY[c.track])
    expect(getEmailCampaign('CART_RECOVERY_EMAIL')!.priority).toBeLessThan(getEmailCampaign('POST_PURCHASE_STYLE')!.priority)
    expect(getEmailCampaign('POST_PURCHASE_STYLE')!.priority).toBeLessThan(getEmailCampaign('SECOND_PURCHASE')!.priority)
    expect(getEmailCampaign('SECOND_PURCHASE')!.priority).toBeLessThan(getEmailCampaign('REPEAT_BUYER_RELATIONSHIP')!.priority)
    expect(getEmailCampaign('REPEAT_BUYER_RELATIONSHIP')!.priority).toBeLessThan(getEmailCampaign('VIP_RELATIONSHIP')!.priority)
    expect(getEmailCampaign('VIP_RELATIONSHIP')!.priority).toBeLessThan(getEmailCampaign('WINBACK_91_180')!.priority)
    expect(getEmailCampaign('WINBACK_91_180')!.priority).toBeLessThan(getEmailCampaign('CATALOG_DISCOVERY')!.priority)
  })

  it('cada campanha tem EXATAMENTE 3 direções distintas A/B/C, na ordem, com intenção e guidance', () => {
    for (const c of campaigns) {
      expect(c.aiDirections.map(d => d.key)).toEqual(['A', 'B', 'C'])
      expect(new Set(c.aiDirections.map(d => d.label)).size).toBe(3)
      for (const d of c.aiDirections) {
        expect(d.intent.length).toBeGreaterThan(5)
        expect(d.guidance.length).toBeGreaterThan(10)
        // direção com dependência de evidência sempre traz fallback + aviso obrigatório
        if (d.requires) {
          expect(d.fallbackGuidance?.length).toBeGreaterThan(10)
          expect(d.fallbackWarning?.length).toBeGreaterThan(10)
        }
      }
    }
  })

  it('campanhas cuja premissa depende de dado inexistente ficam NEEDS_DATA (nome da campanha nunca é prova)', () => {
    for (const key of EXPECTED_NEEDS_DATA) {
      const readiness = evaluateCampaignReadiness(getEmailCampaign(key)!)
      expect(readiness.status, key).toBe('NEEDS_DATA')
      expect(readiness.missingHard.length, key).toBeGreaterThan(0)
    }
    const ready = campaigns.filter(c => !EXPECTED_NEEDS_DATA.includes(c.key))
    for (const c of ready) expect(evaluateCampaignReadiness(c).status, c.key).toBe('READY')
    expect(ready.length).toBeGreaterThanOrEqual(15)
  })

  it('NEW_ARRIVALS/BEST_SELLERS/RESTOCK dependem de evidência específica (não de "produtos candidatos" genéricos)', () => {
    const needs = (key: string): RequirementKey[] => evaluateCampaignReadiness(getEmailCampaign(key)!).missingHard.map(r => r.key)
    expect(needs('NEW_ARRIVALS')).toContain('NEWNESS_EVIDENCE')
    expect(needs('BEST_SELLERS')).toContain('BEST_SELLER_RANKING')
    expect(needs('RESTOCK')).toContain('RESTOCK_EVIDENCE')
    expect(needs('BROWSE_RECOVERY')).toContain('BROWSE_TRACKING')
    expect(needs('BACK_IN_STOCK')).toEqual(expect.arrayContaining(['STOCK_INTEREST_SUBSCRIPTION', 'RESTOCK_EVIDENCE']))
    expect(needs('CATEGORY_AFFINITY')).toContain('CATEGORY_DATA')
    expect(needs('COMPLEMENTARY_PURCHASE')).toContain('COMPLEMENTARY_PRODUCT_EVIDENCE')
  })

  it('a evidência real destrava a campanha: com newness comprovada, NEW_ARRIVALS deixa de ser NEEDS_DATA', () => {
    const caps = { ...EMAIL_DATA_CAPABILITIES, NEWNESS_EVIDENCE: { available: true, evidence: 'teste' }, CANDIDATE_PRODUCTS: { available: true, evidence: 'teste' } }
    expect(evaluateCampaignReadiness(getEmailCampaign('NEW_ARRIVALS')!, caps).status).toBe('READY')
    expect(evaluateCampaignReadiness(getEmailCampaign('NEW_ARRIVALS')!).status).toBe('NEEDS_DATA')
  })

  it('requisito SOFT ausente só degrada a direção, não bloqueia a campanha', () => {
    const style = evaluateCampaignReadiness(getEmailCampaign('STYLE_INSPIRATION')!)
    expect(style.status).toBe('READY')
    expect(style.missingSoft.map(r => r.key)).toContain('CANDIDATE_PRODUCTS')
    const flags = evidenceFlagsFromCapabilities()
    const resolved = resolveDirectionDefinitions(getEmailCampaign('STYLE_INSPIRATION')!.aiDirections, flags)
    expect(resolved.some(d => d.degraded && d.requiredWarning)).toBe(true)
  })

  it('flags de evidência de e-mail vêm das capacidades reais (todas false hoje), nunca do nome da campanha', () => {
    const flags = evidenceFlagsFromCapabilities()
    expect(flags.hasCandidateProducts).toBe(false)
    expect(flags.hasNewnessEvidence).toBe(false)
    expect(flags.hasCategoryEvidence).toBe(false)
    expect(flags.hasPromotionEvidence).toBe(false)
    expect(flags.hasStockEvidence).toBe(false)
  })

  it('nenhuma campanha nem direção AFIRMA desconto/benefício/estoque/ranking (só proíbe): sentenças afirmativas não contêm termos guardados', () => {
    const guarded = ['desconto', 'cupom', 'frete grátis', 'promoção', 'brinde', 'acesso antecipado', 'exclusiv', 'mais vendido', 'últimas unidades', 'edição limitada']
    const isProhibition = (sentence: string) => /(^|\s)(nunca|não|nem|sem)\s/i.test(sentence)
    for (const c of campaigns) {
      const texts = [c.description, c.whyNow, c.objective, ...c.aiDirections.flatMap(d => [d.intent, d.guidance, d.fallbackGuidance ?? ''])]
      for (const text of texts) {
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          if (isProhibition(sentence)) continue
          for (const term of guarded) expect(sentence.toLowerCase(), `${c.key}: "${sentence}"`).not.toContain(term)
        }
      }
    }
  })

  it('campanha de carrinho só existe com dado real de checkout (requisito hard atendido pelas capacidades)', () => {
    const cart = getEmailCampaign('CART_RECOVERY_EMAIL')!
    expect(cart.requirements.find(r => r.key === 'CART_RECOVERY_DATA')?.hard).toBe(true)
    expect(EMAIL_DATA_CAPABILITIES.CART_RECOVERY_DATA.available).toBe(true)
    expect(evaluateCampaignReadiness(cart).status).toBe('READY')
    expect(cart.allowedSegments).toEqual(['RECENT_CART_ABANDONER'])
  })

  it('getEmailCampaign devolve null para chave desconhecida', () => {
    expect(getEmailCampaign('NAO_EXISTE')).toBeNull()
  })
})
