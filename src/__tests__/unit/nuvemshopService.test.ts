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
const createdAtMax = new Date('2026-09-14T23:59:59.000Z')

function orders(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({ id: offset + index + 1 }))
}

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

  it('paginates order backfill with the requested source date bounds', async () => {
    const firstPage = orders(50)
    mocks.get
      .mockResolvedValueOnce({ data: firstPage })
      .mockResolvedValueOnce({ data: [{ id: 51 }] })

    const result = await nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })

    expect(result).toHaveLength(51)
    expect(mocks.get).toHaveBeenNthCalledWith(1, '/orders', {
      params: {
        per_page: 50,
        page: 1,
        created_at_min: createdAtMin.toISOString(),
        created_at_max: createdAtMax.toISOString(),
      },
      timeout: 30000,
    })
    expect(mocks.get).toHaveBeenNthCalledWith(2, '/orders', {
      params: {
        per_page: 50,
        page: 2,
        created_at_min: createdAtMin.toISOString(),
        created_at_max: createdAtMax.toISOString(),
      },
      timeout: 30000,
    })
  })

  it('stops at x-total-count when the final page is exactly full', async () => {
    mocks.get
      .mockResolvedValueOnce({
        data: orders(50),
        headers: {
          'x-total-count': '100',
          link: '<https://api.nuvemshop.com.br/v1/123456/orders?page=2>; rel="next"',
        },
      })
      .mockResolvedValueOnce({
        data: orders(50, 50),
        headers: {
          'x-total-count': '100',
          link: '<https://api.nuvemshop.com.br/v1/123456/orders?page=1>; rel="prev"',
        },
      })

    const result = await nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })

    expect(result).toHaveLength(100)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('uses numeric x-total-count to stop pagination', async () => {
    mocks.get
      .mockResolvedValueOnce({
        data: orders(50),
        headers: { 'x-total-count': 75 },
      })
      .mockResolvedValueOnce({
        data: orders(25, 50),
        headers: { 'x-total-count': 75 },
      })

    const result = await nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })

    expect(result).toHaveLength(75)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('uses Link rel=next to continue and stops when Link has no next relation', async () => {
    mocks.get
      .mockResolvedValueOnce({
        data: orders(50),
        headers: {
          link: '<https://api.nuvemshop.com.br/v1/123456/orders?page=2>; rel="next"',
        },
      })
      .mockResolvedValueOnce({
        data: orders(50, 50),
        headers: {
          link: '<https://api.nuvemshop.com.br/v1/123456/orders?page=1>; rel="prev"',
        },
      })

    const result = await nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })

    expect(result).toHaveLength(100)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('ignores invalid x-total-count and falls back to the page size', async () => {
    mocks.get.mockResolvedValueOnce({
      data: orders(10),
      headers: { 'x-total-count': 'abc' },
    })

    const result = await nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })

    expect(result).toHaveLength(10)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('retries transient order page failures without duplicating orders', async () => {
    const timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
    mocks.get.mockRejectedValueOnce(timeout).mockResolvedValueOnce({ data: [{ id: 1 }] })

    const result = await nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })

    expect(result).toEqual([{ id: 1 }])
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it.each([429, 500])('retries transient HTTP %s order failures', async (status) => {
    const error = Object.assign(new Error(`HTTP ${status}`), { response: { status } })
    mocks.get.mockRejectedValueOnce(error).mockResolvedValueOnce({ data: [{ id: 1 }] })

    const result = await nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })

    expect(result).toEqual([{ id: 1 }])
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 404])('keeps permanent HTTP %s order API failures visible without retry', async (status) => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error(`HTTP ${status}`), {
      response: { status },
    }))

    await expect(nuvemshopService.fetchOrders({ createdAtMin, createdAtMax })).rejects.toThrow(`HTTP ${status}`)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })
})
