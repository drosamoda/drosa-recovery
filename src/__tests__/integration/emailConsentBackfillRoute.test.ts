import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../jobs/backfillEmailConsent', () => ({ runBackfillEmailConsent: mocks.run }))

import app from '../../index'
import { env } from '../../config/env'

const JOBS_SECRET = process.env.JOBS_SECRET!
const result = {
  mode: 'DRY_RUN',
  incremental: { since: 'x', ordersSeen: 1, checkoutsSeen: 0, wouldCreateOptIn: 1, wouldCreateOptOut: 0, wouldCreateUnknown: 0, rowsWithoutSignal: 0, duplicates: 0, conflicts: 0 },
  preview: { byState: {}, eventsBySource: {}, skipped: {} },
  write: null,
}

describe('POST /jobs/backfill-email-consent-incremental', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    env.EMAIL_CONSENT_CONTINUOUS_INGESTION_ENABLED = false
    mocks.run.mockResolvedValue(result)
  })

  it('exige jobsAuth', async () => {
    expect((await request(app).post('/jobs/backfill-email-consent-incremental')).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('padrão = dry-run desde 24/09/2026, só agregados', async () => {
    const res = await request(app).post('/jobs/backfill-email-consent-incremental').set('x-jobs-secret', JOBS_SECRET)
    expect(res.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith({ dryRun: true, since: new Date('2026-09-24T00:00:00.000Z') })
    expect(res.body.incremental.ordersSeen).toBe(1)
  })

  it('escrita recusada (409) com a flag desligada, mesmo com dryRun:false', async () => {
    const res = await request(app).post('/jobs/backfill-email-consent-incremental').set('x-jobs-secret', JOBS_SECRET).send({ dryRun: false })
    expect(res.status).toBe(409)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('escrita só com dryRun:false E flag ligada', async () => {
    env.EMAIL_CONSENT_CONTINUOUS_INGESTION_ENABLED = true
    const res = await request(app).post('/jobs/backfill-email-consent-incremental').set('x-jobs-secret', JOBS_SECRET).send({ dryRun: false })
    expect(res.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }))
  })

  it('since inválido ou no futuro → 400', async () => {
    for (const since of ['nao-e-data', '2999-01-01']) {
      const res = await request(app).post('/jobs/backfill-email-consent-incremental').set('x-jobs-secret', JOBS_SECRET).send({ since })
      expect(res.status).toBe(400)
    }
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
