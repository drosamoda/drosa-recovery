import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: mocks.create,
  },
}))

vi.mock('../../config/env', () => ({
  env: {
    NUVEMSHOP_API_VERSION: 'v1',
    NUVEMSHOP_STORE_ID: '7716231',
    NUVEMSHOP_ACCESS_TOKEN: 'test-access-token',
    NUVEMSHOP_USER_AGENT: 'DrosaRecovery Test',
    ABANDONED_CART_LOOKBACK_HOURS: 2,
    ABANDONED_CART_OVERLAP_HOURS: 72,
  },
}))

vi.mock('../../config/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

vi.mock('../../helpers/dateService', () => ({
  subtractHours: vi.fn(() => new Date('2026-09-08T00:00:00.000Z')),
}))

import { nuvemshopService } from '../../services/nuvemshopService'

describe('nuvemshopService empty historical order ranges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockReturnValue({ get: mocks.get })
  })

  it('treats the exact Nuvemshop page-1 404 Last page is 0 response as an empty range', async () => {
    const emptyRange404 = Object.assign(new Error('Request failed with status code 404'), {
      response: {
        status: 404,
        data: {
          message: 'Not Found',
          description: 'Last page is 0',
        },
      },
    })

    mocks.get.mockRejectedValueOnce(emptyRange404)

    const result = await nuvemshopService.fetchOrders({
      createdAtMin: new Date('2026-05-06T00:00:00.000Z'),
      createdAtMax: new Date('2026-05-13T00:00:00.000Z'),
    })

    expect(result).toEqual([])
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })
})
