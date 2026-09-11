import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const mocks = vi.hoisted(() => ({
  runSyncAbandonedCheckoutById: vi.fn(),
  runSyncAbandonedCheckouts: vi.fn(),
}))

vi.mock('../../jobs/syncAbandonedCheckouts', () => ({
  runSyncAbandonedCheckouts: mocks.runSyncAbandonedCheckouts,
  runSyncAbandonedCheckoutById: mocks.runSyncAbandonedCheckoutById,
}))

import app from '../../index'

const JOBS_SECRET = process.env.JOBS_SECRET!

describe('POST /jobs/sync-abandoned-checkouts/:checkoutId', () => {
  it('requires jobs secret', async () => {
    const res = await request(app)
      .post('/jobs/sync-abandoned-checkouts/2067348677')

    expect(res.status).toBe(401)
    expect(mocks.runSyncAbandonedCheckoutById).not.toHaveBeenCalled()
  })

  it('syncs only the requested Nuvemshop checkout id', async () => {
    mocks.runSyncAbandonedCheckoutById.mockResolvedValue({
      found: 1,
      upserted: 1,
      converted: 0,
      scheduled: 1,
      skipped: 0,
      errors: 0,
    })

    const res = await request(app)
      .post('/jobs/sync-abandoned-checkouts/2067348677')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(200)
    expect(mocks.runSyncAbandonedCheckoutById).toHaveBeenCalledWith('2067348677')
    expect(mocks.runSyncAbandonedCheckouts).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({
      found: 1,
      upserted: 1,
      scheduled: 1,
      sent: 0,
      errors: 0,
    })
  })
})
