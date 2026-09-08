import { Router, Request, Response } from 'express'
import { runSyncAbandonedCheckouts } from '../jobs/syncAbandonedCheckouts'
import { runProcessMessages } from '../jobs/processMessages'
import { runBackfillInboxContacts } from '../jobs/backfillInboxContacts'
import { runBackfillInboxTemplatePreviews } from '../jobs/backfillInboxTemplatePreviews'
import { runBackfillInboxSentMessages } from '../jobs/backfillInboxSentMessages'
import { runBackfillImportedApiSends } from '../jobs/backfillImportedApiSends'
import { runBackfillImportedWhatsAppSends } from '../jobs/backfillImportedWhatsAppSends'
import { runBackfillInboxRenderedTemplatePreviews } from '../jobs/backfillInboxRenderedTemplatePreviews'
import { runAbandonedCheckoutsPreview } from '../jobs/previewAbandonedCheckouts'
import { automationHealth } from '../jobs/automationHealth'
import { retryInboxMirrors } from '../jobs/retryInboxMirrors'
import { remarketingPreview, remarketingSend, segmentNames, Segment } from '../services/remarketingService'

const router = Router()
router.post('/remarketing-preview', async (req: Request, res: Response) => {
  const segment = req.body?.segment ?? 'all'
  if (segment !== 'all' && !segmentNames.includes(segment)) {
    res.status(400).json({ error: 'invalid_segment' })
    return
  }
  res.json(await remarketingPreview(segment as Segment | 'all'))
})
router.post('/remarketing-send', async (req: Request, res: Response) => {
  const segment = req.body?.segment ?? 'all'
  if (segment !== 'all' && !segmentNames.includes(segment)) {
    res.status(400).json({ error: 'invalid_segment' })
    return
  }
  const response = await remarketingSend(segment as Segment | 'all')
  res.status(response.status).json(response.result)
})
router.get('/automation-health', async (_req: Request, res: Response) => {
  const result = await automationHealth()
  res.status(result.databaseReachable ? 200 : 503).json(result)
})
router.post('/retry-inbox-mirrors', async (_req: Request, res: Response) => {
  res.json(await retryInboxMirrors())
})

// Read-only preview. It never schedules, updates or sends messages.
router.post('/abandoned-checkouts-preview', async (_req: Request, res: Response) => {
  res.json(await runAbandonedCheckoutsPreview())
})

router.post('/abandoned-checkouts-preview/:checkoutId', async (req: Request, res: Response) => {
  const result = await runAbandonedCheckoutsPreview(req.params.checkoutId)
  if (result.found === 0) {
    res.status(404).json({ error: 'Checkout nao encontrado' })
    return
  }
  res.json(result)
})

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
