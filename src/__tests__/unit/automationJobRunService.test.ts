import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    automationJobRun: {
      create: mocks.create,
      update: mocks.update,
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
    },
  },
}))

import {
  startAutomationJobRun,
  finishAutomationJobRun,
  failAutomationJobRun,
  latestAutomationJobRuns,
  latestAutomationJobRunsSafe,
  computeJobFreshness,
  classifyJobError,
  AUTOMATION_JOB_KEYS,
} from '../../services/automationJobRunService'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('automationJobRunService', () => {
  it('starts a run with status=running and returns its id', async () => {
    mocks.create.mockResolvedValue({ id: 'run_1' })

    const id = await startAutomationJobRun('process_messages')

    expect(id).toBe('run_1')
    expect(mocks.create).toHaveBeenCalledWith({
      data: { jobKey: 'process_messages', status: 'running' },
      select: { id: true },
    })
  })

  it('finishes a run persisting only whitelisted primitive summary fields', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:05Z'))
    mocks.findUnique.mockResolvedValue({ startedAt: new Date('2026-09-28T12:00:00Z') })
    mocks.update.mockResolvedValue({})

    await finishAutomationJobRun('run_1', {
      found: 43,
      sent: 5,
      skipped: 30,
      errors: 0,
      blockedReason: 'automation_allowlist_required',
      // Anything that isn't a primitive number/boolean/closed-vocabulary
      // string must be dropped before it reaches the database.
      normalizedPhone: '5511999999999',
      payload: { to: '5511999999999' },
      nested: { anything: true },
    } as never)

    expect(mocks.update).toHaveBeenCalledTimes(1)
    const call = mocks.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'run_1' })
    expect(call.data.status).toBe('completed')
    expect(call.data.finishedAt).toEqual(new Date('2026-09-28T12:00:05Z'))
    expect(call.data.durationMs).toBe(5000)
    expect(call.data.summary).toEqual({
      found: 43,
      sent: 5,
      skipped: 30,
      errors: 0,
      blockedReason: 'automation_allowlist_required',
    })
    expect(JSON.stringify(call.data)).not.toMatch(/5511999999999|normalizedPhone|payload/i)
  })

  it('fails a run with a closed error category, never the raw exception text', async () => {
    mocks.findUnique.mockResolvedValue({ startedAt: new Date('2026-09-28T11:59:00Z') })
    mocks.update.mockResolvedValue({})

    await failAutomationJobRun('run_2', 'database_unreachable')

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'run_2' },
      data: expect.objectContaining({
        status: 'failed',
        errorCategory: 'database_unreachable',
      }),
    })
  })

  it('classifies unknown errors into a closed category set without leaking message text', () => {
    const dbErr = { code: 'P1001', message: "Can't reach database server at secret-host:5432" }
    const timeoutErr = { code: 'ETIMEDOUT', message: 'timeout of 8000ms exceeded' }
    const rateLimited = { response: { status: 429 }, message: 'Request failed with status code 429' }
    const random = new Error('some raw text with a phone 5511999999999')

    expect(classifyJobError(dbErr)).toBe('database_unreachable')
    expect(classifyJobError(timeoutErr)).toBe('upstream_timeout')
    expect(classifyJobError(rateLimited)).toBe('upstream_rate_limited')
    expect(classifyJobError(random)).toBe('unexpected_error')
  })

  it('returns the latest run per closed job key, defaulting missing keys to null', async () => {
    mocks.findFirst.mockImplementation((args: { where: { jobKey: string } }) =>
      Promise.resolve(
        args.where.jobKey === 'process_messages'
          ? { jobKey: 'process_messages', status: 'completed', startedAt: new Date('2026-09-28T12:00:00Z'), finishedAt: new Date('2026-09-28T12:00:05Z'), durationMs: 5000, summary: { sent: 1 }, errorCategory: null }
          : null,
      ),
    )

    const result = await latestAutomationJobRuns()

    expect(Object.keys(result).sort()).toEqual([...AUTOMATION_JOB_KEYS].sort())
    expect(result.process_messages).toMatchObject({ status: 'completed', durationMs: 5000 })
    expect(result.sync_abandoned_checkouts).toBeNull()
    expect(result.email_campaigns).toBeNull()
    // uma consulta indexada por job, nunca a tabela inteira
    expect(mocks.findFirst).toHaveBeenCalledTimes(AUTOMATION_JOB_KEYS.length)
  })

  it('latestAutomationJobRunsSafe devolve null (sem lançar) quando a tabela não existe', async () => {
    mocks.findFirst.mockRejectedValue(new Error('relation does not exist'))
    await expect(latestAutomationJobRunsSafe()).resolves.toBeNull()
  })

  it('computeJobFreshness separa timing de lastResult: fresh + failed não é healthy', () => {
    const now = new Date('2026-09-28T12:00:00Z')
    const base = { finishedAt: null, durationMs: null, summary: null }
    const runs = {
      process_messages: { ...base, status: 'failed', startedAt: new Date('2026-09-28T11:59:00Z'), errorCategory: 'upstream_timeout' },
      sync_abandoned_checkouts: { ...base, status: 'completed', startedAt: new Date('2026-09-28T11:30:00Z'), errorCategory: null },
      sync_boleto_expiring: { ...base, status: 'completed', startedAt: new Date('2026-09-28T08:00:00Z'), errorCategory: null },
      remarketing: null,
      email_campaigns: null,
    } as never

    const byKey = Object.fromEntries(computeJobFreshness(runs, now).map((e) => [e.jobKey, e]))

    expect(byKey.process_messages).toMatchObject({ timing: 'fresh', lastResult: 'failed', healthy: false, errorCategory: 'upstream_timeout' })
    expect(byKey.sync_abandoned_checkouts).toMatchObject({ timing: 'fresh', lastResult: 'completed', healthy: true, errorCategory: null })
    expect(byKey.sync_boleto_expiring).toMatchObject({ timing: 'stale', lastResult: 'completed', healthy: false })
  })
})
