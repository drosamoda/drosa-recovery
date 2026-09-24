import type { CampaignStatus, Prisma } from '@prisma/client'
import { env } from '../config/env'
import { getAiPrisma } from '../config/aiPrisma'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import {
  EMAIL_SEGMENT_KEYS,
  type EmailSegmentKey,
  queryEmailRecipientsForSegment,
} from './emailAudienceEngine'
import { issueUnsubscribeHeaders, sendEmailThroughGate } from './emailDispatcher'
import { evaluateEmailRecipientGate, assertEmailSendAllowed, type EmailRecipientGateResult } from './emailSendGate'
import { getEmailProviderAdapter } from './emailProviderFactory'
import { hashEmail } from './emailConsentService'
import { refreshEmailConsentFromNuvemshop } from './emailLiveConsentService'
import {
  reserveEmailSend,
  type EmailSendReservation,
} from './emailTrackingService'
import {
  EmailProviderSendError,
  type EmailProviderAdapter,
  type EmailSendResult,
  type OutboundEmail,
} from './emailProviderAdapter'
import { isEmailStrategy, type EmailStrategy, type Strategy } from './ai/aiProvider'

export interface ExecutableEmailCampaignDraft {
  id: string
  status: CampaignStatus
  channel: 'EMAIL'
  audienceSnapshot: unknown
  selectedStrategy: number | null
  strategies: unknown
}

export interface ExecutorRecipient {
  email: string
  recentAbandonedCart: boolean
}

export interface EmailCampaignExecutorDeps {
  resolveRecipients: (segmentKey: EmailSegmentKey, now: Date) => Promise<ExecutorRecipient[]>
  refreshRecipientConsent: (email: string) => Promise<boolean>
  evaluateRecipient: (email: string) => Promise<EmailRecipientGateResult>
  hashRecipient: (email: string) => string
  reserveSend: (input: { emailHash: string; campaignKey: string; wave?: string }) => Promise<EmailSendReservation>
  dispatch: (message: OutboundEmail) => Promise<EmailSendResult>
  issueHeaders: (email: string, options: { sendId: string }) => Record<string, string>
  resolveCtaUrl: (recipient: ExecutorRecipient, segmentKey: EmailSegmentKey) => Promise<string | null>
  updateDraft: (id: string, data: { status: CampaignStatus; results: Prisma.InputJsonValue; completedAt?: Date | null }) => Promise<void>
  countCampaignSends: (campaignKey: string) => Promise<number>
}

export interface EmailCampaignRunOptions {
  batchSize: number
  maxTotalSends: number
  now?: Date
}

export interface EmailCampaignRunResult {
  draftId: string
  sent: number
  blocked: number
  failed: number
  alreadyProcessed: number
  missingCta: number
  hasMore: boolean
  needsRetry: boolean
  pilotCapReached: boolean
}

type EmailSnapshot = {
  channel: 'email'
  segmentKey: EmailSegmentKey
  campaignKey: string
}

function isSegmentKey(value: unknown): value is EmailSegmentKey {
  return typeof value === 'string' && (EMAIL_SEGMENT_KEYS as readonly string[]).includes(value)
}

function parseSnapshot(value: unknown): EmailSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('EMAIL_CAMPAIGN_SNAPSHOT_INVALID')
  }
  const candidate = value as Record<string, unknown>
  if (candidate.channel !== 'email' || !isSegmentKey(candidate.segmentKey) || typeof candidate.campaignKey !== 'string') {
    throw new Error('EMAIL_CAMPAIGN_SNAPSHOT_INVALID')
  }
  return {
    channel: 'email',
    segmentKey: candidate.segmentKey,
    campaignKey: candidate.campaignKey,
  }
}

function selectedEmailStrategy(draft: ExecutableEmailCampaignDraft): EmailStrategy {
  if (!Array.isArray(draft.strategies) || draft.selectedStrategy === null || draft.selectedStrategy === undefined) {
    throw new Error('EMAIL_CAMPAIGN_STRATEGY_MISSING')
  }
  const strategy = draft.strategies[draft.selectedStrategy] as Strategy | undefined
  if (!strategy || !isEmailStrategy(strategy)) throw new Error('EMAIL_CAMPAIGN_STRATEGY_INVALID')
  return strategy
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function renderEmailCampaignMessage(
  strategy: EmailStrategy,
  ctaUrl: string,
): { subject: string; html: string; text: string } {
  const href = safeHttpsUrl(ctaUrl)
  if (href === null) throw new Error('EMAIL_CAMPAIGN_CTA_URL_INVALID')

  const subject = strategy.subject.trim()
  const preheader = escapeHtml(strategy.preheader.trim())
  const headline = escapeHtml(strategy.headline.trim())
  const body = escapeHtml(strategy.body.trim()).replace(/\r?\n/g, '<br>')
  const cta = escapeHtml(strategy.cta.trim())
  const safeHref = escapeHtml(href)

  return {
    subject,
    html: `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f7f7f7;font-family:Arial,Helvetica,sans-serif;color:#222">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fff;border-radius:12px">
<tr><td style="padding:32px">
<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">${headline}</h1>
<p style="font-size:16px;line-height:1.6;margin:0 0 24px">${body}</p>
<p style="margin:0"><a href="${safeHref}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#111;color:#fff;text-decoration:none">${cta}</a></p>
</td></tr></table></td></tr></table></body></html>`,
    text: `${strategy.headline.trim()}\n\n${strategy.body.trim()}\n\n${strategy.cta.trim()}: ${href}`,
  }
}

function trackingCampaignKey(draftId: string): string {
  const normalized = draftId.replace(/[^A-Za-z0-9_-]/g, '_')
  return `draft_${normalized}`.slice(0, 60)
}

async function defaultResolveCtaUrl(recipient: ExecutorRecipient, segmentKey: EmailSegmentKey): Promise<string | null> {
  if (segmentKey !== 'RECENT_CART_ABANDONER') return safeHttpsUrl(env.EMAIL_DEFAULT_CTA_URL)

  const checkout = await prisma.abandonedCheckout.findFirst({
    where: {
      customerEmail: { equals: recipient.email, mode: 'insensitive' },
      status: 'abandoned',
      convertedAt: null,
    },
    orderBy: [{ abandonedAt: 'desc' }, { lastSeenAt: 'desc' }],
    select: { abandonedCheckoutUrl: true },
  })
  return checkout ? safeHttpsUrl(checkout.abandonedCheckoutUrl) : null
}

function defaultDeps(adapter: EmailProviderAdapter): EmailCampaignExecutorDeps {
  const aiPrisma = getAiPrisma()
  return {
    resolveRecipients: (segmentKey, now) => queryEmailRecipientsForSegment(segmentKey, now),
    refreshRecipientConsent: async (email) => (await refreshEmailConsentFromNuvemshop(email)).ok,
    evaluateRecipient: (email) => evaluateEmailRecipientGate(email),
    hashRecipient: (email) => hashEmail(email),
    reserveSend: (input) => reserveEmailSend(input),
    dispatch: (message) => sendEmailThroughGate(adapter, message),
    issueHeaders: (email, options) => issueUnsubscribeHeaders(email, options),
    resolveCtaUrl: defaultResolveCtaUrl,
    updateDraft: async (id, data) => {
      await aiPrisma.campaignDraft.update({
        where: { id },
        data: {
          status: data.status,
          results: data.results,
          ...(data.completedAt !== undefined ? { completedAt: data.completedAt } : {}),
        },
      })
    },
    // O cap conta toda reserva criada para o draft, inclusive FAILED/QUEUED:
    // o objetivo é limitar exposição/volume do piloto, não apenas entregas.
    countCampaignSends: (campaignKey) => prisma.emailSend.count({
      where: { campaignKey },
    }),
  }
}

function aggregateResult(
  base: Omit<EmailCampaignRunResult, 'draftId'>,
  snapshot: EmailSnapshot,
  processedThisRun: number,
): Prisma.InputJsonValue {
  return {
    version: 'email-campaign-executor-v1',
    segmentKey: snapshot.segmentKey,
    libraryCampaignKey: snapshot.campaignKey,
    sent: base.sent,
    blocked: base.blocked,
    failed: base.failed,
    alreadyProcessed: base.alreadyProcessed,
    missingCta: base.missingCta,
    hasMore: base.hasMore,
    needsRetry: base.needsRetry,
    pilotCapReached: base.pilotCapReached,
    processedThisRun,
    updatedAt: new Date().toISOString(),
  }
}

export async function processEmailCampaignDraft(
  draft: ExecutableEmailCampaignDraft,
  deps: EmailCampaignExecutorDeps,
  options: EmailCampaignRunOptions,
): Promise<EmailCampaignRunResult> {
  const snapshot = parseSnapshot(draft.audienceSnapshot)
  const strategy = selectedEmailStrategy(draft)
  const now = options.now ?? new Date()
  const campaignKey = trackingCampaignKey(draft.id)
  const alreadySentTotal = await deps.countCampaignSends(campaignKey)

  const state: Omit<EmailCampaignRunResult, 'draftId'> = {
    sent: 0,
    blocked: 0,
    failed: 0,
    alreadyProcessed: 0,
    missingCta: 0,
    hasMore: false,
    needsRetry: false,
    pilotCapReached: alreadySentTotal >= options.maxTotalSends,
  }

  if (state.pilotCapReached) {
    await deps.updateDraft(draft.id, { status: 'RUNNING', results: aggregateResult(state, snapshot, 0), completedAt: null })
    return { draftId: draft.id, ...state }
  }

  const recipients = await deps.resolveRecipients(snapshot.segmentKey, now)
  let processedThisRun = 0

  for (const recipient of recipients) {
    if (processedThisRun >= options.batchSize || alreadySentTotal + state.sent >= options.maxTotalSends) {
      state.hasMore = true
      state.pilotCapReached = alreadySentTotal + state.sent >= options.maxTotalSends
      break
    }

    // Revalida a preferência diretamente na Nuvemshop imediatamente
    // antes do gate local. Assim um opt-out recente não depende de snapshot
    // histórico nem de sincronização assíncrona. Qualquer erro/ausência bloqueia.
    const liveConsentOk = await deps.refreshRecipientConsent(recipient.email)
    if (!liveConsentOk) {
      state.blocked++
      continue
    }

    const decision = await deps.evaluateRecipient(recipient.email)
    if (!decision.allowed) {
      state.blocked++
      continue
    }

    const ctaUrl = await deps.resolveCtaUrl(recipient, snapshot.segmentKey)
    if (ctaUrl === null) {
      state.missingCta++
      continue
    }

    const reservation = await deps.reserveSend({
      emailHash: deps.hashRecipient(recipient.email),
      campaignKey,
      wave: '1',
    })

    if (reservation.status !== 'QUEUED') {
      state.alreadyProcessed++
      continue
    }

    const rendered = renderEmailCampaignMessage(strategy, ctaUrl)
    const message: OutboundEmail = {
      to: recipient.email,
      from: { address: env.EMAIL_FROM_ADDRESS, name: env.EMAIL_FROM_NAME },
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: deps.issueHeaders(recipient.email, { sendId: reservation.sendId }),
      tracking: { sendId: reservation.sendId, campaignKey },
    }

    processedThisRun++
    try {
      await deps.dispatch(message)
      state.sent++
    } catch (error) {
      state.failed++
      if (error instanceof EmailProviderSendError && error.retryable) state.needsRetry = true
      logger.error('[email/campaign] falha no envio', {
        draftId: draft.id,
        retryable: error instanceof EmailProviderSendError ? error.retryable : false,
        errorName: error instanceof Error ? error.name : 'unknown',
      })
    }
  }

  const status: CampaignStatus = state.hasMore || state.needsRetry || state.pilotCapReached ? 'RUNNING' : 'COMPLETED'
  await deps.updateDraft(draft.id, {
    status,
    results: aggregateResult(state, snapshot, processedThisRun),
    completedAt: status === 'COMPLETED' ? new Date() : null,
  })

  return { draftId: draft.id, ...state }
}

export interface RunEmailCampaignExecutorResult {
  enabled: boolean
  processedDrafts: number
  results: EmailCampaignRunResult[]
  blockedBy?: string[]
}

export async function runEmailCampaignExecutor(): Promise<RunEmailCampaignExecutorResult> {
  if (!env.EMAIL_CAMPAIGN_EXECUTOR_ENABLED) {
    return { enabled: false, processedDrafts: 0, results: [], blockedBy: ['EMAIL_CAMPAIGN_EXECUTOR_DISABLED'] }
  }

  const gate = (() => {
    try {
      assertEmailSendAllowed()
      return null
    } catch (error) {
      return error
    }
  })()
  if (gate !== null) {
    const missing = gate && typeof gate === 'object' && 'missing' in gate && Array.isArray((gate as { missing?: unknown }).missing)
      ? ((gate as { missing: string[] }).missing)
      : ['EMAIL_SEND_GATE_CLOSED']
    return { enabled: true, processedDrafts: 0, results: [], blockedBy: missing }
  }

  if (!env.EMAIL_FROM_ADDRESS) {
    return { enabled: true, processedDrafts: 0, results: [], blockedBy: ['EMAIL_FROM_ADDRESS_MISSING'] }
  }

  const adapter = getEmailProviderAdapter()
  if (adapter === null) {
    return { enabled: true, processedDrafts: 0, results: [], blockedBy: ['EMAIL_PROVIDER_NOT_CONFIGURED'] }
  }

  const aiPrisma = getAiPrisma()
  const candidates = await aiPrisma.campaignDraft.findMany({
    where: { channel: 'EMAIL', status: { in: ['SCHEDULED', 'RUNNING'] } },
    orderBy: { scheduledAt: 'asc' },
    take: env.EMAIL_CAMPAIGN_MAX_DRAFTS_PER_RUN,
  })

  const deps = defaultDeps(adapter)
  const results: EmailCampaignRunResult[] = []
  for (const candidate of candidates) {
    const claimed = candidate.status === 'RUNNING'
      ? true
      : (await aiPrisma.campaignDraft.updateMany({
          where: { id: candidate.id, status: 'SCHEDULED' },
          data: { status: 'RUNNING' },
        })).count === 1
    if (!claimed) continue

    results.push(await processEmailCampaignDraft(candidate as unknown as ExecutableEmailCampaignDraft, deps, {
      batchSize: env.EMAIL_CAMPAIGN_BATCH_SIZE,
      maxTotalSends: env.EMAIL_CAMPAIGN_MAX_TOTAL_SENDS,
    }))
  }

  return { enabled: true, processedDrafts: results.length, results }
}
