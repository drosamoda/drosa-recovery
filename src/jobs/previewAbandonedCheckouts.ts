import type { AbandonedCheckout } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../config/logger'
import {
  AbandonedCheckoutEligibility,
  evaluateAbandonedCheckoutEligibility,
} from '../services/abandonedCheckoutEligibilityService'

type PublicEligibilityReason = AbandonedCheckoutEligibility['reasons'][number] | 'evaluation_error'

type PublicEligibility = Omit<AbandonedCheckoutEligibility, 'normalizedPhone' | 'templateParameters' | 'renderedPreview' | 'reasons'> & {
  reasons: PublicEligibilityReason[]
  phone: string | null
  templateParameters: string[]
  renderedPreview: string | null
  error?: 'candidate_evaluation_failed'
}

type PreviewEvaluation =
  | { ok: true; value: AbandonedCheckoutEligibility }
  | { ok: false; checkout: AbandonedCheckout }

async function evaluateWithConcurrency(
  checkouts: AbandonedCheckout[],
  concurrency: number,
): Promise<PreviewEvaluation[]> {
  const results = new Array<PreviewEvaluation>(checkouts.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < checkouts.length) {
      const index = nextIndex++
      const checkout = checkouts[index]
      try {
        results[index] = { ok: true, value: await evaluateAbandonedCheckoutEligibility(checkout) }
      } catch (error) {
        const safeError = error as { code?: unknown; name?: unknown }
        logger.error('[previewAbandonedCheckouts] candidate evaluation failed', undefined, {
          checkoutId: checkout.id,
          errorCode: typeof safeError?.code === 'string' ? safeError.code : 'candidate_evaluation_failed',
          errorName: typeof safeError?.name === 'string' ? safeError.name : 'unknown_error',
        })
        results[index] = { ok: false, checkout }
      }
    }
  }

  const workerCount = Math.min(concurrency, checkouts.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null
  return `${phone.slice(0, 4)}*****${phone.slice(-2)}`
}

function sanitizeResult(result: AbandonedCheckoutEligibility): PublicEligibility {
  const safeParameters = result.templateParameters.map((value, index) => index === 0 ? `${value.slice(0, 1)}***` : '[link oculto]')
  let preview = result.renderedPreview
  if (preview) {
    for (const value of result.templateParameters) {
      if (value) preview = preview.split(value).join(value === result.templateParameters[0] ? `${value.slice(0, 1)}***` : '[link oculto]')
    }
  }
  return {
    eligible: result.eligible,
    reasons: result.reasons,
    warnings: result.warnings,
    checkoutId: result.checkoutId,
    phone: maskPhone(result.normalizedPhone),
    templateName: result.templateName,
    templateParameters: safeParameters,
    renderedPreview: preview,
  }
}

export async function runAbandonedCheckoutsPreview(checkoutId?: string) {
  const checkouts = await prisma.abandonedCheckout.findMany({
    where: checkoutId ? { id: checkoutId } : { status: 'abandoned' },
    orderBy: [{ sourceUpdatedAt: 'asc' }, { firstSeenAt: 'asc' }],
    take: checkoutId ? 1 : env.ABANDONED_CART_PREVIEW_LIMIT,
  })

  const outcomes = await evaluateWithConcurrency(checkouts, env.PREVIEW_CONCURRENCY)
  const evaluations = outcomes.filter((outcome): outcome is Extract<PreviewEvaluation, { ok: true }> => outcome.ok)
    .map((outcome) => outcome.value)
  const failures = outcomes.filter((outcome): outcome is Extract<PreviewEvaluation, { ok: false }> => !outcome.ok)
  const reasons: Record<string, number> = {}
  const warnings: Record<string, number> = {}
  for (const item of evaluations) {
    for (const reason of item.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1
    for (const warning of item.warnings) warnings[warning] = (warnings[warning] ?? 0) + 1
  }
  if (failures.length > 0) reasons.evaluation_error = failures.length

  const data: PublicEligibility[] = outcomes.map((outcome) => outcome.ok
    ? sanitizeResult(outcome.value)
    : {
      eligible: false,
      reasons: ['evaluation_error'],
      warnings: [],
      checkoutId: outcome.checkout.id,
      phone: maskPhone(outcome.checkout.normalizedPhone || null),
      templateName: env.ABANDONED_CART_TEMPLATE,
      templateParameters: [],
      renderedPreview: null,
      error: 'candidate_evaluation_failed',
    })

  return {
    dryRun: true,
    found: outcomes.length,
    eligible: evaluations.filter((item) => item.eligible).length,
    skipped: evaluations.filter((item) => !item.eligible).length,
    sent: 0,
    errors: failures.length,
    reasons,
    warnings,
    dataQuality: {
      missingPhone: reasons.missing_phone ?? 0,
      invalidPhone: reasons.invalid_phone ?? 0,
      missingRecoveryUrl: reasons.missing_recovery_url ?? 0,
      invalidRecoveryUrl: reasons.invalid_recovery_url ?? 0,
      uncertainTime: reasons.order_timing_uncertain ?? 0,
      invalidEncoding: reasons.invalid_encoding ?? 0,
    },
    data,
  }
}
