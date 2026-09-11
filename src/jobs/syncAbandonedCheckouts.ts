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

const CHECKOUT_PROCESS_CONCURRENCY = 4

function emptySyncResult(): SyncResult {
  return {
    found: 0,
    upserted: 0,
    converted: 0,
    scheduled: 0,
    skipped: 0,
    errors: 0,
  }
}

function finalizeSkipped(result: SyncResult): void {
  result.skipped = result.upserted - result.converted - result.errors - result.scheduled
  if (result.skipped < 0) result.skipped = 0
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      await worker(items[index])
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
}

export async function runSyncAbandonedCheckoutById(
  checkoutId: string | number
): Promise<SyncResult> {
  const result = emptySyncResult()

  try {
    const payload = await nuvemshopService.fetchCheckoutById(checkoutId)
    result.found = 1

    const checkout = await abandonedCheckoutService.upsertAbandonedCheckout(payload)
    result.upserted = 1

    if (checkout.status === 'converted') {
      result.converted = 1
    } else {
      const scheduled = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)
      if (scheduled) result.scheduled = 1
    }
  } catch (err) {
    logger.error('[syncAbandonedCheckouts] erro no checkout individual', {
      checkoutId: String(checkoutId),
      error: err instanceof Error ? err.message : String(err),
    })
    result.errors = 1
  }

  finalizeSkipped(result)
  return result
}

export async function runSyncAbandonedCheckouts(): Promise<SyncResult> {
  const result = emptySyncResult()

  const checkouts = await nuvemshopService.fetchAbandonedCheckouts({
    lookbackHours: env.ABANDONED_CART_LOOKBACK_HOURS,
  })

  result.found = checkouts.length
  logger.info('[syncAbandonedCheckouts] carrinhos encontrados', { found: result.found })

  await forEachWithConcurrency(checkouts, CHECKOUT_PROCESS_CONCURRENCY, async (payload) => {
    try {
      const checkout = await abandonedCheckoutService.upsertAbandonedCheckout(payload)
      result.upserted++

      // Já convertido — pula agendamento
      if (checkout.status === 'converted') {
        result.converted++
        return
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
  })

  finalizeSkipped(result)

  logger.info('[syncAbandonedCheckouts] concluído', {
    upserted: result.upserted,
    converted: result.converted,
    scheduled: result.scheduled,
    skipped: result.skipped,
    errors: result.errors,
  })

  return result
}
