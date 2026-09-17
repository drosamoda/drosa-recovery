import { describe, expect, it } from 'vitest'
import { resolveStrategyDirections, auditDirectionAdherence } from '../../services/ai/strategyPlaybook'
import { OpportunityType } from '../../services/aiOpportunityEngine'

const ALL_TYPES: OpportunityType[] = [
  'ABANDONED_CART', 'PIX_PENDING', 'BOLETO_PENDING', 'VIP',
  'RECENT_CUSTOMER', 'ENGAGED_NO_PURCHASE', 'WINBACK', 'REPEAT_PURCHASE',
]

const NO_EVIDENCE = { hasVerifiedPaymentDeadline: false, hasVerifiedSecondCopySupport: false }
const FULL_EVIDENCE = { hasVerifiedPaymentDeadline: true, hasVerifiedSecondCopySupport: true }

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

  it('PIX_PENDING direção C degrada sem prazo comprovado — usa fallbackGuidance e traz aviso obrigatório', () => {
    const [, , c] = resolveStrategyDirections('PIX_PENDING', NO_EVIDENCE)
    expect(c.degraded).toBe(true)
    expect(c.requiredWarning).not.toBeNull()
    expect(c.guidance).toMatch(/não mencione vencimento/i)
  })

  it('PIX_PENDING direção C NÃO degrada quando o prazo é comprovado (evidence flag true)', () => {
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

  it('direções que não dependem de evidência (ex.: ABANDONED_CART) nunca degradam, com ou sem evidência', () => {
    const withNone = resolveStrategyDirections('ABANDONED_CART', NO_EVIDENCE)
    const withFull = resolveStrategyDirections('ABANDONED_CART', FULL_EVIDENCE)
    expect(withNone.every(d => !d.degraded)).toBe(true)
    expect(withFull.every(d => !d.degraded)).toBe(true)
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
