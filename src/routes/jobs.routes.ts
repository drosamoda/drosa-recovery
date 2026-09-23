import { Router, Request, Response } from 'express'
import {
  runSyncAbandonedCheckoutById,
  runSyncAbandonedCheckouts,
} from '../jobs/syncAbandonedCheckouts'
import { runProcessMessages } from '../jobs/processMessages'
import { runBackfillInboxContacts } from '../jobs/backfillInboxContacts'
import { runBackfillInboxTemplatePreviews } from '../jobs/backfillInboxTemplatePreviews'
import { runBackfillInboxSentMessages } from '../jobs/backfillInboxSentMessages'
import { runBackfillImportedApiSends } from '../jobs/backfillImportedApiSends'
import { runBackfillImportedWhatsAppSends } from '../jobs/backfillImportedWhatsAppSends'
import { runBackfillInboxRenderedTemplatePreviews } from '../jobs/backfillInboxRenderedTemplatePreviews'
import { runBackfillNuvemshopOrders } from '../jobs/backfillNuvemshopOrders'
import { NuvemshopHistoryUnavailableError } from '../services/nuvemshopService'
import { runAbandonedCheckoutsPreview } from '../jobs/previewAbandonedCheckouts'
import { automationHealth } from '../jobs/automationHealth'
import { retryInboxMirrors } from '../jobs/retryInboxMirrors'
import { remarketingPreview, remarketingSend, segmentNames, Segment } from '../services/remarketingService'
import { runEmailCampaignExecutor } from '../services/emailCampaignExecutor'

type UpstreamErrorLike = {
  code?: unknown
  response?: {
    status?: unknown
  }
}

const NUVEMSHOP_NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  'ERR_NETWORK',
  'ERR_BAD_RESPONSE',
  'ERR_BAD_REQUEST',
])

function serializeNuvemshopBackfillError(error: unknown): {
  error: 'nuvemshop_orders_backfill_failed'
  upstreamStatus: number | null
  code?: string
} | null {
  if (!error || typeof error !== 'object') return null

  const candidate = error as UpstreamErrorLike
  const upstreamStatus = typeof candidate.response?.status === 'number'
    ? candidate.response.status
    : null
  const code = typeof candidate.code === 'string' && candidate.code
    ? candidate.code
    : null

  if (upstreamStatus === null && (!code || !NUVEMSHOP_NETWORK_ERROR_CODES.has(code))) {
    return null
  }

  return {
    error: 'nuvemshop_orders_backfill_failed',
    upstreamStatus,
    ...(code ? { code } : {}),
  }
}

function serializeNuvemshopHistoryUnavailable(error: unknown): {
  error: 'nuvemshop_orders_history_unavailable'
  upstreamStatus: 404
  oldestAvailableAt: string
} | null {
  if (!(error instanceof NuvemshopHistoryUnavailableError)) return null

  return {
    error: 'nuvemshop_orders_history_unavailable',
    upstreamStatus: error.upstreamStatus,
    oldestAvailableAt: error.oldestAvailableAt.toISOString(),
  }
}

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

// Targeted sync for one Nuvemshop checkout. It can schedule a pending message but never sends it.
router.post('/sync-abandoned-checkouts/:checkoutId', async (req: Request, res: Response) => {
  const result = await runSyncAbandonedCheckoutById(req.params.checkoutId)
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

// POST /jobs/process-email-campaigns
// O próprio executor mantém gates globais + recipient gate + cap de piloto.
router.post('/process-email-campaigns', async (_req: Request, res: Response) => {
  const result = await runEmailCampaignExecutor()
  res.status(result.blockedBy?.length ? 409 : 200).json(result)
})

// Backfill histórico somente de dados. Nunca agenda mensagens.
router.post('/backfill-nuvemshop-orders', async (req: Request, res: Response) => {
  const from = new Date(req.body?.from)
  const to = req.body?.to ? new Date(req.body.to) : new Date()
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    res.status(400).json({ error: 'invalid_backfill_period' })
    return
  }

  try {
    res.json(await runBackfillNuvemshopOrders({ from, to, scheduleMessages: false }))
  } catch (error) {
    const unavailableHistory = serializeNuvemshopHistoryUnavailable(error)
    if (unavailableHistory) {
      res.status(422).json(unavailableHistory)
      return
    }
    const serialized = serializeNuvemshopBackfillError(error)
    if (!serialized) throw error
    res.status(502).json(serialized)
  }
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
