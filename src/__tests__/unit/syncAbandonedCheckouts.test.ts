import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchAbandonedCheckouts: vi.fn(),
  fetchCheckoutById: vi.fn(),
  upsertAbandonedCheckout: vi.fn(),
  scheduleAbandonedCheckoutMessage: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../services/nuvemshopService', () => ({
  nuvemshopService: {
    fetchAbandonedCheckouts: mocks.fetchAbandonedCheckouts,
    fetchCheckoutById: mocks.fetchCheckoutById,
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

import {
  runSyncAbandonedCheckouts,
  runSyncAbandonedCheckoutById,
} from '../../jobs/syncAbandonedCheckouts'

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

  it('syncs and schedules exactly one checkout by Nuvemshop id', async () => {
    mocks.fetchCheckoutById.mockResolvedValue({
      id: '2067348677',
      contact_name: 'Cliente Teste',
      contact_phone: '31999999999',
      abandoned_checkout_url: 'https://www.drosamoda.com.br/checkout/test-token',
      created_at: '2026-09-10T22:51:16Z',
      updated_at: '2026-09-11T00:50:14Z',
    })
    mocks.upsertAbandonedCheckout.mockResolvedValue({
      id: 'checkout-db-1',
      status: 'abandoned',
    })
    mocks.scheduleAbandonedCheckoutMessage.mockResolvedValue(true)

    const result = await runSyncAbandonedCheckoutById('2067348677')

    expect(mocks.fetchCheckoutById).toHaveBeenCalledWith('2067348677')
    expect(mocks.fetchAbandonedCheckouts).not.toHaveBeenCalled()
    expect(mocks.upsertAbandonedCheckout).toHaveBeenCalledTimes(1)
    expect(mocks.scheduleAbandonedCheckoutMessage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      found: 1,
      upserted: 1,
      converted: 0,
      scheduled: 1,
      skipped: 0,
      errors: 0,
    })
  })
})
