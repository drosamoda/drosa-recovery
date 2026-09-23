import { describe, expect, it, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { env } from '../../config/env'

// Aprovar/agendar/cancelar uma campanha é um ato administrativo — a IA nunca chama estas rotas,
// e até agora elas só exigiam o mesmo x-crm-read-secret das leituras. Este arquivo crava que o
// mesmo adminAuth já usado por /admin também guarda estas três rotas, sem tocar nas rotas de
// leitura nem nas de criar draft/selecionar estratégia (que continuam só com crmAuth).
const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('../../services/ai/campaignService', async () => {
  const actual = await vi.importActual<typeof import('../../services/ai/campaignService')>('../../services/ai/campaignService')
  return {
    ...actual,
    campaignService: { ...actual.campaignService, approve: mocks.approve, schedule: mocks.schedule, cancel: mocks.cancel },
  }
})

describe('adminAuth nas rotas administrativas de campanha', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('approve sem x-admin-secret: 401, campaignService.approve nunca chamado', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app)
      .post('/crm-api/ai/campaigns/draft_1/approve')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .send({ approvedBy: 'peter' })

    expect(res.status).toBe(401)
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('approve com x-admin-secret errado: 401, campaignService.approve nunca chamado', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app)
      .post('/crm-api/ai/campaigns/draft_1/approve')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .set('x-admin-secret', 'secret-errado')
      .send({ approvedBy: 'peter' })

    expect(res.status).toBe(401)
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('approve com x-admin-secret correto chega ao service (que decide o estado)', async () => {
    const { default: app } = await import('../../index')
    mocks.approve.mockResolvedValue({ id: 'draft_1', status: 'APPROVED' })

    const res = await request(app)
      .post('/crm-api/ai/campaigns/draft_1/approve')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .set('x-admin-secret', env.ADMIN_SECRET)
      .send({ approvedBy: 'peter' })

    expect(res.status).toBe(200)
    expect(mocks.approve).toHaveBeenCalledWith('draft_1', 'peter')
  })

  it('schedule sem x-admin-secret: 401, campaignService.schedule nunca chamado', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app)
      .post('/crm-api/ai/campaigns/draft_1/schedule')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .send({})

    expect(res.status).toBe(401)
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  it('schedule com x-admin-secret correto chega ao service (que decide o estado)', async () => {
    const { default: app } = await import('../../index')
    mocks.schedule.mockResolvedValue({ id: 'draft_1', status: 'SCHEDULED' })

    const res = await request(app)
      .post('/crm-api/ai/campaigns/draft_1/schedule')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .set('x-admin-secret', env.ADMIN_SECRET)
      .send({})

    expect(res.status).toBe(200)
    expect(mocks.schedule).toHaveBeenCalledWith('draft_1')
  })

  it('cancel sem x-admin-secret: 401, campaignService.cancel nunca chamado', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app)
      .post('/crm-api/ai/campaigns/draft_1/cancel')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .send({})

    expect(res.status).toBe(401)
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('cancel com x-admin-secret correto chega ao service', async () => {
    const { default: app } = await import('../../index')
    mocks.cancel.mockResolvedValue({ id: 'draft_1', status: 'CANCELLED' })

    const res = await request(app)
      .post('/crm-api/ai/campaigns/draft_1/cancel')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .set('x-admin-secret', env.ADMIN_SECRET)
      .send({})

    expect(res.status).toBe(200)
    expect(mocks.cancel).toHaveBeenCalledWith('draft_1')
  })

  it('rotas de leitura e de criar draft/selecionar estratégia continuam livres de adminAuth (só crmAuth)', async () => {
    const { default: app } = await import('../../index')

    const opportunities = await request(app).get('/crm-api/ai/opportunities').set('x-crm-read-secret', env.CRM_READ_SECRET)
    expect(opportunities.status).not.toBe(401)

    const create = await request(app).post('/crm-api/ai/campaigns').set('x-crm-read-secret', env.CRM_READ_SECRET).send({ opportunityId: 'x' })
    expect(create.status).not.toBe(401)

    const select = await request(app).post('/crm-api/ai/campaigns/draft_1/select').set('x-crm-read-secret', env.CRM_READ_SECRET).send({ strategyIndex: 0 })
    expect(select.status).not.toBe(401)
  })
})
