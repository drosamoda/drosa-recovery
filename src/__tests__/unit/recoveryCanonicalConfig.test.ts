import { describe, expect, it } from 'vitest'
import { TemplateCategory } from '@prisma/client'
import {
  canonicalAutomationRules,
  canonicalWhatsappTemplates,
  legacyBlockedTemplateNames,
} from '../../config/recoveryCanonicalConfig'
import { templateContracts } from '../../services/templateContracts'

describe('canonical recovery configuration', () => {
  it('has one canonical template for every canonical automation rule', () => {
    const templateNames = new Set(canonicalWhatsappTemplates.map((item) => item.metaTemplateName))

    for (const rule of canonicalAutomationRules) {
      expect(templateNames.has(rule.templateName), `missing template for ${rule.id}`).toBe(true)
    }
  })

  it('has an exact dispatch contract for every canonical template', () => {
    for (const template of canonicalWhatsappTemplates) {
      const contract = templateContracts[template.metaTemplateName]
      expect(contract, `missing contract for ${template.metaTemplateName}`).toBeDefined()
      expect(contract.language).toBe(template.languageCode)
      expect(contract.category.toLowerCase()).toBe(template.category)
      expect(contract.parameters).toHaveLength(template.variables.length)
    }
  })

  it('keeps only confirmation and abandoned-cart v2 active before controlled activation', () => {
    const activeTemplates = canonicalWhatsappTemplates
      .filter((item) => item.active)
      .map((item) => item.metaTemplateName)
      .sort()
    const activeRules = canonicalAutomationRules
      .filter((item) => item.active)
      .map((item) => item.templateName)
      .sort()

    expect(activeTemplates).toEqual([
      'carrinho_abandonado_drosa_v2',
      'confirmacao_pedido_drosa',
    ])
    expect(activeRules).toEqual(activeTemplates)
  })

  it('keeps all phase-2 rules inactive until each Meta contract is approved and explicitly activated', () => {
    const phase2 = canonicalAutomationRules.filter(
      (item) => !['rule_order_created', 'rule_abandoned_checkout'].includes(item.id),
    )
    expect(phase2.length).toBeGreaterThan(0)
    expect(phase2.every((item) => item.active === false)).toBe(true)
  })

  it('never makes the blocked legacy abandoned-cart template canonical', () => {
    const canonicalNames = new Set(canonicalWhatsappTemplates.map((item) => item.metaTemplateName))
    for (const legacy of legacyBlockedTemplateNames) {
      expect(canonicalNames.has(legacy)).toBe(false)
    }
  })

  it('marks marketing templates consistently for consent enforcement', () => {
    const expectedMarketing = new Set([
      'carrinho_abandonado_drosa_v2',
      '_pix_pendente',
      'pagamento_confirmado_drosa_01',
      'pix_cancelado_drosa_01',
      'cliente_recente_drosa_v1',
      'cliente_vip_drosa_v1',
      'cliente_inativo_drosa_v1',
      'atendimento_retomada_drosa_v1',
    ])

    const actualMarketing = new Set(
      canonicalWhatsappTemplates
        .filter((item) => item.category === TemplateCategory.marketing)
        .map((item) => item.metaTemplateName),
    )

    expect(actualMarketing).toEqual(expectedMarketing)
  })
})
