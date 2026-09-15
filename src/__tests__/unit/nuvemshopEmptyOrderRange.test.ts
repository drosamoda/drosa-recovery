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

const createdAtMin = new Date('2026-05-06T00:00:00.000Z')
const createdAtMax = new Date('2026-05-13T00:00:00.000Z')

function emptyRange404() {
  return Object.assign(new Error('Request failed with status code 404'), {
    response: {
      status: 404,
      data: {
        message: 'Not Found',
        description: 'Last page is 0',
      },
    },
  })
}

describe('nuvemshopService unavailable historical order ranges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockReturnValue({ get: mocks.get })
  })

  it('keeps the exact page-1 404 visible when it cannot prove the history boundary', async () => {
    mocks.get
      .mockRejectedValueOnce(emptyRange404())
      .mockResolvedValueOnce({ data: [{ id: 1 }], headers: {} })

    await expect(nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })).rejects.toThrow(
      'Request failed with status code 404'
    )

    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('keeps a generic page-1 404 fail-closed', async () => {
    const generic404 = Object.assign(new Error('Request failed with status code 404'), {
      response: {
        status: 404,
        data: {
          message: 'Not Found',
          description: 'Order endpoint not found',
        },
      },
    })

    mocks.get.mockRejectedValueOnce(generic404)

    await expect(nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })).rejects.toThrow(
      'Request failed with status code 404'
    )
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('does not treat the exact Last page is 0 response as empty after page 1', async () => {
    mocks.get
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })),
        headers: {
          link: '<https://api.nuvemshop.com.br/v1/7716231/orders?page=2>; rel="next"',
        },
      })
      .mockRejectedValueOnce(emptyRange404())

    await expect(nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })).rejects.toThrow(
      'Request failed with status code 404'
    )
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })
})
