import { env } from '../config/env'
import { prisma } from '../config/prisma'
import { templateContracts, verifyMetaTemplateContract } from '../services/templateContracts'
import { canonicalWhatsappTemplates, legacyBlockedTemplateNames } from '../config/recoveryCanonicalConfig'

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
    inboxSendDryRun: env.INBOX_SEND_DRY_RUN,
    manualInboxRealSendArmed: !env.INBOX_SEND_DRY_RUN,
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
      legacyPendingMessages,
      stalePendingMessages,
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
      prisma.messageLog.count({
        where: {
          status: 'pending',
          templateName: { in: [...legacyBlockedTemplateNames] },
        },
      }),
      prisma.messageLog.count({
        where: {
          status: 'pending',
          scheduledAt: {
            lt: new Date(now.getTime() - env.AUTOMATION_MAX_MESSAGE_AGE_HOURS * 60 * 60 * 1000),
          },
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

    if (legacyPendingMessages > 0) {
      issues.push({
        code: 'legacy_pending_messages',
        detail: String(legacyPendingMessages),
      })
    }

    if (stalePendingMessages > 0) {
      issues.push({
        code: 'stale_pending_messages',
        detail: String(stalePendingMessages),
      })
    }

    const activeTemplatesToVerify = [...new Set(activeRuleRows.map((rule) => rule.templateName))]
      .filter((name) => Boolean(templateContracts[name]))
    const sendScopeTemplates = [...new Set(env.AUTOMATION_ALLOWED_TEMPLATES)]
    const templatesToVerify = [...new Set([...activeTemplatesToVerify, ...sendScopeTemplates])]
      .filter((name) => Boolean(templateContracts[name]))

    const allMetaTemplateChecks = metaConfigured
      ? await Promise.all(
          templatesToVerify.map(async (name) => ({
            name,
            error: await verifyMetaTemplateContract(name, templateContracts[name].language),
          })),
        )
      : templatesToVerify.map((name) => ({ name, error: 'meta_not_configured' }))

    const metaChecksByName = new Map(allMetaTemplateChecks.map((check) => [check.name, check]))
    const metaTemplateChecks = activeTemplatesToVerify
      .map((name) => metaChecksByName.get(name))
      .filter((check): check is { name: string; error: string | null } => Boolean(check))
    const sendScopeMetaTemplateChecks = sendScopeTemplates
      .map((name) => metaChecksByName.get(name) ?? { name, error: 'template_contract_missing' })

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

    const sendScopeIssues: ReadinessIssue[] = []
    if (sendScopeTemplates.length === 0) {
      sendScopeIssues.push({ code: 'automation_allowlist_required', detail: 'No template is allowlisted for controlled send' })
    }
    for (const templateName of sendScopeTemplates) {
      if (!templatesByName.has(templateName)) {
        sendScopeIssues.push({ code: 'allowlist_template_not_active', detail: templateName })
      }
      if (!templateContracts[templateName]) {
        sendScopeIssues.push({ code: 'allowlist_template_without_local_contract', detail: templateName })
      }
    }
    for (const check of sendScopeMetaTemplateChecks) {
      if (check.error) {
        sendScopeIssues.push({
          code: 'meta_template_not_ready',
          detail: `${check.name}: ${check.error}`,
        })
      }
    }
    if (!metaConfigured) {
      sendScopeIssues.push({ code: 'meta_not_configured', detail: 'Meta/WABA credentials incomplete' })
    }
    if (!nuvemshopConfigured) {
      sendScopeIssues.push({ code: 'nuvemshop_not_configured', detail: 'Nuvemshop credentials incomplete' })
    }
    if (expiredClaims > 0) {
      sendScopeIssues.push({ code: 'expired_processing_claims', detail: String(expiredClaims) })
    }
    if (legacyPendingMessages > 0) {
      sendScopeIssues.push({ code: 'legacy_pending_messages', detail: String(legacyPendingMessages) })
    }
    if (stalePendingMessages > 0) {
      sendScopeIssues.push({ code: 'stale_pending_messages', detail: String(stalePendingMessages) })
    }

    const canonicalTemplateNames = canonicalWhatsappTemplates.map((template) => template.metaTemplateName)
    const canonicalMetaTemplateChecks = metaConfigured
      ? await Promise.all(
          canonicalWhatsappTemplates.map(async (template) => ({
            name: template.metaTemplateName,
            activeByDefault: template.active,
            error: await verifyMetaTemplateContract(template.metaTemplateName, template.languageCode),
          })),
        )
      : canonicalWhatsappTemplates.map((template) => ({
          name: template.metaTemplateName,
          activeByDefault: template.active,
          error: 'meta_not_configured',
        }))
    const canonicalTemplatesReady = canonicalMetaTemplateChecks.every((check) => check.error === null)

    const preflightReady = issues.length === 0
    const sendScopeReady = sendScopeIssues.length === 0

    return {
      ...flags,
      databaseReachable: true,
      preflightReady,
      readinessIssues: issues,
      sendScopeReady,
      sendScopeIssues,
      sendScopeTemplates,
      pendingMessages,
      processingMessages,
      deliveryUnknownMessages,
      failedMessages,
      expiredClaims,
      legacyPendingMessages,
      stalePendingMessages,
      activeRules: activeRuleRows.length,
      activeTemplates: activeTemplateRows.length,
      activeMarketingConsents,
      suppressedContacts,
      activeRuleDetails: activeRuleRows,
      activeTemplateDetails: activeTemplateRows,
      metaTemplateChecks,
      sendScopeMetaTemplateChecks,
      canonicalTemplateNames,
      canonicalTemplatesReady,
      canonicalMetaTemplateChecks,
    }
  } catch {
    return {
      ...flags,
      databaseReachable: false,
      preflightReady: false,
      readinessIssues: [{ code: 'database_unreachable', detail: 'database health query failed' }],
      sendScopeReady: false,
      sendScopeIssues: [{ code: 'database_unreachable', detail: 'database health query failed' }],
      sendScopeTemplates: env.AUTOMATION_ALLOWED_TEMPLATES,
      metaTemplateChecks: [],
      sendScopeMetaTemplateChecks: [],
      canonicalTemplateNames: canonicalWhatsappTemplates.map((template) => template.metaTemplateName),
      canonicalTemplatesReady: false,
      canonicalMetaTemplateChecks: canonicalWhatsappTemplates.map((template) => ({
        name: template.metaTemplateName,
        activeByDefault: template.active,
        error: 'database_unreachable',
      })),
    }
  }
}
