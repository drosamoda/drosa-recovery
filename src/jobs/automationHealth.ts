import { env } from '../config/env'
import { prisma } from '../config/prisma'
import { templateContracts, verifyMetaTemplateContract } from '../services/templateContracts'

type ReadinessIssue = {
  code: string
  detail: string
}

export async function automationHealth() {
  const sendBlockReason =
    !env.AUTOMATION_SEND_ENABLED
      ? 'automation_send_disabled'
      : env.WHATSAPP_DRY_RUN
        ? 'whatsapp_dry_run'
        : env.AUTOMATION_ALLOWED_TEMPLATES.length === 0
          ? 'automation_allowlist_required'
          : null

  const metaConfigured = Boolean(
    env.META_ACCESS_TOKEN &&
    env.META_PHONE_NUMBER_ID &&
    env.META_APP_SECRET &&
    env.META_WABA_ID,
  )
  const nuvemshopConfigured = Boolean(env.NUVEMSHOP_ACCESS_TOKEN && env.NUVEMSHOP_STORE_ID)

  const flags = {
    cronEnabled: env.ENABLE_INTERNAL_CRON,
    automationSendEnabled: env.AUTOMATION_SEND_ENABLED,
    whatsappDryRun: env.WHATSAPP_DRY_RUN,
    abandonedCartEnabled: env.ABANDONED_CART_ENABLED,
    remarketingEnabled: env.REMARKETING_ENABLED,
    automationAllowedTemplates: env.AUTOMATION_ALLOWED_TEMPLATES,
    sendBlockReason,
    realSendConfigArmed: sendBlockReason === null,
    abandonedCartRealSendArmed: sendBlockReason === null && env.ABANDONED_CART_ENABLED,
    remarketingRealSendArmed: sendBlockReason === null && env.REMARKETING_ENABLED,
    marketingWindow: {
      startHour: env.MARKETING_SEND_HOUR_START,
      endHour: env.MARKETING_SEND_HOUR_END,
      timeZone: env.MARKETING_TIME_ZONE,
    },
    metaConfigured,
    nuvemshopConfigured,
  }

  try {
    const now = new Date()
    const [
      pendingMessages,
      processingMessages,
      deliveryUnknownMessages,
      failedMessages,
      activeRuleRows,
      activeTemplateRows,
      activeMarketingConsents,
      suppressedContacts,
      expiredClaims,
    ] = await Promise.all([
      prisma.messageLog.count({ where: { status: 'pending' } }),
      prisma.messageLog.count({ where: { status: 'processing' } }),
      prisma.messageLog.count({ where: { status: 'unknown' } }),
      prisma.messageLog.count({ where: { status: 'failed' } }),
      prisma.automationRule.findMany({
        where: { active: true },
        select: { id: true, eventType: true, templateName: true },
        orderBy: { id: 'asc' },
      }),
      prisma.whatsappTemplate.findMany({
        where: { active: true },
        select: { id: true, metaTemplateName: true, languageCode: true, category: true },
        orderBy: { id: 'asc' },
      }),
      prisma.whatsappConsent.count({
        where: {
          scope: 'marketing',
          consented: true,
          revokedAt: null,
          consentedAt: { not: null },
        },
      }),
      prisma.suppression.count(),
      prisma.messageLog.count({
        where: {
          status: 'processing',
          claimExpiresAt: { lt: now },
        },
      }),
    ])

    const issues: ReadinessIssue[] = []
    const templatesByName = new Map(activeTemplateRows.map((template) => [template.metaTemplateName, template]))

    for (const rule of activeRuleRows) {
      const template = templatesByName.get(rule.templateName)
      if (!template) {
        issues.push({
          code: 'active_rule_without_active_template',
          detail: `${rule.id} -> ${rule.templateName}`,
        })
        continue
      }

      const contract = templateContracts[rule.templateName]
      if (!contract) {
        issues.push({
          code: 'active_template_without_local_contract',
          detail: rule.templateName,
        })
        continue
      }

      if (contract.language !== template.languageCode) {
        issues.push({
          code: 'template_language_mismatch',
          detail: `${rule.templateName}: db=${template.languageCode}, contract=${contract.language}`,
        })
      }

      const expectedCategory = contract.category.toLowerCase()
      if (String(template.category).toLowerCase() !== expectedCategory) {
        issues.push({
          code: 'template_category_mismatch',
          detail: `${rule.templateName}: db=${template.category}, contract=${expectedCategory}`,
        })
      }
    }

    for (const allowedTemplate of env.AUTOMATION_ALLOWED_TEMPLATES) {
      if (!templatesByName.has(allowedTemplate)) {
        issues.push({
          code: 'allowlist_template_not_active',
          detail: allowedTemplate,
        })
      }
      if (!templateContracts[allowedTemplate]) {
        issues.push({
          code: 'allowlist_template_without_local_contract',
          detail: allowedTemplate,
        })
      }
    }

    if (expiredClaims > 0) {
      issues.push({
        code: 'expired_processing_claims',
        detail: String(expiredClaims),
      })
    }

    const templatesToVerify = [...new Set(activeRuleRows.map((rule) => rule.templateName))]
      .filter((name) => Boolean(templateContracts[name]))

    const metaTemplateChecks = metaConfigured
      ? await Promise.all(
          templatesToVerify.map(async (name) => ({
            name,
            error: await verifyMetaTemplateContract(name, templateContracts[name].language),
          })),
        )
      : templatesToVerify.map((name) => ({ name, error: 'meta_not_configured' }))

    for (const check of metaTemplateChecks) {
      if (check.error) {
        issues.push({
          code: 'meta_template_not_ready',
          detail: `${check.name}: ${check.error}`,
        })
      }
    }

    if (!metaConfigured) {
      issues.push({ code: 'meta_not_configured', detail: 'Meta/WABA credentials incomplete' })
    }
    if (!nuvemshopConfigured) {
      issues.push({ code: 'nuvemshop_not_configured', detail: 'Nuvemshop credentials incomplete' })
    }

    const preflightReady = issues.length === 0

    return {
      ...flags,
      databaseReachable: true,
      preflightReady,
      readinessIssues: issues,
      pendingMessages,
      processingMessages,
      deliveryUnknownMessages,
      failedMessages,
      expiredClaims,
      activeRules: activeRuleRows.length,
      activeTemplates: activeTemplateRows.length,
      activeMarketingConsents,
      suppressedContacts,
      activeRuleDetails: activeRuleRows,
      activeTemplateDetails: activeTemplateRows,
      metaTemplateChecks,
    }
  } catch {
    return {
      ...flags,
      databaseReachable: false,
      preflightReady: false,
      readinessIssues: [{ code: 'database_unreachable', detail: 'database health query failed' }],
    }
  }
}
