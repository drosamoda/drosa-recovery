import { prisma } from '../config/prisma'
import { AutomationJobKey, AutomationJobStatus } from '@prisma/client'

// Conjunto fechado de jobs que o Cloud Scheduler (ou o cron interno) dispara.
// Manter a lista aqui — e não só no enum do Prisma — faz latestAutomationJobRuns
// devolver sempre uma entrada por job, mesmo antes da primeira execução.
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

// Vocabulário fechado de strings seguras para persistir. Qualquer outra string
// é descartada: o resultado de um job pode evoluir e nunca pode virar vetor de PII.
const SAFE_SUMMARY_STRING_VALUES = new Set([
  'automation_allowlist_required',
  'automation_send_disabled',
  'whatsapp_dry_run',
  'remarketing_disabled',
  'abandoned_cart_disabled',
  'database_unreachable',
])

// Chaves que nunca são persistidas, mesmo com valor primitivo.
const DENYLISTED_KEY_PATTERN = /phone|email|payload|header|secret|token|address|customer|name/i

export function sanitizeSummary(input: Record<string, unknown> | null | undefined): SafeJobSummary | null {
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
    // Objetos, arrays, null, undefined e string livre são descartados.
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

export async function finishAutomationJobRun(id: string, summary: Record<string, unknown>): Promise<void> {
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
    data: { status: 'failed', finishedAt, durationMs, errorCategory: category },
  })
}

// Mapeia qualquer erro capturado numa categoria fechada. NUNCA persistir nem
// logar `error.message`: pode conter host, token ou dado pessoal.
export function classifyJobError(error: unknown): JobErrorCategory {
  if (error && typeof error === 'object') {
    const err = error as { code?: unknown; response?: { status?: unknown } }
    if (err.code === 'P1001' || err.code === 'P1002' || err.code === 'P1017') return 'database_unreachable'
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'ESOCKETTIMEDOUT') return 'upstream_timeout'
    if (err.response?.status === 429) return 'upstream_rate_limited'
    if (err.response?.status === 400 || err.response?.status === 422) return 'validation_error'
  }
  return 'unexpected_error'
}

// Limiares = frequência do Scheduler com folga. Só os 3 jobs transacionais são
// avaliados; remarketing/email_campaigns aparecem em jobRuns sem limiar.
export const JOB_FRESHNESS_THRESHOLD_MINUTES: Partial<Record<AutomationJobKey, number>> = {
  process_messages: 3,
  sync_abandoned_checkouts: 45,
  sync_boleto_expiring: 120,
}

// DUAS dimensões independentes:
//  - timing: a última execução começou dentro do limiar? (fresh | stale | never_run)
//  - lastResult: como a última execução terminou? (completed | failed | running | null)
// `healthy` exige as duas: um job "fresh" cuja última execução falhou NÃO está em dia.
export type JobTiming = 'fresh' | 'stale' | 'never_run'
export type JobLastResult = 'completed' | 'failed' | 'running' | null

export type JobFreshnessEntry = {
  jobKey: AutomationJobKey
  timing: JobTiming
  lastResult: JobLastResult
  healthy: boolean
  lastStartedAt: string | null
  ageMinutes: number | null
  thresholdMinutes: number
  errorCategory: string | null
}

// Compartilhado por /jobs/automation-health e /crm-api/health para as duas
// superfícies concordarem sobre o que é "em dia".
export function computeJobFreshness(
  jobRuns: Record<AutomationJobKey, SafeJobRun | null>,
  now: Date = new Date(),
): JobFreshnessEntry[] {
  return (Object.entries(JOB_FRESHNESS_THRESHOLD_MINUTES) as [AutomationJobKey, number][]).map(
    ([jobKey, thresholdMinutes]) => {
      const run = jobRuns[jobKey]
      if (!run) {
        return { jobKey, timing: 'never_run', lastResult: null, healthy: false, lastStartedAt: null, ageMinutes: null, thresholdMinutes, errorCategory: null }
      }
      const ageMinutes = (now.getTime() - run.startedAt.getTime()) / 60_000
      const timing: JobTiming = ageMinutes <= thresholdMinutes ? 'fresh' : 'stale'
      return {
        jobKey,
        timing,
        lastResult: run.status,
        healthy: timing === 'fresh' && run.status !== 'failed',
        lastStartedAt: run.startedAt.toISOString(),
        ageMinutes: Math.round(ageMinutes * 10) / 10,
        thresholdMinutes,
        errorCategory: run.status === 'failed' ? run.errorCategory : null,
      }
    },
  )
}

// Uma consulta indexada por job (jobKey, startedAt): custo constante, sem
// carregar a tabela inteira como `distinct` faria.
export async function latestAutomationJobRuns(): Promise<Record<AutomationJobKey, SafeJobRun | null>> {
  const rows = await Promise.all(
    AUTOMATION_JOB_KEYS.map((jobKey) =>
      prisma.automationJobRun.findFirst({
        where: { jobKey },
        orderBy: { startedAt: 'desc' },
        select: { jobKey: true, status: true, startedAt: true, finishedAt: true, durationMs: true, summary: true, errorCategory: true },
      }),
    ),
  )

  const result = {} as Record<AutomationJobKey, SafeJobRun | null>
  AUTOMATION_JOB_KEYS.forEach((key, i) => {
    const row = rows[i]
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
  })
  return result
}

// Leitura tolerante: se a tabela ainda não existe (migration não aplicada) ou o
// banco falhar, devolve null em vez de derrubar Saúde/automation-health.
export async function latestAutomationJobRunsSafe(): Promise<Record<AutomationJobKey, SafeJobRun | null> | null> {
  try {
    return await latestAutomationJobRuns()
  } catch {
    return null
  }
}
