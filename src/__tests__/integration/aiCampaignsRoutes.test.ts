import { describe, expect, it, vi, beforeEach } from 'vitest'
import request from 'supertest'

// Reproduzido ao vivo: sem a migration de campaign_drafts aplicada, o Prisma
// lança um erro cru ("table public.campaign_drafts does not exist") que o
// catch-all da rota devolvia direto no corpo JSON — vazando nome de
// tabela/schema para o cliente. Este teste crava que qualquer erro não
// mapeado (Prisma ou não) nunca chega ao cliente com sua mensagem original.
const mocks = vi.hoisted(() => ({
  createFromOpportunity: vi.fn(),
}))

vi.mock('../../services/ai/campaignService', async () => {
  const actual = await vi.importActual<typeof import('../../services/ai/campaignService')>('../../services/ai/campaignService')
  return {
    ...actual,
    campaignService: { ...actual.campaignService, createFromOpportunity: mocks.createFromOpportunity },
  }
})

process.env.CRM_READ_SECRET = process.env.CRM_READ_SECRET || 'test_secret'

describe('POST /crm-api/ai/campaigns — erro inesperado nunca vaza detalhe interno', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('erro genérico (ex.: Prisma sem tabela) vira 500 com mensagem genérica, nunca a mensagem original', async () => {
    const { default: app } = await import('../../index')
    mocks.createFromOpportunity.mockRejectedValue(
      new Error('\nInvalid `prisma.campaignDraft.create()` invocation:\n\n\nThe table `public.campaign_drafts` does not exist in the current database.')
    )

    const res = await request(app)
      .post('/crm-api/ai/campaigns')
      .set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
      .send({ opportunityId: 'opp_abandoned_cart_2026-09-17', idempotencyKey: 'test-key-00000001' })

    expect(res.status).toBe(500)
    expect(res.body.error).not.toMatch(/campaign_drafts|prisma|public\./i)
    expect(res.body.error).toBe('Erro inesperado ao processar a campanha')
  })
})

// D) backend sem idempotencyKey => 400 IDEMPOTENCY_KEY_REQUIRED (Activation
// Wiring v2, seção 2) — nunca chega a chamar o service, muito menos a IA.
describe('POST /crm-api/ai/campaigns — idempotencyKey obrigatória', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('D) sem idempotencyKey no corpo: 400 IDEMPOTENCY_KEY_REQUIRED, createFromOpportunity nunca chamado', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app)
      .post('/crm-api/ai/campaigns')
      .set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
      .send({ opportunityId: 'opp_abandoned_cart_2026-09-17' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(mocks.createFromOpportunity).not.toHaveBeenCalled()
  })

  it('idempotencyKey vazia/só espaços: 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app)
      .post('/crm-api/ai/campaigns')
      .set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
      .send({ opportunityId: 'x', idempotencyKey: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(mocks.createFromOpportunity).not.toHaveBeenCalled()
  })

  it('idempotencyKey curta demais (< 8 caracteres): 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app)
      .post('/crm-api/ai/campaigns')
      .set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
      .send({ opportunityId: 'x', idempotencyKey: 'short' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(mocks.createFromOpportunity).not.toHaveBeenCalled()
  })

  it('idempotencyKey válida (ex.: UUID) chega ao service', async () => {
    const { default: app } = await import('../../index')
    mocks.createFromOpportunity.mockResolvedValue({ id: 'draft_1', status: 'DRAFT', strategies: null, complianceFindings: null })

    const res = await request(app)
      .post('/crm-api/ai/campaigns')
      .set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
      .send({ opportunityId: 'opp_x', idempotencyKey: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })

    expect(res.status).toBe(201)
    expect(mocks.createFromOpportunity).toHaveBeenCalledWith('opp_x', '3fa85f64-5717-4562-b3fc-2c963f66afa6')
  })
})

// H) AI_DATABASE_URL ausente => zero fallback para o prisma primário — cada
// rota de IA responde 503 AI_DATABASE_NOT_CONFIGURED. Nenhum mock de
// campaignService aqui: bate na implementação real (real getAiPrisma()),
// contra o ambiente de teste onde AI_DATABASE_URL nunca é definida
// (src/__tests__/setup.ts).
// I) GET /opportunities continua funcionando sem AI_DATABASE_URL (só banco
// primário read-only).
describe('Rotas de IA sem AI_DATABASE_URL configurada', () => {
  it('H) GET /crm-api/ai/campaigns => 503 AI_DATABASE_NOT_CONFIGURED', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app).get('/crm-api/ai/campaigns').set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('AI_DATABASE_NOT_CONFIGURED')
  })

  it('H) GET /crm-api/ai/campaigns/:id => 503 AI_DATABASE_NOT_CONFIGURED', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app).get('/crm-api/ai/campaigns/draft_1').set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('AI_DATABASE_NOT_CONFIGURED')
  })

  it('H) GET /crm-api/ai/learning => 503 AI_DATABASE_NOT_CONFIGURED', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app).get('/crm-api/ai/learning').set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('AI_DATABASE_NOT_CONFIGURED')
  })

  it('I) GET /crm-api/ai/opportunities NÃO depende de AI_DATABASE_URL — nunca 503 AI_DATABASE_NOT_CONFIGURED', async () => {
    const { default: app } = await import('../../index')
    const res = await request(app).get('/crm-api/ai/opportunities').set('x-crm-read-secret', process.env.CRM_READ_SECRET as string)
    expect(res.status).not.toBe(503)
  })
})
