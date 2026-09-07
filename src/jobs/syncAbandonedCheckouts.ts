import { nuvemshopService } from '../services/nuvemshopService'
import { abandonedCheckoutService } from '../services/abandonedCheckoutService'
import { env } from '../config/env'
import { logger } from '../config/logger'

export type SyncResult = {
  found: number
  upserted: number
  converted: number
  scheduled: number
  skipped: number
  errors: number
}

export async function runSyncAbandonedCheckouts(): Promise<SyncResult> {
  const result: SyncResult = {
    found: 0,
    upserted: 0,
    converted: 0,
    scheduled: 0,
    skipped: 0,
    errors: 0,
  }

  const checkouts = await nuvemshopService.fetchAbandonedCheckouts({
    lookbackHours: env.ABANDONED_CART_LOOKBACK_HOURS,
  })

  result.found = checkouts.length
  logger.info('[syncAbandonedCheckouts] carrinhos encontrados', { found: result.found })

  for (const payload of checkouts) {
    try {
      const checkout = await abandonedCheckoutService.upsertAbandonedCheckout(payload)
      result.upserted++

      // Já convertido — pula agendamento
      if (checkout.status === 'converted') {
        result.converted++
        continue
      }

      const scheduled = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)
      if (scheduled) result.scheduled++
    } catch (err) {
      logger.error('[syncAbandonedCheckouts] erro no checkout', {
        checkoutId: payload.id,
        error: err instanceof Error ? err.message : String(err),
      })
      result.errors++
    }
  }

  result.skipped = result.upserted - result.converted - result.errors - result.scheduled
  if (result.skipped < 0) result.skipped = 0

  logger.info('[syncAbandonedCheckouts] concluído', {
    upserted: result.upserted,
    converted: result.converted,
    scheduled: result.scheduled,
    skipped: result.skipped,
    errors: result.errors,
  })

  return result
}
