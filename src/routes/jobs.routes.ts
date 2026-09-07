import { Router, Request, Response } from 'express'
import { runSyncAbandonedCheckouts } from '../jobs/syncAbandonedCheckouts'
import { runProcessMessages } from '../jobs/processMessages'
import { runBackfillInboxContacts } from '../jobs/backfillInboxContacts'
import { runBackfillInboxTemplatePreviews } from '../jobs/backfillInboxTemplatePreviews'
import { runBackfillInboxSentMessages } from '../jobs/backfillInboxSentMessages'
import { runBackfillImportedApiSends } from '../jobs/backfillImportedApiSends'
import { runBackfillImportedWhatsAppSends } from '../jobs/backfillImportedWhatsAppSends'
import { runBackfillInboxRenderedTemplatePreviews } from '../jobs/backfillInboxRenderedTemplatePreviews'

const router = Router()

// POST /jobs/sync-abandoned-checkouts
router.post('/sync-abandoned-checkouts', async (_req: Request, res: Response) => {
  const result = await runSyncAbandonedCheckouts()
  res.json({
    found: result.found,
    eligible: result.scheduled,
    dryRun: 0,
    sent: 0,
    skipped: result.skipped,
    failed: result.errors,
    errors: result.errors,
    retryScheduled: 0,
    upserted: result.upserted,
    scheduled: result.scheduled,
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

// POST /jobs/backfill-imported-api-sends
router.post('/backfill-imported-api-sends', async (_req: Request, res: Response) => {
  const result = await runBackfillImportedApiSends()
  res.json(result)
})

// POST /jobs/backfill-imported-whatsapp-sends
router.post('/backfill-imported-whatsapp-sends', async (_req: Request, res: Response) => {
  const result = await runBackfillImportedWhatsAppSends()
  res.json(result)
})

// POST /jobs/backfill-inbox-rendered-template-previews
router.post('/backfill-inbox-rendered-template-previews', async (_req: Request, res: Response) => {
  const result = await runBackfillInboxRenderedTemplatePreviews()
  res.json(result)
})

export default router
