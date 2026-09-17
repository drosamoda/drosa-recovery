import { describe, expect, it } from 'vitest'
import { STRATEGY_LAB_FIXTURES } from '../fixtures/strategyLabFixtures'
import { resolveStrategyDirections, auditDirectionAdherence } from '../../services/ai/strategyPlaybook'
import { evaluateCreativeDistance } from '../../services/ai/strategyDistanceService'
import { evaluateStrategyQuality } from '../../services/ai/strategyQualityRubric'
import { auditAllStrategies, auditAttributeClaims } from '../../services/ai/complianceService'
import { Strategy } from '../../services/ai/aiProvider'
import { ProductTruth } from '../../services/productTruthService'

const TYPES = Object.keys(STRATEGY_LAB_FIXTURES) as Array<keyof typeof STRATEGY_LAB_FIXTURES>

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

describe.each(TYPES)('Strategy Lab v1 — %s', (type) => {
  const fixture = STRATEGY_LAB_FIXTURES[type]
  const evidenceFlags = { hasVerifiedPaymentDeadline: false, hasVerifiedSecondCopySupport: false }
  const playbook = resolveStrategyDirections(fixture.opportunity.type, evidenceFlags)
  const strategies = fixture.goodStrategies

  it('gera exatamente 3 estratégias', () => {
    expect(strategies).toHaveLength(3)
  })

  it('A/B/C seguem as 3 direções do playbook, na ordem certa (0=A, 1=B, 2=C)', () => {
    expect(strategies.map(s => s.direction)).toEqual(['A', 'B', 'C'])
    expect(auditDirectionAdherence(strategies, playbook)).toHaveLength(0)
  })

  it('direções degradadas (quando existem) trazem o aviso obrigatório do playbook em warnings', () => {
    playbook.forEach((direction, index) => {
      if (!direction.degraded) return
      expect(direction.requiredWarning).not.toBeNull()
      expect(strategies[index].warnings).toContain(direction.requiredWarning)
    })
  })

  it('Product Truth: nenhuma estratégia cita um productId não confirmado (todas usam null, coerente com nenhum candidato real disponível)', () => {
    for (const strategy of strategies) expect(strategy.productId).toBeNull()
  })

  it('Compliance: zero alegação não comprovada nas 3 estratégias', () => {
    const findings = auditAllStrategies(strategies, [null, null, null])
    expect(findings).toHaveLength(0)
  })

  it('Creative Distance: as 3 estratégias são realmente distintas entre si', () => {
    const findings = evaluateCreativeDistance(strategies)
    expect(findings).toHaveLength(0)
  })

  it('CTA compatível com WhatsApp: curto e presente em todas as 3 estratégias', () => {
    for (const strategy of strategies) {
      expect(strategy.cta.trim().length).toBeGreaterThan(0)
      expect(wordCount(strategy.cta)).toBeLessThanOrEqual(8)
    }
  })

  it('rubric de qualidade não reprova nenhum critério para as estratégias "boas" da fixture', () => {
    const complianceFindings = auditAllStrategies(strategies, [null, null, null])
    const distanceFindings = evaluateCreativeDistance(strategies)
    strategies.forEach((strategy, index) => {
      const results = evaluateStrategyQuality(strategy, { product: null, complianceFindings, distanceFindings, strategyIndex: index })
      for (const result of results) expect(result.score, `${result.criterion} (estratégia ${index})`).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('Strategy Lab v1 — dados incompletos (a IA deve reduzir especificidade, não inventar)', () => {
  function strategy(overrides: Partial<Strategy> = {}): Strategy {
    return {
      direction: 'A', name: 'Estratégia', angle: 'Ângulo genérico', audience: '10 elegíveis', productId: null,
      message: 'Mensagem neutra sem alegação específica sobre o produto.', cta: 'Ver mais', creativeBrief: 'Brief neutro.', warnings: [],
      ...overrides,
    }
  }

  it('sem produto candidato: productId null é aceito sem qualquer finding (nunca inventa um produto)', () => {
    const findings = auditAllStrategies([strategy({ productId: null })], [null])
    expect(findings).toHaveLength(0)
  })

  it('sem estoque conhecido (stockStatus unknown): alegação de escassez ainda é bloqueada mesmo com um produto real confirmado', () => {
    const product: ProductTruth = { productId: 'p1', name: 'Vestido', url: null, image: null, price: null, compareAtPrice: null, variants: 1, colors: null, sizes: null, stockStatus: 'unknown', description: 'Vestido básico.', updatedAt: '2026-01-01' }
    const findings = auditAllStrategies([strategy({ productId: 'p1', cta: 'Corre, estoque acabando!' })], [product])
    expect(findings.some(f => f.claim === 'estoque acabando')).toBe(true)
  })

  it('sem cor confirmada: menção a cor é bloqueada quando product.colors não confirma (mesmo com produto real)', () => {
    const product: ProductTruth = { productId: 'p1', name: 'Vestido', url: null, image: null, price: null, compareAtPrice: null, variants: 1, colors: null, sizes: null, stockStatus: 'unknown', description: 'Vestido básico.', updatedAt: '2026-01-01' }
    const findings = auditAttributeClaims(strategy({ productId: 'p1', message: 'Esse vestido azul ficou lindo em você.' }), 0, product)
    expect(findings.some(f => f.claim === 'azul')).toBe(true)
  })

  it('cor confirmada em product.colors passa — não é invenção quando a fonte estruturada real confirma', () => {
    const product: ProductTruth = { productId: 'p1', name: 'Vestido', url: null, image: null, price: null, compareAtPrice: null, variants: 1, colors: ['Azul'], sizes: null, stockStatus: 'unknown', description: 'Vestido básico.', updatedAt: '2026-01-01' }
    const findings = auditAttributeClaims(strategy({ productId: 'p1', message: 'Esse vestido azul ficou lindo em você.' }), 0, product)
    expect(findings.some(f => f.claim === 'azul')).toBe(false)
  })

  it('sem tecido confirmado: menção a tecido é bloqueada quando a descrição real não a comprova', () => {
    const product: ProductTruth = { productId: 'p1', name: 'Vestido', url: null, image: null, price: null, compareAtPrice: null, variants: 1, colors: null, sizes: null, stockStatus: 'unknown', description: 'Vestido básico.', updatedAt: '2026-01-01' }
    const findings = auditAllStrategies([strategy({ productId: 'p1', message: 'Feito em linho puro, super fresquinho.' })], [product])
    expect(findings.some(f => f.claim === 'linho')).toBe(true)
  })

  it('sem preço confirmado (price null): a ausência de preço não é penalizada nem gera finding — a IA simplesmente não recebe o dado para citar', () => {
    const product: ProductTruth = { productId: 'p1', name: 'Vestido', url: null, image: null, price: null, compareAtPrice: null, variants: 1, colors: null, sizes: null, stockStatus: 'unknown', description: 'Vestido básico.', updatedAt: '2026-01-01' }
    const findings = auditAllStrategies([strategy({ productId: 'p1' })], [product])
    expect(findings).toHaveLength(0)
  })

  it('sem promoção comprovada: alegação de desconto/cupom é bloqueada mesmo com produto real confirmado', () => {
    const product: ProductTruth = { productId: 'p1', name: 'Vestido', url: null, image: null, price: null, compareAtPrice: null, variants: 1, colors: null, sizes: null, stockStatus: 'unknown', description: 'Vestido básico.', updatedAt: '2026-01-01' }
    const findings = auditAllStrategies([strategy({ productId: 'p1', message: 'Aproveite o cupom de desconto exclusivo desta semana!' })], [product])
    expect(findings.some(f => f.claim === 'cupom')).toBe(true)
    expect(findings.some(f => f.claim === 'desconto')).toBe(true)
    expect(findings.some(f => f.claim === 'exclusivo')).toBe(true)
  })

  it('sem histórico de categoria comprovado: direções de afinidade de categoria (WINBACK/VIP) da fixture não citam uma categoria específica inventada', () => {
    // Nenhuma fonte real de "categoria de interesse" existe hoje em Opportunity —
    // por isso este teste verifica a própria fixture de exemplo (documentação viva),
    // não um bloqueio automático de código: não existe uma lista de categorias reais
    // para comparar contra, então esta é uma garantia de autoria, não um gate.
    const invented = /\b(vestido|calça|blusa|sapato|bolsa|camisa|saia|short)\b/i
    const winbackB = STRATEGY_LAB_FIXTURES.WINBACK.goodStrategies[1]
    expect(winbackB.message).not.toMatch(invented)
    expect(winbackB.angle).not.toMatch(invented)
  })
})
