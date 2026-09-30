import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { legacyBlockedTemplateNames } from '../config/recoveryCanonicalConfig'

// Aggregate, read-only snapshot of the pending WhatsApp queue. Never returns
// phone numbers, customer ids, payloads or any other row-level PII — only
// counts and template/source names, safe to log, print or expose over an
// authenticated ops endpoint.
export type PendingQueueAudit = {
  total: number
  stale: number
  ready: number
  byTemplate: Record<string, number>
  bySource: Record<string, number>
  oldestScheduledAt: string | null
  blockedLegacy: number
}

export async function auditPendingMessages(now: Date = new Date()): Promise<PendingQueueAudit> {
  // Same threshold and semantics processMessages uses to mark a message
  // `message_expired` (age = now - scheduledAt), so this audit reports the
  // exact same population the dispatcher would skip as stale.
  const staleThreshold = new Date(now.getTime() - env.AUTOMATION_MAX_MESSAGE_AGE_HOURS * 60 * 60 * 1000)

  const [total, stale, blockedLegacy, ready, oldest, byTemplateRows, bySourceRows] = await Promise.all([
    prisma.messageLog.count({ where: { status: 'pending' } }),
    prisma.messageLog.count({ where: { status: 'pending', scheduledAt: { lt: staleThreshold } } }),
    prisma.messageLog.count({
      where: { status: 'pending', templateName: { in: [...legacyBlockedTemplateNames] } },
    }),
    // "ready" mirrors processMessages' own candidate selection (due now,
    // no pending retry backoff) minus the stale population above.
    prisma.messageLog.count({
      where: {
        status: 'pending',
        scheduledAt: { lte: now, gte: staleThreshold },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
    }),
    prisma.messageLog.findFirst({
      where: { status: 'pending' },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    }),
    prisma.messageLog.groupBy({
      by: ['templateName'],
      where: { status: 'pending' },
      _count: { _all: true },
    }),
    prisma.messageLog.groupBy({
      by: ['source'],
      where: { status: 'pending' },
      _count: { _all: true },
    }),
  ])

  const byTemplate: Record<string, number> = {}
  for (const row of byTemplateRows) byTemplate[row.templateName] = row._count._all

  const bySource: Record<string, number> = {}
  for (const row of bySourceRows) bySource[row.source ?? 'unknown'] = row._count._all

  return {
    total,
    stale,
    ready,
    byTemplate,
    bySource,
    oldestScheduledAt: oldest?.scheduledAt ? oldest.scheduledAt.toISOString() : null,
    blockedLegacy,
  }
}

// CLI entrypoint — prints only the aggregate object, never row-level data.
if (require.main === module) {
  auditPendingMessages()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error('[auditPendingMessages] failed', error instanceof Error ? error.message : 'unknown_error')
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
