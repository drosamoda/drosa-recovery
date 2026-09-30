import { AutomationJobKey } from '@prisma/client'
import { logger } from '../config/logger'
import {
  startAutomationJobRun,
  finishAutomationJobRun,
  failAutomationJobRun,
  classifyJobError,
} from './automationJobRunService'

// Envolve um job com telemetria best-effort (start/finish/fail em AutomationJobRun).
// A telemetria NUNCA bloqueia nem mascara o resultado do job: se gravar falhar,
// registra só a categoria fechada (jamais error.message) e segue. O retorno ou a
// exceção do job são preservados exatamente como se o wrapper não existisse.
export async function withJobTelemetry<T extends object>(jobKey: AutomationJobKey, run: () => Promise<T>): Promise<T> {
  let runId: string | null = null
  try {
    runId = await startAutomationJobRun(jobKey)
  } catch (err) {
    logger.error('[jobs] telemetry start failed', { jobKey, category: classifyJobError(err) })
  }

  try {
    const result = await run()
    if (runId) {
      await finishAutomationJobRun(runId, result as Record<string, unknown>).catch((err) => {
        logger.error('[jobs] telemetry finish failed', { jobKey, category: classifyJobError(err) })
      })
    }
    return result
  } catch (error) {
    if (runId) {
      await failAutomationJobRun(runId, classifyJobError(error)).catch((err) => {
        logger.error('[jobs] telemetry fail-record failed', { jobKey, category: classifyJobError(err) })
      })
    }
    throw error
  }
}
