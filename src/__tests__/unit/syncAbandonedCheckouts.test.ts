import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchAbandonedCheckouts: vi.fn(),
  upsertAbandonedCheckout: vi.fn(),
  scheduleAbandonedCheckoutMessage: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../services/nuvemshopService', () => ({
  nuvemshopService: {
    fetchAbandonedCheckouts: mocks.fetchAbandonedCheckouts,
  },
}))

vi.mock('../../services/abandonedCheckoutService', () => ({
  abandonedCheckoutService: {
    upsertAbandonedCheckout: mocks.upsertAbandonedCheckout,
    scheduleAbandonedCheckoutMessage: mocks.scheduleAbandonedCheckoutMessage,
  },
}))

vi.mock('../../config/env', () => ({
  env: {
    ABANDONED_CART_LOOKBACK_HOURS: 2,
  },
}))

vi.mock('../../config/logger', () => ({
  logger: {
    info: mocks.info,
    error: mocks.error,
  },
}))

import { runSyncAbandonedCheckouts } from '../../jobs/syncAbandonedCheckouts'

describe('runSyncAbandonedCheckouts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('processes checkouts with bounded concurrency', async () => {
    mocks.fetchAbandonedCheckouts.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({ id: index + 1 }))
    )

    let active = 0
    let maxActive = 0

    mocks.upsertAbandonedCheckout.mockImplementation(async (payload: { id: number }) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      return {
        id: `db-${payload.id}`,
        status: 'abandoned',
      }
    })

    mocks.scheduleAbandonedCheckoutMessage.mockResolvedValue(false)

    const result = await runSyncAbandonedCheckouts()

    expect(result.found).toBe(6)
    expect(result.upserted).toBe(6)
    expect(maxActive).toBeGreaterThan(1)
    expect(maxActive).toBeLessThanOrEqual(4)
  })
})
