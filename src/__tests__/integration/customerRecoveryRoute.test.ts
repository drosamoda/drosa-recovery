import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('../../jobs/processCustomerInitiatedRecovery', () => ({ runProcessCustomerInitiatedRecovery: mocks.run }))

import app from '../../index'

const JOBS_SECRET = process.env.JOBS_SECRET!

describe('POST /jobs/process-customer-recovery usa o jobsAuth atual', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue({ enabled: false })
  })

  it('401 sem credencial e o job não roda', async () => {
    const res = await request(app).post('/jobs/process-customer-recovery')
    expect(res.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('segredo inválido → 401; segredo válido → 200', async () => {
    expect((await request(app).post('/jobs/process-customer-recovery').set('x-jobs-secret', 'errado')).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
    const ok = await request(app).post('/jobs/process-customer-recovery').set('x-jobs-secret', JOBS_SECRET)
    expect(ok.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })
})
