import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findFirst: vi.fn(),
  groupBy: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    messageLog: {
      count: mocks.count,
      findFirst: mocks.findFirst,
      groupBy: mocks.groupBy,
    },
  },
}))

import { auditPendingMessages } from '../../ops/auditPendingMessages'

const originalMaxAge = env.AUTOMATION_MAX_MESSAGE_AGE_HOURS

beforeEach(() => {
  vi.clearAllMocks()
  env.AUTOMATION_MAX_MESSAGE_AGE_HOURS = 24
})

afterEach(() => {
  env.AUTOMATION_MAX_MESSAGE_AGE_HOURS = originalMaxAge
})

describe('auditPendingMessages', () => {
  it('returns zeroed aggregates for an empty queue', async () => {
    mocks.count.mockResolvedValue(0)
    mocks.findFirst.mockResolvedValue(null)
    mocks.groupBy.mockResolvedValue([])

    const result = await auditPendingMessages(new Date('2026-09-28T12:00:00Z'))

    expect(result).toEqual({
      total: 0,
      stale: 0,
      ready: 0,
      byTemplate: {},
      bySource: {},
      oldestScheduledAt: null,
      blockedLegacy: 0,
    })
  })

  it('classifies stale vs ready using AUTOMATION_MAX_MESSAGE_AGE_HOURS and aggregates by template/source', async () => {
    const now = new Date('2026-09-28T12:00:00Z')
    // total, stale, blockedLegacy, due(ready-pool) — order matches implementation's Promise.all
    mocks.count
      .mockResolvedValueOnce(43) // total
      .mockResolvedValueOnce(30) // stale
      .mockResolvedValueOnce(2) // blockedLegacy
      .mockResolvedValueOnce(10) // ready (due, not stale, retry ok)
    mocks.findFirst.mockResolvedValue({ scheduledAt: new Date('2026-09-23T02:00:00Z') })
    mocks.groupBy
      .mockResolvedValueOnce([
        { templateName: 'confirmacao_pedido_drosa', _count: { _all: 12 } },
        { templateName: '_pix_pendente', _count: { _all: 16 } },
      ])
      .mockResolvedValueOnce([
        { source: 'nuvemshop_webhook', _count: { _all: 43 } },
        { source: null, _count: { _all: 0 } },
      ])

    const result = await auditPendingMessages(now)

    expect(result.total).toBe(43)
    expect(result.stale).toBe(30)
    expect(result.ready).toBe(10)
    expect(result.blockedLegacy).toBe(2)
    expect(result.byTemplate).toEqual({ confirmacao_pedido_drosa: 12, _pix_pendente: 16 })
    expect(result.bySource).toEqual({ nuvemshop_webhook: 43, unknown: 0 })
    expect(result.oldestScheduledAt).toBe('2026-09-23T02:00:00.000Z')
  })

  it('never includes phone numbers, customer ids or payload fields in the result', async () => {
    mocks.count.mockResolvedValue(0)
    mocks.findFirst.mockResolvedValue(null)
    mocks.groupBy.mockResolvedValue([])

    const result = await auditPendingMessages()
    const keys = Object.keys(result)

    expect(keys).toEqual(['total', 'stale', 'ready', 'byTemplate', 'bySource', 'oldestScheduledAt', 'blockedLegacy'])
    expect(JSON.stringify(result)).not.toMatch(/normalizedPhone|customerId|payload|response/i)
  })

  it('computes the stale threshold from AUTOMATION_MAX_MESSAGE_AGE_HOURS', async () => {
    env.AUTOMATION_MAX_MESSAGE_AGE_HOURS = 6
    mocks.count.mockResolvedValue(0)
    mocks.findFirst.mockResolvedValue(null)
    mocks.groupBy.mockResolvedValue([])

    const now = new Date('2026-09-28T12:00:00Z')
    await auditPendingMessages(now)

    const staleCall = mocks.count.mock.calls[1][0]
    expect(staleCall.where.scheduledAt.lt.toISOString()).toBe('2026-09-28T06:00:00.000Z')
  })
})
