import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = {
  $executeRaw: vi.fn(),
  customer: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}

vi.mock('../../config/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    customer: { findFirst: vi.fn() },
    suppression: { findUnique: vi.fn() },
  },
}))

import { prisma } from '../../config/prisma'
import { customerService } from '../../services/customerService'

describe('customerService.upsertCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('coalesces concurrent upserts for the same phone and acquires a database transaction lock', async () => {
    const customer = {
      id: 'customer-1', name: 'Ana', email: 'ana@example.com', phone: '+55 31 99999-0000',
      normalizedPhone: '5531999990000', optOut: false, source: 'nuvemshop_abandoned_checkout',
    }
    tx.customer.findFirst.mockResolvedValue(null)
    tx.customer.create.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return customer
    })

    const input = {
      name: 'Ana', email: 'ana@example.com', phone: '+55 31 99999-0000',
      normalizedPhone: '5531999990000', source: 'nuvemshop_abandoned_checkout',
    }
    const [first, second] = await Promise.all([
      customerService.upsertCustomer(input),
      customerService.upsertCustomer(input),
    ])

    expect(first).toEqual(customer)
    expect(second).toEqual(customer)
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledTimes(1)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(tx.customer.create).toHaveBeenCalledTimes(1)
  })
})
