import { describe, expect, it } from 'vitest'
import { STRATEGY_LAB_FIXTURES } from '../fixtures/strategyLabFixtures'
import { resolveStrategyDirections, auditDirectionAdherence, EvidenceFlags } from '../../services/ai/strategyPlaybook'
import { evaluateCreativeDistance } from '../../services/ai/strategyDistanceService'
import { evaluateStrategyQuality } from '../../services/ai/strategyQualityRubric'
import { auditAllStrategies, auditAttributeClaims, auditClaimCategories } from '../../services/ai/complianceService'
import { WhatsappStrategy as Strategy } from '../../services/ai/aiProvider'
import { ProductTruth } from '../../services/productTruthService'

const TYPES = Object.keys(STRATEGY_LAB_FIXTURES) as Array<keyof typeof STRATEGY_LAB_FIXTURES>

const NO_EVIDENCE: EvidenceFlags = {
  hasCandidateProducts: false,
  hasCategoryEvidence: false,
  hasStockEvidence: false,
  hasNewnessEvidence: false,
  hasPaymentExpiryEvidence: false,
  hasSecondCopySupport: false,
  hasPromotionEvidence: false,
  hasRecoveryUrlEvidence: false,
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function claimCategoryFindingsFor(strategies: Strategy[], type: (typeof TYPES)[number]) {
  return strategies.flatMap((strategy, index) => auditClaimCategories(strategy, index, type, NO_EVIDENCE))
}

describe.each(TYPES)('Strategy Lab v1.1 — %s', (type) => {
  const fixture = STRATEGY_LAB_FIXTURES[type]
  const playbook = resolveStrategyDirections(fixture.opportunity.type, NO_EVIDENCE)
  const strategies = fixture.goodStrategies

  it('gera exatamente 3 estratégias', () => {
    expect(strategies).toHaveLength(3)
  })

  it('A/B/C seguem as 3 direções do playbook, na ordem certa (0=A, 1=B, 2=C)', () => {
    expect(strategies.map(s => s.direction)).toEqual(['A', 'B', 'C'])
    expect(auditDirectionAdherence(strategies, playbook)).toHaveLength(0)
  })

  it('direções degradadas (quando existem, com evidência ausente) trazem o aviso obrigatório do playbook em warnings', () => {
    playbook.forEach((direction, index) => {
      if (!direction.degraded) return
      expect(direction.requiredWarning).not.toBeNull()
      expect(strategies[index].warnings).toContain(direction.requiredWarning)
    })
  })

  it('Product Truth: nenhuma estratégia cita um productId não confirmado (todas usam null, coerente com nenhum candidato real disponível)', () => {
    for (const strategy of strategies) expect(strategy.productId).toBeNull()
  })

  it('Compliance (palavra proibida): zero alegação não comprovada nas 3 estratégias', () => {
    const findings = auditAllStrategies(strategies, [null, null, null])
    expect(findings).toHaveLength(0)
  })

  it('Compliance (claim implícita — v1.1 Truth Hardening): zero claim que pressupõe evidência ausente', () => {
    const findings = claimCategoryFindingsFor(strategies, type)
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

describe('Strategy Lab v1.1 — Truth Hardening: testes negativos obrigatórios (claim implícita sem evidência)', () => {
  function strategy(overrides: Partial<Strategy> = {}): Strategy {
    return {
      direction: 'A', name: 'Estratégia', angle: 'Ângulo genérico', audience: '10 elegíveis', productId: null,
      message: 'Mensagem neutra sem alegação específica.', cta: 'Ver mais', creativeBrief: 'Brief neutro.', warnings: [],
      ...overrides,
    }
  }

  it.each([
    ['ABANDONED_CART' as const, 'separamos um complemento que combina com o que você comprou'],
    ['RECENT_CUSTOMER' as const, 'preparamos uma seleção especial para você'],
  ])('%s · candidateProducts=[] (hasCandidateProducts=false): "%s" => FAIL', (type, message) => {
    const findings = auditClaimCategories(strategy({ message }), 0, type, NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'product_recommendation')).toBe(true)
  })

  it('ABANDONED_CART · hasStockEvidence=false: "o item continua disponível" => FAIL', () => {
    const findings = auditClaimCategories(strategy({ message: 'Boa notícia: o item continua disponível para você.' }), 0, 'ABANDONED_CART', NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'stock_availability')).toBe(true)
  })

  it.each([
    ['RECENT_CUSTOMER' as const, 'chegaram novidades para você'],
    ['WINBACK' as const, 'chegaram novidades desde sua última visita'],
  ])('%s · hasNewnessEvidence=false: "%s" => FAIL', (type, message) => {
    const findings = auditClaimCategories(strategy({ message }), 0, type, NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'newness')).toBe(true)
  })

  it('RECENT_CUSTOMER · hasCategoryEvidence=false: "novidades da mesma categoria" => FAIL', () => {
    const findings = auditClaimCategories(strategy({ message: 'Preparamos novidades da mesma categoria que você já comprou.' }), 0, 'RECENT_CUSTOMER', NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'newness' || f.claim === 'category_affinity')).toBe(true)
  })

  it('REPEAT_PURCHASE · hasCategoryEvidence=false: "categoria que você costuma comprar" => FAIL', () => {
    const findings = auditClaimCategories(strategy({ message: 'Temos novidades na categoria que você costuma comprar.' }), 0, 'REPEAT_PURCHASE', NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'category_affinity')).toBe(true)
  })

  it('PIX_PENDING · hasPaymentExpiryEvidence=false: "o Pix continua disponível" => FAIL', () => {
    const findings = auditClaimCategories(strategy({ message: 'O pagamento via Pix continua disponível para você.' }), 0, 'PIX_PENDING', NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'payment_validity')).toBe(true)
  })

  it('BOLETO_PENDING · hasPaymentExpiryEvidence=false: "o boleto ainda pode ser pago" => FAIL', () => {
    const findings = auditClaimCategories(strategy({ message: 'Não se preocupe, o boleto ainda pode ser pago em qualquer banco.' }), 0, 'BOLETO_PENDING', NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'payment_validity')).toBe(true)
  })

  it('ABANDONED_CART · hasRecoveryUrlEvidence=false: "finalizar quando quiser" => FAIL (microfix v1.1.1 — claim residual)', () => {
    const findings = auditClaimCategories(strategy({ message: 'Ainda dá tempo de finalizar quando quiser.' }), 0, 'ABANDONED_CART', NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'checkout_validity')).toBe(true)
  })

  it('ABANDONED_CART · com hasRecoveryUrlEvidence=true, a mesma frase deixa de ser bloqueada', () => {
    const evidenceWithUrl: EvidenceFlags = { ...NO_EVIDENCE, hasRecoveryUrlEvidence: true }
    const findings = auditClaimCategories(strategy({ message: 'Ainda dá tempo de finalizar quando quiser.' }), 0, 'ABANDONED_CART', evidenceWithUrl)
    expect(findings.some(f => f.claim === 'checkout_validity')).toBe(false)
  })

  it('a mesma frase de disponibilidade NÃO é bloqueada em um tipo fora do escopo da regra (ex.: VIP não audita stock_availability)', () => {
    // stock_availability só se aplica a ABANDONED_CART e payment_validity só a PIX/BOLETO —
    // por isso "continua disponível" em VIP não é auditado por NENHUma das duas regras
    // (nenhuma se aplica ao tipo), o que é o comportamento correto: a frase não pressupõe
    // nem estoque nem validade de pagamento nesse contexto.
    const findings = auditClaimCategories(strategy({ message: 'Esse item continua disponível.' }), 0, 'VIP', NO_EVIDENCE)
    expect(findings.some(f => f.claim === 'stock_availability' || f.claim === 'payment_validity')).toBe(false)
  })

  it('com a evidência comprovada (flag true), a mesma frase deixa de ser bloqueada', () => {
    const evidenceWithStock: EvidenceFlags = { ...NO_EVIDENCE, hasStockEvidence: true }
    const findings = auditClaimCategories(strategy({ message: 'O item continua disponível.' }), 0, 'ABANDONED_CART', evidenceWithStock)
    expect(findings.some(f => f.claim === 'stock_availability')).toBe(false)
  })
})

describe('Strategy Lab v1.1 — Evidence Enrichment: com evidência real, a direção deixa de degradar (seção 9)', () => {
  function strategy(overrides: Partial<Strategy> = {}): Strategy {
    return {
      direction: 'A', name: 'Estratégia', angle: 'Ângulo genérico', audience: '10 elegíveis', productId: null,
      message: 'Mensagem neutra.', cta: 'Ver mais', creativeBrief: 'Brief neutro.', warnings: [],
      ...overrides,
    }
  }

  it('ABANDONED_CART: com produto real + estoque conhecido, a direção C deixa de degradar e pode citar o produto', () => {
    const evidence: EvidenceFlags = { ...NO_EVIDENCE, hasCandidateProducts: true, hasStockEvidence: true }
    const [, , c] = resolveStrategyDirections('ABANDONED_CART', evidence)
    expect(c.degraded).toBe(false)

    const findings = auditClaimCategories(strategy({ message: 'O item continua disponível para você finalizar a compra.' }), 0, 'ABANDONED_CART', evidence)
    expect(findings.some(f => f.claim === 'stock_availability')).toBe(false)
  })

  it('RECENT_CUSTOMER: com produto anterior real, Style Guidance (B) deixa de degradar e pode citar o item comprado — mas complemento (A) continua exigindo candidato próprio', () => {
    const evidence: EvidenceFlags = { ...NO_EVIDENCE, hasCandidateProducts: true }
    const [a, b] = resolveStrategyDirections('RECENT_CUSTOMER', evidence)
    expect(a.degraded).toBe(false)
    expect(b.degraded).toBe(false)

    // "combina bem com o que você já tem" só deixa de ser bloqueada porque hasCandidateProducts
    // agora é true — não porque inventamos uma regra de recomendação nova.
    const findings = auditClaimCategories(strategy({ message: 'Isso combina bem com o que você já tem.' }), 0, 'RECENT_CUSTOMER', evidence)
    expect(findings.some(f => f.claim === 'product_recommendation')).toBe(false)
  })

  it('REPEAT_PURCHASE: histórico real permite contextualizar a compra anterior, mas cross-sell inventado continua bloqueado sem candidato próprio', () => {
    // purchasedProducts (contexto) NÃO é o mesmo que hasCandidateProducts (campaignEvidenceService
    // nunca promove um ao outro sem regra de recomendação real) — por isso a direção A
    // (complemento) continua degradada mesmo com histórico de compra real disponível.
    const evidenceWithHistoryOnly: EvidenceFlags = { ...NO_EVIDENCE, hasCandidateProducts: false }
    const [a] = resolveStrategyDirections('REPEAT_PURCHASE', evidenceWithHistoryOnly)
    expect(a.degraded).toBe(true)

    const findings = auditClaimCategories(strategy({ message: 'Separamos um complemento que combina com o que você já tem.' }), 0, 'REPEAT_PURCHASE', evidenceWithHistoryOnly)
    expect(findings.some(f => f.claim === 'product_recommendation')).toBe(true)
  })

  it('PIX_PENDING/BOLETO_PENDING: com prazo real comprovado, a direção de prazo deixa de degradar e pode citar SOMENTE o prazo fornecido', () => {
    const evidence: EvidenceFlags = { ...NO_EVIDENCE, hasPaymentExpiryEvidence: true }
    const [, , pixC] = resolveStrategyDirections('PIX_PENDING', evidence)
    const [, , boletoC] = resolveStrategyDirections('BOLETO_PENDING', evidence)
    expect(pixC.degraded).toBe(false)
    expect(boletoC.degraded).toBe(false)
    expect(pixC.guidance).toMatch(/citando apenas o dado de prazo fornecido/i)
    expect(boletoC.guidance).toMatch(/citando apenas o dado de prazo fornecido/i)

    const findings = auditClaimCategories(strategy({ message: 'O Pix continua disponível até o prazo informado.' }), 0, 'PIX_PENDING', evidence)
    expect(findings.some(f => f.claim === 'payment_validity')).toBe(false)
  })

  it('inverso: retirar a evidência volta automaticamente à versão degradada (nenhum estado fica "preso" no modo real)', () => {
    const withEvidence: EvidenceFlags = { ...NO_EVIDENCE, hasCandidateProducts: true }
    const withoutEvidence: EvidenceFlags = { ...NO_EVIDENCE }
    const [aWith] = resolveStrategyDirections('VIP', withEvidence)
    const [aWithout] = resolveStrategyDirections('VIP', withoutEvidence)
    expect(aWith.degraded).toBe(false)
    expect(aWithout.degraded).toBe(true)
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

  it('sem promoção comprovada: alegação de desconto/cupom é bloqueada mesmo com produto real confirmado (palavra proibida e claim implícita)', () => {
    const product: ProductTruth = { productId: 'p1', name: 'Vestido', url: null, image: null, price: null, compareAtPrice: null, variants: 1, colors: null, sizes: null, stockStatus: 'unknown', description: 'Vestido básico.', updatedAt: '2026-01-01' }
    const guardedFindings = auditAllStrategies([strategy({ productId: 'p1', message: 'Aproveite o cupom de desconto exclusivo desta semana!' })], [product])
    expect(guardedFindings.some(f => f.claim === 'cupom')).toBe(true)
    expect(guardedFindings.some(f => f.claim === 'desconto')).toBe(true)
    expect(guardedFindings.some(f => f.claim === 'exclusivo')).toBe(true)

    const claimFindings = auditClaimCategories(strategy({ message: 'Aproveite o cupom de desconto desta semana!' }), 0, 'VIP', NO_EVIDENCE)
    expect(claimFindings.some(f => f.claim === 'promotion')).toBe(true)
  })

  it('sem histórico de categoria comprovado: direções de afinidade de categoria (WINBACK/RECENT_CUSTOMER/REPEAT_PURCHASE) da fixture não citam categoria nem novidade sem evidência', () => {
    const winbackB = STRATEGY_LAB_FIXTURES.WINBACK.goodStrategies[1]
    const recentC = STRATEGY_LAB_FIXTURES.RECENT_CUSTOMER.goodStrategies[2]
    const repeatC = STRATEGY_LAB_FIXTURES.REPEAT_PURCHASE.goodStrategies[2]
    expect(auditClaimCategories(winbackB, 1, 'WINBACK', NO_EVIDENCE)).toHaveLength(0)
    expect(auditClaimCategories(recentC, 2, 'RECENT_CUSTOMER', NO_EVIDENCE)).toHaveLength(0)
    expect(auditClaimCategories(repeatC, 2, 'REPEAT_PURCHASE', NO_EVIDENCE)).toHaveLength(0)
  })
})
