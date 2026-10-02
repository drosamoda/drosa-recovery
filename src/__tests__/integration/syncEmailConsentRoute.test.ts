import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const mocks = vi.hoisted(() => ({
  runEmailConsentSync: vi.fn(),
}))

vi.mock('../../jobs/syncEmailConsent', async () => {
  const actual = await vi.importActual<typeof import('../../jobs/syncEmailConsent')>('../../jobs/syncEmailConsent')
  return { ...actual, runEmailConsentSync: mocks.runEmailConsentSync }
})

import app from '../../index'

describe('POST /jobs/sync-email-consent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runEmailConsentSync.mockResolvedValue({
      customersFetched: 4443,
      pagesFetched: 23,
      expectedTotal: 4443,
      liveOptIn: 3243,
      liveOptOut: 1200,
      skippedNoEmail: 0,
      skippedInvalidEmail: 0,
      skippedUnknownPreference: 0,
      skippedInvalidUpdatedAt: 0,
      skippedInvalidCustomerId: 0,
      duplicateEmailRows: 1,
      signalsPrepared: 4443,
      uniqueHashes: 4442,
      eventsInserted: 4443,
      statesRecomputed: 4442,
      apiRequests: 23,
      retryableErrors: 0,
      rateLimitErrors: 0,
    })
  })

  it('permanece protegido por jobsAuth', async () => {
    const response = await request(app)
      .post('/jobs/sync-email-consent')
      .send({})

    expect(response.status).toBe(401)
    expect(mocks.runEmailConsentSync).not.toHaveBeenCalled()
  })

  it('retorna apenas contagens agregadas na execução autorizada', async () => {
    const response = await request(app)
      .post('/jobs/sync-email-consent')
      .set('x-jobs-secret', process.env.JOBS_SECRET!)
      .send({})

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      customersFetched: 4443,
      liveOptIn: 3243,
      liveOptOut: 1200,
      eventsInserted: 4443,
    })
    expect(JSON.stringify(response.body)).not.toContain('@')
    expect(response.body).not.toHaveProperty('emailHash')
    expect(response.body).not.toHaveProperty('customerId')
    expect(response.body).not.toHaveProperty('email')
    expect(response.body).not.toHaveProperty('phone')
    expect(response.body).not.toHaveProperty('cpf')
    expect(response.body).not.toHaveProperty('address')
    expect(mocks.runEmailConsentSync).toHaveBeenCalledTimes(1)
  })
})
