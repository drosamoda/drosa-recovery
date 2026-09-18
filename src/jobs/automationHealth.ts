import { env } from '../config/env'
import { prisma } from '../config/prisma'

export async function automationHealth() {
  const sendBlockReason =
    !env.AUTOMATION_SEND_ENABLED
      ? 'automation_send_disabled'
      : env.WHATSAPP_DRY_RUN
        ? 'whatsapp_dry_run'
        : env.AUTOMATION_ALLOWED_TEMPLATES.length === 0
          ? 'automation_allowlist_required'
          : null

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
    metaConfigured: Boolean(env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID && env.META_APP_SECRET && env.META_WABA_ID),
    nuvemshopConfigured: Boolean(env.NUVEMSHOP_ACCESS_TOKEN && env.NUVEMSHOP_STORE_ID),
  }
  try {
    const [pendingMessages, processingMessages, deliveryUnknownMessages, failedMessages, activeRules, activeTemplates] = await Promise.all([
      prisma.messageLog.count({ where: { status: 'pending' } }),
      prisma.messageLog.count({ where: { status: 'processing' } }),
      prisma.messageLog.count({ where: { status: 'unknown' } }),
      prisma.messageLog.count({ where: { status: 'failed' } }),
      prisma.automationRule.count({ where: { active: true } }),
      prisma.whatsappTemplate.count({ where: { active: true } }),
    ])
    return { ...flags, databaseReachable: true, pendingMessages, processingMessages, deliveryUnknownMessages, failedMessages, activeRules, activeTemplates }
  } catch {
    return { ...flags, databaseReachable: false }
  }
}
