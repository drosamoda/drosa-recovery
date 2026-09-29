import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('../../services/automationJobRunService', async () => {
  const actual = await vi.importActual<typeof import('../../services/automationJobRunService')>('../../services/automationJobRunService')
  return { ...actual, startAutomationJobRun: mocks.start, finishAutomationJobRun: mocks.finish, failAutomationJobRun: mocks.fail }
})
vi.mock('../../config/logger', () => ({ logger: { error: mocks.logError, info: vi.fn(), warn: vi.fn() } }))

import { withJobTelemetry } from '../../services/jobTelemetry'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.start.mockResolvedValue('run_1')
  mocks.finish.mockResolvedValue(undefined)
  mocks.fail.mockResolvedValue(undefined)
})

describe('withJobTelemetry', () => {
  it('devolve o resultado do job intacto e registra o resumo', async () => {
    const result = await withJobTelemetry('process_messages', async () => ({ sent: 1, skipped: 2 }))
    expect(result).toEqual({ sent: 1, skipped: 2 })
    expect(mocks.finish).toHaveBeenCalledWith('run_1', { sent: 1, skipped: 2 })
  })

  it('propaga a exceção do job e grava só a categoria fechada', async () => {
    const boom = Object.assign(new Error('host secret-host tel 5511999999999'), { code: 'P1001' })
    await expect(withJobTelemetry('process_messages', async () => { throw boom })).rejects.toBe(boom)
    expect(mocks.fail).toHaveBeenCalledWith('run_1', 'database_unreachable')
  })

  it('falha de telemetria não bloqueia o job e o log nunca leva error.message', async () => {
    const leaky = Object.assign(new Error('password=hunter2 at secret-host'), { code: 'P1001' })
    mocks.start.mockRejectedValue(leaky)
    mocks.finish.mockRejectedValue(leaky)
    const result = await withJobTelemetry('sync_boleto_expiring', async () => ({ found: 0, scheduled: 0 }))
    expect(result).toEqual({ found: 0, scheduled: 0 })
    expect(mocks.finish).not.toHaveBeenCalled() // sem runId, não tenta finalizar
    const logged = JSON.stringify(mocks.logError.mock.calls)
    expect(logged).toContain('database_unreachable')
    expect(logged).not.toMatch(/hunter2|secret-host/)
  })

  it('falha ao gravar o finish também não muda o retorno nem vaza mensagem', async () => {
    mocks.finish.mockRejectedValue(new Error('token=abc'))
    const result = await withJobTelemetry('process_messages', async () => ({ sent: 0 }))
    expect(result).toEqual({ sent: 0 })
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toMatch(/token=abc/)
  })
})
