import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const mocks = vi.hoisted(() => ({
  runBackfillNuvemshopOrders: vi.fn(),
}))

vi.mock('../../jobs/backfillNuvemshopOrders', () => ({
  runBackfillNuvemshopOrders: mocks.runBackfillNuvemshopOrders,
}))

import app from '../../index'

describe('POST /jobs/backfill-nuvemshop-orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runBackfillNuvemshopOrders.mockResolvedValue({
      found: 0,
      created: 0,
      updated: 0,
      customersUpserted: 0,
      converted: 0,
      errors: 0,
      messagesScheduled: 0,
    })
  })

  it('returns JSON 400 for an invalid backfill period', async () => {
    const response = await request(app)
      .post('/jobs/backfill-nuvemshop-orders')
      .set('x-jobs-secret', process.env.JOBS_SECRET!)
      .send({ from: 'invalid-date', to: '2026-05-13T00:00:00Z' })

    expect(response.status).toBe(400)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toEqual({ error: 'invalid_backfill_period' })
    expect(mocks.runBackfillNuvemshopOrders).not.toHaveBeenCalled()
  })

  it('returns sanitized JSON 502 when Nuvemshop responds 404', async () => {
    mocks.runBackfillNuvemshopOrders.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 404'), {
      response: {
        status: 404,
        headers: { authorization: 'Bearer secret-token' },
        data: { token: 'secret-token' },
      },
      config: { headers: { Authorization: 'Bearer secret-token' } },
    }))

    const response = await request(app)
      .post('/jobs/backfill-nuvemshop-orders')
      .set('x-jobs-secret', process.env.JOBS_SECRET!)
      .send({ from: '2026-05-06T00:00:00Z', to: '2026-05-13T00:00:00Z' })

    expect(response.status).toBe(502)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toEqual({
      error: 'nuvemshop_orders_backfill_failed',
      upstreamStatus: 404,
    })
    expect(JSON.stringify(response.body)).not.toMatch(/secret-token|authorization|stack|config/i)
  })

  it('returns sanitized JSON 502 with null status for a timeout', async () => {
    mocks.runBackfillNuvemshopOrders.mockRejectedValueOnce(Object.assign(new Error('timeout'), {
      code: 'ECONNABORTED',
    }))

    const response = await request(app)
      .post('/jobs/backfill-nuvemshop-orders')
      .set('x-jobs-secret', process.env.JOBS_SECRET!)
      .send({ from: '2026-05-06T00:00:00Z', to: '2026-05-13T00:00:00Z' })

    expect(response.status).toBe(502)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.body).toEqual({
      error: 'nuvemshop_orders_backfill_failed',
      upstreamStatus: null,
      code: 'ECONNABORTED',
    })
  })

  it('keeps successful historical backfill data-only', async () => {
    mocks.runBackfillNuvemshopOrders.mockResolvedValueOnce({
      found: 100,
      created: 100,
      updated: 0,
      customersUpserted: 100,
      converted: 0,
      errors: 0,
      messagesScheduled: 0,
    })

    const response = await request(app)
      .post('/jobs/backfill-nuvemshop-orders')
      .set('x-jobs-secret', process.env.JOBS_SECRET!)
      .send({ from: '2026-05-06T00:00:00Z', to: '2026-05-13T00:00:00Z' })

    expect(response.status).toBe(200)
    expect(response.body.messagesScheduled).toBe(0)
    expect(mocks.runBackfillNuvemshopOrders).toHaveBeenCalledWith({
      from: new Date('2026-05-06T00:00:00Z'),
      to: new Date('2026-05-13T00:00:00Z'),
      scheduleMessages: false,
    })
  })
})
