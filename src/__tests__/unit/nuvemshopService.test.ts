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
    NUVEMSHOP_STORE_ID: '123456',
    NUVEMSHOP_ACCESS_TOKEN: 'test-access-token',
    NUVEMSHOP_USER_AGENT: 'DrosaRecovery Test',
    ABANDONED_CART_LOOKBACK_HOURS: 2,
    ABANDONED_CART_OVERLAP_HOURS: 72,
  },
}))

vi.mock('../../helpers/dateService', () => ({
  subtractHours: vi.fn(() => new Date('2026-09-08T00:00:00.000Z')),
}))

import { nuvemshopService } from '../../services/nuvemshopService'

describe('nuvemshopService authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.get.mockResolvedValue({
      data: {
        id: 123,
      },
    })

    mocks.create.mockReturnValue({
      get: mocks.get,
    })
  })

  it('uses the Nuvemshop Authorization Bearer header', async () => {
    await nuvemshopService.fetchOrderById('123')

    expect(mocks.create).toHaveBeenCalledTimes(1)

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-access-token',
        }),
      })
    )

    const axiosConfig = mocks.create.mock.calls[0][0]

    expect(axiosConfig.headers).not.toHaveProperty('Authentication')
  })

  it('retries a checkout page once after a transient timeout', async () => {
    const timeout = Object.assign(new Error('timeout of 15000ms exceeded'), {
      code: 'ECONNABORTED',
    })

    mocks.get
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ data: [] })

    const result = await nuvemshopService.fetchAbandonedCheckouts()

    expect(result).toEqual([])
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(mocks.get).toHaveBeenNthCalledWith(
      1,
      '/checkouts',
      expect.objectContaining({ params: { per_page: 200, page: 1 } })
    )
    expect(mocks.get).toHaveBeenNthCalledWith(
      2,
      '/checkouts',
      expect.objectContaining({ params: { per_page: 200, page: 1 } })
    )
  })

  it('enriches incomplete checkout details with bounded concurrency', async () => {
    let activeDetails = 0
    let maxActiveDetails = 0

    mocks.get.mockImplementation((url: string) => {
      if (url === '/checkouts') {
        return Promise.resolve({
          data: [
            { id: 1, created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z' },
            { id: 2, created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z' },
            { id: 3, created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z' },
          ],
        })
      }

      activeDetails++
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails)
      const id = Number(url.split('/').pop())

      return new Promise((resolve) => {
        setTimeout(() => {
          activeDetails--
          resolve({
            data: {
              id,
              contact_name: `Cliente ${id}`,
              contact_phone: '31999999999',
              abandoned_checkout_url: `https://www.drosamoda.com.br/checkout/${id}`,
            },
          })
        }, 10)
      })
    })

    const result = await nuvemshopService.fetchAbandonedCheckouts()

    expect(result).toHaveLength(3)
    expect(maxActiveDetails).toBeGreaterThan(1)
    expect(maxActiveDetails).toBeLessThanOrEqual(4)
  })
})
