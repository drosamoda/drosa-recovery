import { prisma } from '../config/prisma'
import { env } from '../config/env'
import {
  AbandonedCheckoutEligibility,
  evaluateAbandonedCheckoutEligibility,
} from '../services/abandonedCheckoutEligibilityService'

type PublicEligibility = Omit<AbandonedCheckoutEligibility, 'normalizedPhone' | 'templateParameters' | 'renderedPreview'> & {
  phone: string | null
  templateParameters: string[]
  renderedPreview: string | null
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

  const evaluations = await Promise.all(checkouts.map((checkout) => evaluateAbandonedCheckoutEligibility(checkout)))
  const reasons: Record<string, number> = {}
  const warnings: Record<string, number> = {}
  for (const item of evaluations) {
    for (const reason of item.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1
    for (const warning of item.warnings) warnings[warning] = (warnings[warning] ?? 0) + 1
  }

  return {
    dryRun: true,
    found: evaluations.length,
    eligible: evaluations.filter((item) => item.eligible).length,
    skipped: evaluations.filter((item) => !item.eligible).length,
    sent: 0,
    errors: 0,
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
    data: evaluations.map(sanitizeResult),
  }
}
