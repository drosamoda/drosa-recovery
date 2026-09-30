import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('../../config/prisma', () => ({
  prisma: {
    order: { findMany: vi.fn() },
    automationRule: { findFirst: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
    messageLog: { findFirst: vi.fn() },
    automationJobRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-mock-boleto' }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ startedAt: new Date(Date.now() - 1000) }),
    },
  },
}))

import app from '../../index'
import { prisma } from '../../config/prisma'

const JOBS_SECRET = process.env.JOBS_SECRET!

describe('POST /jobs/sync-boleto-expiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.automationJobRun.create).mockResolvedValue({ id: 'run-mock-boleto' } as never)
    vi.mocked(prisma.automationJobRun.update).mockResolvedValue({} as never)
    vi.mocked(prisma.automationJobRun.findUnique).mockResolvedValue({ startedAt: new Date(Date.now() - 1000) } as never)
  })

  it('retorna 401 sem jobs secret', async () => {
    const res = await request(app).post('/jobs/sync-boleto-expiring')
    expect(res.status).toBe(401)
    expect(prisma.order.findMany).not.toHaveBeenCalled()
  })

  it('requer jobsAuth e invoca runSyncBoletoExpiring, devolvendo found/scheduled', async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([])

    const res = await request(app)
      .post('/jobs/sync-boleto-expiring')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ found: 0, scheduled: 0 })
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1)
  })

  it('grava um AutomationJobRun completo (sync_boleto_expiring)', async () => {
    vi.mocked(prisma.order.findMany).mockResolvedValue([])

    const res = await request(app)
      .post('/jobs/sync-boleto-expiring')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(200)
    expect(prisma.automationJobRun.create).toHaveBeenCalledWith({
      data: { jobKey: 'sync_boleto_expiring', status: 'running' },
      select: { id: true },
    })
    expect(prisma.automationJobRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-mock-boleto' },
      data: expect.objectContaining({ status: 'completed', summary: { found: 0, scheduled: 0 } }),
    }))
  })

  it('grava failed com categoria fechada e propaga 500 quando o job explode', async () => {
    vi.mocked(prisma.order.findMany).mockRejectedValueOnce(new Error('db unreachable at secret-host'))

    const res = await request(app)
      .post('/jobs/sync-boleto-expiring')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(500)
    expect(prisma.automationJobRun.update).toHaveBeenCalledWith({
      where: { id: 'run-mock-boleto' },
      data: expect.objectContaining({ status: 'failed', errorCategory: 'unexpected_error' }),
    })
    const updateCall = vi.mocked(prisma.automationJobRun.update).mock.calls[0][0] as { data: Record<string, unknown> }
    expect(JSON.stringify(updateCall.data)).not.toMatch(/secret-host/i)
  })
})
