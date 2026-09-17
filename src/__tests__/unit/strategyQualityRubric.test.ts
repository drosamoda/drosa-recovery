import { describe, expect, it } from 'vitest'
import { evaluateStrategyQuality } from '../../services/ai/strategyQualityRubric'
import { Strategy } from '../../services/ai/aiProvider'
import { ComplianceFinding } from '../../services/ai/complianceService'
import { DistanceFinding } from '../../services/ai/strategyDistanceService'

function strategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    direction: 'A', name: 'x', angle: 'Ângulo real', audience: '10 elegíveis', productId: null,
    message: 'Uma mensagem com conteúdo real e específico o suficiente.', cta: 'Ver agora', creativeBrief: 'Foto do produto.', warnings: [],
    ...overrides,
  }
}

const NO_FINDINGS: ComplianceFinding[] = []
const NO_DISTANCE: DistanceFinding[] = []

describe('strategyQualityRubric — diagnóstico determinístico, nunca previsão de venda', () => {
  it('cobre os 8 critérios exigidos', () => {
    const results = evaluateStrategyQuality(strategy(), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    const criteria = results.map(r => r.criterion)
    expect(criteria).toEqual([
      'Evidence adherence', 'Product Truth', 'Compliance', 'Specificity',
      'Strategic differentiation', 'CTA clarity', 'WhatsApp suitability', 'Brand fit',
    ])
  })

  it('Evidence adherence: nota 1 (não penaliza) quando a estratégia tem warnings — registrar aviso é o comportamento correto', () => {
    const results = evaluateStrategyQuality(strategy({ warnings: ['dado insuficiente'] }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(results.find(r => r.criterion === 'Evidence adherence')!.score).toBe(1)
  })

  it('Product Truth: nota máxima quando productId é null (nenhum produto inventado)', () => {
    const results = evaluateStrategyQuality(strategy({ productId: null }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(results.find(r => r.criterion === 'Product Truth')!.score).toBe(2)
  })

  it('Product Truth: nota 0 quando um productId foi citado mas não foi confirmado', () => {
    const results = evaluateStrategyQuality(strategy({ productId: 'p1' }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(results.find(r => r.criterion === 'Product Truth')!.score).toBe(0)
  })

  it('Compliance: nota 0 quando há finding de compliance para esta estratégia', () => {
    const findings: ComplianceFinding[] = [{ strategyIndex: 0, claim: 'desconto', reason: 'não comprovado' }]
    const results = evaluateStrategyQuality(strategy(), { product: null, complianceFindings: findings, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(results.find(r => r.criterion === 'Compliance')!.score).toBe(0)
  })

  it('Compliance: finding de OUTRA estratégia não penaliza esta', () => {
    const findings: ComplianceFinding[] = [{ strategyIndex: 1, claim: 'desconto', reason: 'não comprovado' }]
    const results = evaluateStrategyQuality(strategy(), { product: null, complianceFindings: findings, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(results.find(r => r.criterion === 'Compliance')!.score).toBe(2)
  })

  it('Specificity: nota 0 para mensagem vazia, 1 para curta, 2 para com conteúdo real', () => {
    const empty = evaluateStrategyQuality(strategy({ message: '' }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    const short = evaluateStrategyQuality(strategy({ message: 'Oi, tudo bem por aí?' }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    const full = evaluateStrategyQuality(strategy({ message: 'Uma mensagem real com conteúdo específico e claro o suficiente.' }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(empty.find(r => r.criterion === 'Specificity')!.score).toBe(0)
    expect(short.find(r => r.criterion === 'Specificity')!.score).toBe(1)
    expect(full.find(r => r.criterion === 'Specificity')!.score).toBe(2)
  })

  it('Strategic differentiation: nota 0 quando há finding de distância criativa envolvendo esta estratégia', () => {
    const distance: DistanceFinding[] = [{ strategyIndexA: 0, strategyIndexB: 1, reason: 'parecidas' }]
    const results = evaluateStrategyQuality(strategy(), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: distance, strategyIndex: 0 })
    expect(results.find(r => r.criterion === 'Strategic differentiation')!.score).toBe(0)
  })

  it('CTA clarity: nota 0 sem CTA, 2 com CTA curto', () => {
    const noCta = evaluateStrategyQuality(strategy({ cta: '' }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    const shortCta = evaluateStrategyQuality(strategy({ cta: 'Ver agora' }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(noCta.find(r => r.criterion === 'CTA clarity')!.score).toBe(0)
    expect(shortCta.find(r => r.criterion === 'CTA clarity')!.score).toBe(2)
  })

  it('WhatsApp suitability: nota 0 para mensagem longa demais para o canal', () => {
    const results = evaluateStrategyQuality(strategy({ message: 'x'.repeat(800) }), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    expect(results.find(r => r.criterion === 'WhatsApp suitability')!.score).toBe(0)
  })

  it('nunca produz um critério de previsão de conversão/receita — só os 8 nomes de diagnóstico', () => {
    const results = evaluateStrategyQuality(strategy(), { product: null, complianceFindings: NO_FINDINGS, distanceFindings: NO_DISTANCE, strategyIndex: 0 })
    const banned = /convers[aã]o|receita|venda|previs[aã]o/i
    for (const r of results) {
      expect(r.criterion).not.toMatch(banned)
      expect(r.notes).not.toMatch(banned)
    }
  })
})
