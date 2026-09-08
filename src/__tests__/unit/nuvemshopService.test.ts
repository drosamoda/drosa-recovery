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
})
