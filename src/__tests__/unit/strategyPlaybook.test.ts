import { describe, expect, it } from 'vitest'
import { resolveStrategyDirections, auditDirectionAdherence, EvidenceFlags } from '../../services/ai/strategyPlaybook'
import { OpportunityType } from '../../services/aiOpportunityEngine'

const ALL_TYPES: OpportunityType[] = [
  'ABANDONED_CART', 'PIX_PENDING', 'BOLETO_PENDING', 'VIP',
  'RECENT_CUSTOMER', 'ENGAGED_NO_PURCHASE', 'WINBACK', 'REPEAT_PURCHASE',
]

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
const FULL_EVIDENCE: EvidenceFlags = {
  hasCandidateProducts: true,
  hasCategoryEvidence: true,
  hasStockEvidence: true,
  hasNewnessEvidence: true,
  hasPaymentExpiryEvidence: true,
  hasSecondCopySupport: true,
  hasPromotionEvidence: true,
  hasRecoveryUrlEvidence: true,
}

describe('strategyPlaybook — resolução determinística por tipo de oportunidade', () => {
  it.each(ALL_TYPES)('%s tem exatamente 3 direções, com keys A, B, C nessa ordem', (type) => {
    const directions = resolveStrategyDirections(type, NO_EVIDENCE)
    expect(directions).toHaveLength(3)
    expect(directions.map(d => d.key)).toEqual(['A', 'B', 'C'])
  })

  it.each(ALL_TYPES)('%s: toda direção tem label, intent e guidance não vazios', (type) => {
    for (const direction of resolveStrategyDirections(type, NO_EVIDENCE)) {
      expect(direction.label.length).toBeGreaterThan(0)
      expect(direction.intent.length).toBeGreaterThan(0)
      expect(direction.guidance.length).toBeGreaterThan(0)
    }
  })

  it.each(ALL_TYPES)('%s: com evidência completa, nenhuma direção fica degradada', (type) => {
    const directions = resolveStrategyDirections(type, FULL_EVIDENCE)
    expect(directions.every(d => !d.degraded)).toBe(true)
    expect(directions.every(d => d.requiredWarning === null)).toBe(true)
  })

  it('ABANDONED_CART: B nunca degrada (não depende de evidência); A degrada sem hasRecoveryUrlEvidence; C degrada sem hasStockEvidence', () => {
    const [a, b, c] = resolveStrategyDirections('ABANDONED_CART', NO_EVIDENCE)
    expect(a.degraded).toBe(true)
    expect(b.degraded).toBe(false)
    expect(c.degraded).toBe(true)
    expect(a.guidance).toMatch(/não ofereça retomar o checkout diretamente/i)
    expect(c.guidance).toMatch(/não afirme nem implique que ele está disponível/i)
  })

  it('ABANDONED_CART: A não degrada quando existe URL de recuperação real e válida confirmada', () => {
    const [a] = resolveStrategyDirections('ABANDONED_CART', { ...NO_EVIDENCE, hasRecoveryUrlEvidence: true })
    expect(a.degraded).toBe(false)
    expect(a.guidance).toMatch(/cta de retomada direta do checkout/i)
  })

  it('PIX_PENDING direção C degrada sem prazo comprovado (hasPaymentExpiryEvidence=false) — usa fallbackGuidance e traz aviso obrigatório', () => {
    const [, , c] = resolveStrategyDirections('PIX_PENDING', NO_EVIDENCE)
    expect(c.degraded).toBe(true)
    expect(c.requiredWarning).not.toBeNull()
    expect(c.guidance).toMatch(/não implique que o pix continua válido/i)
  })

  it('PIX_PENDING direção C NÃO degrada quando o prazo é comprovado (hasPaymentExpiryEvidence=true)', () => {
    const [, , c] = resolveStrategyDirections('PIX_PENDING', FULL_EVIDENCE)
    expect(c.degraded).toBe(false)
    expect(c.requiredWarning).toBeNull()
    expect(c.guidance).toMatch(/prazo real de expiração/i)
  })

  it('BOLETO_PENDING direções B e C degradam sem segunda via/prazo comprovados', () => {
    const [, b, c] = resolveStrategyDirections('BOLETO_PENDING', NO_EVIDENCE)
    expect(b.degraded).toBe(true)
    expect(c.degraded).toBe(true)
    expect(b.requiredWarning).not.toBeNull()
    expect(c.requiredWarning).not.toBeNull()
  })

  it('BOLETO_PENDING direções B e C não degradam quando os dois dados são comprovados', () => {
    const [, b, c] = resolveStrategyDirections('BOLETO_PENDING', FULL_EVIDENCE)
    expect(b.degraded).toBe(false)
    expect(c.degraded).toBe(false)
  })

  it('VIP: A e C degradam sem produto candidato real; B nunca degrada', () => {
    const [a, b, c] = resolveStrategyDirections('VIP', NO_EVIDENCE)
    expect(a.degraded).toBe(true)
    expect(b.degraded).toBe(false)
    expect(c.degraded).toBe(true)
  })

  it('RECENT_CUSTOMER: as 3 direções degradam sem produto candidato/categoria comprovados', () => {
    const directions = resolveStrategyDirections('RECENT_CUSTOMER', NO_EVIDENCE)
    expect(directions.every(d => d.degraded)).toBe(true)
  })

  it('ENGAGED_NO_PURCHASE: só B degrada (depende de produto candidato); A e C nunca dependem de evidência', () => {
    const [a, b, c] = resolveStrategyDirections('ENGAGED_NO_PURCHASE', NO_EVIDENCE)
    expect(a.degraded).toBe(false)
    expect(b.degraded).toBe(true)
    expect(c.degraded).toBe(false)
  })

  it('WINBACK: A e B degradam sem produto candidato/categoria comprovados; C nunca degrada', () => {
    const [a, b, c] = resolveStrategyDirections('WINBACK', NO_EVIDENCE)
    expect(a.degraded).toBe(true)
    expect(b.degraded).toBe(true)
    expect(c.degraded).toBe(false)
  })

  it('REPEAT_PURCHASE: as 3 direções degradam sem produto candidato/categoria comprovados', () => {
    const directions = resolveStrategyDirections('REPEAT_PURCHASE', NO_EVIDENCE)
    expect(directions.every(d => d.degraded)).toBe(true)
  })
})

describe('auditDirectionAdherence — garante que a IA não embaralhou/pulou A/B/C', () => {
  const playbook = resolveStrategyDirections('ABANDONED_CART', NO_EVIDENCE)

  it('não encontra findings quando as 3 estratégias seguem A, B, C na ordem certa', () => {
    const strategies = [{ direction: 'A' }, { direction: 'B' }, { direction: 'C' }]
    expect(auditDirectionAdherence(strategies, playbook)).toHaveLength(0)
  })

  it('encontra finding quando duas estratégias trocam de direção entre si', () => {
    const strategies = [{ direction: 'B' }, { direction: 'A' }, { direction: 'C' }]
    const findings = auditDirectionAdherence(strategies, playbook)
    expect(findings.map(f => f.strategyIndex)).toEqual([0, 1])
  })

  it('encontra finding quando uma estratégia repete a direção de outra em vez de seguir a sua própria', () => {
    const strategies = [{ direction: 'A' }, { direction: 'A' }, { direction: 'C' }]
    const findings = auditDirectionAdherence(strategies, playbook)
    expect(findings.map(f => f.strategyIndex)).toEqual([1])
  })

  it('trata estratégia ausente no índice como "ausente" e reporta o finding', () => {
    const strategies = [{ direction: 'A' }, { direction: 'B' }]
    const findings = auditDirectionAdherence(strategies, playbook)
    expect(findings).toEqual([{ strategyIndex: 2, expected: 'C', actual: 'ausente', reason: expect.any(String) }])
  })
})
