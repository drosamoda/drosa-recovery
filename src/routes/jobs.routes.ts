import { Router, Request, Response } from 'express'
import { runSyncAbandonedCheckouts } from '../jobs/syncAbandonedCheckouts'
import { runProcessMessages } from '../jobs/processMessages'

const router = Router()

// POST /jobs/sync-abandoned-checkouts
router.post('/sync-abandoned-checkouts', async (_req: Request, res: Response) => {
  const result = await runSyncAbandonedCheckouts()
  res.json({
    found: result.found,
    markedProcessing: result.upserted,
    sent: result.scheduled,
    skipped: result.skipped,
    failed: result.errors,
    retryScheduled: 0,
    detail: result,
  })
})

// POST /jobs/process-messages
router.post('/process-messages', async (_req: Request, res: Response) => {
  const result = await runProcessMessages()
  res.json(result)
})

export default router
