import { Router, Request, Response } from 'express'
import { runSyncAbandonedCheckouts } from '../jobs/syncAbandonedCheckouts'
import { runProcessMessages } from '../jobs/processMessages'
import { runBackfillInboxContacts } from '../jobs/backfillInboxContacts'
import { runBackfillInboxTemplatePreviews } from '../jobs/backfillInboxTemplatePreviews'
import { runBackfillInboxSentMessages } from '../jobs/backfillInboxSentMessages'

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

// POST /jobs/backfill-inbox-contacts
router.post('/backfill-inbox-contacts', async (_req: Request, res: Response) => {
  const result = await runBackfillInboxContacts()
  res.json(result)
})

// POST /jobs/backfill-inbox-template-previews
router.post('/backfill-inbox-template-previews', async (_req: Request, res: Response) => {
  const result = await runBackfillInboxTemplatePreviews()
  res.json(result)
})

// POST /jobs/backfill-inbox-sent-messages
router.post('/backfill-inbox-sent-messages', async (_req: Request, res: Response) => {
  const result = await runBackfillInboxSentMessages()
  res.json(result)
})

export default router
