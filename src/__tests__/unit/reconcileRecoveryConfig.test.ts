import { describe, expect, it, vi } from 'vitest'
import {
  canonicalAutomationRules,
  canonicalWhatsappTemplates,
  legacyBlockedTemplateNames,
} from '../../config/recoveryCanonicalConfig'
import {
  applyRecoveryConfig,
  auditRecoveryConfig,
} from '../../ops/reconcileRecoveryConfig'

function canonicalTemplateById(id: string) {
  const item = canonicalWhatsappTemplates.find((template) => template.id === id)
  if (!item) return null
  return {
    name: item.name,
    eventType: item.eventType,
    metaTemplateName: item.metaTemplateName,
    languageCode: item.languageCode,
    category: item.category,
    messagePreview: item.messagePreview,
    variables: item.variables,
    active: item.active,
  }
}

function canonicalRuleById(id: string) {
  const item = canonicalAutomationRules.find((rule) => rule.id === id)
  if (!item) return null
  return {
    name: item.name,
    eventType: item.eventType,
    templateName: item.templateName,
    delayMinutes: item.delayMinutes,
    active: item.active,
    maxSendsPerEntity: item.maxSendsPerEntity,
    stopIfOrderExists: item.stopIfOrderExists,
  }
}

describe('recovery config legacy quarantine', () => {
  it('audit reports pending message logs from a blocked legacy template', async () => {
    const legacy = legacyBlockedTemplateNames[0]
    const client = {
      whatsappTemplate: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => canonicalTemplateById(where.id)),
        count: vi.fn().mockResolvedValue(0),
      },
      automationRule: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => canonicalRuleById(where.id)),
        count: vi.fn().mockResolvedValue(0),
      },
      messageLog: {
        count: vi.fn(async ({ where }: { where: { templateName: string; status: string } }) =>
          where.templateName === legacy && where.status === 'pending' ? 2 : 0),
      },
    }

    const drift = await auditRecoveryConfig(client as never)

    expect(drift).toContainEqual({
      kind: 'legacy',
      id: legacy,
      fields: ['pendingMessageLogs:2'],
    })
  })

  it('apply disables legacy config and quarantines only pending legacy logs', async () => {
    const legacy = legacyBlockedTemplateNames[0]
    const tx = {
      whatsappTemplate: {
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
      automationRule: {
        upsert: vi.fn(),
        updateMany: vi.fn(),
      },
      messageLog: {
        updateMany: vi.fn(),
      },
    }
    const client = {
      $transaction: vi.fn(async (fn: (arg: typeof tx) => Promise<void>) => fn(tx)),
    }

    await applyRecoveryConfig(client as never)

    expect(tx.whatsappTemplate.updateMany).toHaveBeenCalledWith({
      where: { metaTemplateName: legacy },
      data: { active: false },
    })
    expect(tx.automationRule.updateMany).toHaveBeenCalledWith({
      where: { templateName: legacy },
      data: { active: false },
    })
    expect(tx.messageLog.updateMany).toHaveBeenCalledWith({
      where: { templateName: legacy, status: 'pending' },
      data: {
        status: 'skipped',
        reason: 'legacy_template_disabled',
        nextRetryAt: null,
        claimOwner: null,
        claimExpiresAt: null,
      },
    })
  })
})
