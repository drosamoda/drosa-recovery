import { env } from '../config/env'
import { prisma } from '../config/prisma'

export async function automationHealth() {
  const flags = {
    cronEnabled: env.ENABLE_INTERNAL_CRON,
    automationSendEnabled: env.AUTOMATION_SEND_ENABLED,
    whatsappDryRun: env.WHATSAPP_DRY_RUN,
    abandonedCartEnabled: env.ABANDONED_CART_ENABLED,
    remarketingEnabled: env.REMARKETING_ENABLED,
    metaConfigured: Boolean(env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID && env.META_APP_SECRET),
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
