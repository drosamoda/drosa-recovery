import { prisma } from '../config/prisma'
import { AutomationJobKey, AutomationJobStatus } from '@prisma/client'

// Closed set of jobs Cloud Scheduler (or internal cron) can invoke. Keeping
// this list here — not just in the Prisma enum — lets latestAutomationJobRuns
// always return one entry per job, even before it has ever run.
export const AUTOMATION_JOB_KEYS = [
  'process_messages',
  'sync_abandoned_checkouts',
  'sync_boleto_expiring',
  'remarketing',
  'email_campaigns',
] as const satisfies readonly AutomationJobKey[]

export type SafeJobSummary = Record<string, number | boolean | string>

export type JobErrorCategory =
  | 'database_unreachable'
  | 'upstream_timeout'
  | 'upstream_rate_limited'
  | 'validation_error'
  | 'unexpected_error'

export type SafeJobRun = {
  status: AutomationJobStatus
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  summary: SafeJobSummary | null
  errorCategory: string | null
}

// A closed vocabulary of reason/status strings safe to persist. Any string
// value outside this set is dropped rather than trusted, since job results
// can be extended over time and must never become a PII leak vector.
const SAFE_SUMMARY_STRING_VALUES = new Set([
  'automation_allowlist_required',
  'automation_send_disabled',
  'whatsapp_dry_run',
  'remarketing_disabled',
  'abandoned_cart_disabled',
  'database_unreachable',
])

// Keys that must never be persisted even if their value happens to look
// primitive (e.g. a template name accidentally aliased as "phone").
const DENYLISTED_KEY_PATTERN = /phone|email|payload|header|secret|token|address|customer|name/i

function sanitizeSummary(input: Record<string, unknown> | null | undefined): SafeJobSummary | null {
  if (!input) return null

  const safe: SafeJobSummary = {}
  for (const [key, value] of Object.entries(input)) {
    if (DENYLISTED_KEY_PATTERN.test(key)) continue
    if (typeof value === 'number' && Number.isFinite(value)) {
      safe[key] = value
      continue
    }
    if (typeof value === 'boolean') {
      safe[key] = value
      continue
    }
    if (typeof value === 'string' && SAFE_SUMMARY_STRING_VALUES.has(value)) {
      safe[key] = value
      continue
    }
    // Objects, arrays, null, undefined and any free-form string are dropped.
  }
  return Object.keys(safe).length > 0 ? safe : null
}

export async function startAutomationJobRun(jobKey: AutomationJobKey): Promise<string> {
  const run = await prisma.automationJobRun.create({
    data: { jobKey, status: 'running' },
    select: { id: true },
  })
  return run.id
}

export async function finishAutomationJobRun(
  id: string,
  summary: Record<string, unknown>,
): Promise<void> {
  const finishedAt = new Date()
  const run = await prisma.automationJobRun.findUnique({ where: { id }, select: { startedAt: true } })
  const durationMs = run ? finishedAt.getTime() - run.startedAt.getTime() : null

  await prisma.automationJobRun.update({
    where: { id },
    data: {
      status: 'completed',
      finishedAt,
      durationMs,
      summary: sanitizeSummary(summary) ?? undefined,
      errorCategory: null,
    },
  })
}

export async function failAutomationJobRun(id: string, category: JobErrorCategory): Promise<void> {
  const finishedAt = new Date()
  const run = await prisma.automationJobRun.findUnique({ where: { id }, select: { startedAt: true } })
  const durationMs = run ? finishedAt.getTime() - run.startedAt.getTime() : null

  await prisma.automationJobRun.update({
    where: { id },
    data: {
      status: 'failed',
      finishedAt,
      durationMs,
      errorCategory: category,
    },
  })
}

// Maps an arbitrary caught error into a closed category. Never persist
// `error.message` itself — it can carry hostnames, tokens or other
// operational detail (see Review Focus #4).
export function classifyJobError(error: unknown): JobErrorCategory {
  if (error && typeof error === 'object') {
    const err = error as { code?: unknown; response?: { status?: unknown } }
    if (err.code === 'P1001' || err.code === 'P1002' || err.code === 'P1017') return 'database_unreachable'
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'ESOCKETTIMEDOUT') {
      return 'upstream_timeout'
    }
    if (err.response?.status === 429) return 'upstream_rate_limited'
    if (err.response?.status === 400 || err.response?.status === 422) return 'validation_error'
  }
  return 'unexpected_error'
}

// Scheduler frequencies (1/15/60 min) with a grace multiplier — a job is
// only "stale" once it's meaningfully overdue, not merely a few seconds
// past its own interval. Only the 3 transactional jobs are scored here;
// remarketing/email_campaigns still appear in jobRuns without a threshold.
export const JOB_FRESHNESS_THRESHOLD_MINUTES: Partial<Record<AutomationJobKey, number>> = {
  process_messages: 3,
  sync_abandoned_checkouts: 45,
  sync_boleto_expiring: 120,
}

export type JobFreshnessStatus = 'fresh' | 'stale' | 'never_run'

export type JobFreshnessEntry = {
  jobKey: AutomationJobKey
  status: JobFreshnessStatus
  lastRunStatus: AutomationJobStatus | null
  lastStartedAt: string | null
  ageMinutes: number | null
  thresholdMinutes: number
}

// Shared by /jobs/automation-health and /crm-api/health so both surfaces
// agree on what "stale" means for a transactional job.
export function computeJobFreshness(
  jobRuns: Record<AutomationJobKey, SafeJobRun | null>,
  now: Date = new Date(),
): JobFreshnessEntry[] {
  return (Object.entries(JOB_FRESHNESS_THRESHOLD_MINUTES) as [AutomationJobKey, number][]).map(
    ([jobKey, thresholdMinutes]) => {
      const run = jobRuns[jobKey]
      if (!run) {
        return { jobKey, status: 'never_run', lastRunStatus: null, lastStartedAt: null, ageMinutes: null, thresholdMinutes }
      }
      const ageMinutes = (now.getTime() - run.startedAt.getTime()) / 60_000
      return {
        jobKey,
        status: ageMinutes <= thresholdMinutes ? 'fresh' : 'stale',
        lastRunStatus: run.status,
        lastStartedAt: run.startedAt.toISOString(),
        ageMinutes: Math.round(ageMinutes * 10) / 10,
        thresholdMinutes,
      }
    },
  )
}

export async function latestAutomationJobRuns(): Promise<Record<AutomationJobKey, SafeJobRun | null>> {
  const rows = await prisma.automationJobRun.findMany({
    distinct: ['jobKey'],
    orderBy: [{ jobKey: 'asc' }, { startedAt: 'desc' }],
    select: {
      jobKey: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      durationMs: true,
      summary: true,
      errorCategory: true,
    },
  })

  const byKey = new Map(rows.map((row) => [row.jobKey, row]))
  const result = {} as Record<AutomationJobKey, SafeJobRun | null>
  for (const key of AUTOMATION_JOB_KEYS) {
    const row = byKey.get(key)
    result[key] = row
      ? {
          status: row.status,
          startedAt: row.startedAt,
          finishedAt: row.finishedAt,
          durationMs: row.durationMs,
          summary: (row.summary as SafeJobSummary | null) ?? null,
          errorCategory: row.errorCategory,
        }
      : null
  }
  return result
}
