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
      .send({ opportunityId: 'opp_abandoned_cart_2026-09-17' })

    expect(res.status).toBe(500)
    expect(res.body.error).not.toMatch(/campaign_drafts|prisma|public\./i)
    expect(res.body.error).toBe('Erro inesperado ao processar a campanha')
  })
})
