import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('../../jobs/processMessagesDryRun', () => ({
  MAX_DRY_RUN_MESSAGE_IDS: 100,
  runProcessMessagesDryRun: mocks.run,
}))

import app from '../../index'

const JOBS_SECRET = process.env.JOBS_SECRET!

describe('POST /jobs/process-messages-dry-run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue({ dryRun: true, wouldReachSendStage: 0 })
  })

  it('exige jobsAuth (401 sem segredo e nada é simulado)', async () => {
    const res = await request(app).post('/jobs/process-messages-dry-run')
    expect(res.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('sem messageIds simula a fila inteira', async () => {
    const res = await request(app).post('/jobs/process-messages-dry-run').set('x-jobs-secret', JOBS_SECRET)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ dryRun: true, wouldReachSendStage: 0 })
    expect(mocks.run).toHaveBeenCalledWith()
  })

  it('messageIds válido é repassado; inválido → 400 sem simular', async () => {
    const ok = await request(app).post('/jobs/process-messages-dry-run').set('x-jobs-secret', JOBS_SECRET).send({ messageIds: ['a', 'b'] })
    expect(ok.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith({ messageIds: ['a', 'b'] })

    mocks.run.mockClear()
    for (const bad of [[], 'x', [1], Array.from({ length: 101 }, (_, i) => `id${i}`), ['a'.repeat(65)]]) {
      const res = await request(app).post('/jobs/process-messages-dry-run').set('x-jobs-secret', JOBS_SECRET).send({ messageIds: bad })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('MESSAGE_IDS_INVALID')
    }
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
