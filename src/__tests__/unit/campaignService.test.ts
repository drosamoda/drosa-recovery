import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  campaignDraftCreate: vi.fn(),
  campaignDraftUpdate: vi.fn(),
  campaignDraftFindUnique: vi.fn(),
  campaignDraftFindMany: vi.fn(),
  campaignDraftFindFirst: vi.fn(),
  aiRunCreate: vi.fn(),
  getOpportunityById: vi.fn(),
  getAiProvider: vi.fn(),
  enrichOpportunityEvidence: vi.fn(),
  assertAiDatabaseConfigured: vi.fn(),
  getAiPrisma: vi.fn(),
  verifyMetaTemplateContract: vi.fn(),
}))

// Final Pre-Activation Readiness: campaignService agora fala com
// campaign_drafts/ai_runs através de getAiPrisma() (config/aiPrisma.ts), não
// mais diretamente com config/prisma — por isso o mock mudou de alvo, mas as
// mesmas spies (campaignDraftCreate/campaignDraftUpdate/...) continuam sendo
// o que os testes inspecionam.
vi.mock('../../config/aiPrisma', () => {
  class AiDatabaseNotConfiguredError extends Error {}
  return {
    getAiPrisma: mocks.getAiPrisma,
    assertAiDatabaseConfigured: mocks.assertAiDatabaseConfigured,
    AiDatabaseNotConfiguredError,
  }
})

vi.mock('../../services/aiOpportunityEngine', () => ({
  getOpportunityById: mocks.getOpportunityById,
}))

vi.mock('../../services/ai/providerFactory', () => ({
  getAiProvider: mocks.getAiProvider,
}))

vi.mock('../../services/productTruthService', () => ({
  productTruthService: { verify: vi.fn().mockResolvedValue({ verified: false, product: null }) },
}))

vi.mock('../../services/campaignEvidenceService', () => ({
  enrichOpportunityEvidence: mocks.enrichOpportunityEvidence,
}))

// Só o necessário para assertTemplateApprovedForSend (usado por schedule()) —
// segmentContracts continua vindo do módulo real (é um objeto de dados puro,
// sem I/O), só a chamada de rede real é substituída.
vi.mock('../../services/templateContracts', () => ({
  verifyMetaTemplateContract: mocks.verifyMetaTemplateContract,
}))

import { campaignService, CampaignNotFoundError, InvalidCampaignStateError, CampaignTemplateNotApprovedError } from '../../services/ai/campaignService'
import { AiProviderConfigError, AiProviderTimeoutError } from '../../services/ai/aiProvider'
import { AiDatabaseNotConfiguredError } from '../../config/aiPrisma'

const opportunity = {
  id: 'opp_recent_customer_2026-09-15',
  type: 'RECENT_CUSTOMER' as const,
  title: '10 clientes recentes',
  reason: 'x',
  audienceCount: 10,
  eligibleCount: 8,
  blockedCount: 2,
  recommendedTiming: 'x',
  recommendedChannel: 'whatsapp' as const,
  recommendedProduct: null,
  confidence: 'medium' as const,
  evidence: { topBlockers: [], dataQuality: { historyTruncated: false, consentSourceConfigured: true, metaTemplatesVerified: true }, template: 'x' },
  generatedAt: new Date().toISOString(),
}

function emptyEvidence() {
  return {
    candidateProducts: [], purchasedProducts: [], cartProducts: [],
    evidenceFlags: {
      hasCandidateProducts: false, hasCategoryEvidence: false, hasStockEvidence: false,
      hasNewnessEvidence: false, hasPaymentExpiryEvidence: false, hasSecondCopySupport: false,
      hasPromotionEvidence: false, hasRecoveryUrlEvidence: false,
    },
    evidenceSources: [],
  }
}

function aiPrismaStub() {
  return {
    campaignDraft: {
      create: mocks.campaignDraftCreate,
      update: mocks.campaignDraftUpdate,
      findUnique: mocks.campaignDraftFindUnique,
      findMany: mocks.campaignDraftFindMany,
      findFirst: mocks.campaignDraftFindFirst,
    },
    aiRun: { create: mocks.aiRunCreate },
  }
}

describe('campaignService — criação a partir de oportunidade real', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertAiDatabaseConfigured.mockImplementation(() => {})
    mocks.getAiPrisma.mockReturnValue(aiPrismaStub())
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    mocks.campaignDraftUpdate.mockImplementation(async (args) => ({ id: 'draft_1', ...args.data }))
    mocks.campaignDraftFindFirst.mockResolvedValue(null)
    mocks.enrichOpportunityEvidence.mockResolvedValue(emptyEvidence())
  })

  // Final Pre-Activation Readiness (seção 3): sem AI_DATABASE_URL, geração
  // falha na primeira linha da função — antes até de buscar a oportunidade.
  it('AI_DATABASE_NOT_CONFIGURED: sem AI_DATABASE_URL, geração falha ANTES de qualquer coisa — zero writes, zero chamada paga ao provider', async () => {
    mocks.assertAiDatabaseConfigured.mockImplementation(() => { throw new AiDatabaseNotConfiguredError('AI_DATABASE_URL ausente') })

    await expect(campaignService.createFromOpportunity(opportunity.id)).rejects.toThrow(AiDatabaseNotConfiguredError)
    expect(mocks.getOpportunityById).not.toHaveBeenCalled()
    expect(mocks.getAiProvider).not.toHaveBeenCalled()
    expect(mocks.campaignDraftCreate).not.toHaveBeenCalled()
    expect(mocks.aiRunCreate).not.toHaveBeenCalled()
  })

  it('lança CampaignNotFoundError se a oportunidade não existe (não gera campanha do nada)', async () => {
    mocks.getOpportunityById.mockResolvedValue(null)
    await expect(campaignService.createFromOpportunity('opp_inexistente')).rejects.toThrow(CampaignNotFoundError)
    expect(mocks.campaignDraftCreate).not.toHaveBeenCalled()
  })

  it('registra AiRun com status=error e propaga o erro quando o provedor falha (timeout)', async () => {
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    mocks.getAiProvider.mockReturnValue({
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(),
      generateCampaignStrategies: vi.fn().mockRejectedValue(new AiProviderTimeoutError('timeout')),
    })

    await expect(campaignService.createFromOpportunity(opportunity.id)).rejects.toThrow(AiProviderTimeoutError)
    expect(mocks.aiRunCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'error' }) }))
    expect(mocks.campaignDraftUpdate).not.toHaveBeenCalled()
  })

  // Final Pre-Activation Readiness (seção 8): o erro persistido nunca pode
  // ecoar um segredo real configurado no ambiente, mesmo que a mensagem de
  // exceção original o contenha (ex.: um erro de auth do SDK ecoando a
  // própria chave, ou um erro de conexão citando a connection string).
  it('AI_ERROR_STORAGE_SANITIZED: erro salvo em aiRun nunca contém credenciais de connection string cruas', async () => {
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    mocks.getAiProvider.mockReturnValue({
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(),
      generateCampaignStrategies: vi.fn().mockRejectedValue(new Error('falha ao conectar em postgres://ai_user:s3nh4-secreta@db.internal:5432/ai')),
    })

    await expect(campaignService.createFromOpportunity(opportunity.id)).rejects.toThrow()
    const call = mocks.aiRunCreate.mock.calls[0][0]
    expect(call.data.errorMessage).not.toContain('s3nh4-secreta')
    expect(call.data.errorMessage).toContain('[REDACTED]')
  })

  it('provedor de IA não configurado (ex.: ANTHROPIC_API_KEY ausente) falha ANTES de qualquer escrita — zero campaignDraft, zero aiRun', async () => {
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    mocks.getAiProvider.mockReturnValue({
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(() => { throw new AiProviderConfigError('ANTHROPIC_API_KEY ausente') }),
      generateCampaignStrategies: vi.fn(),
    })

    await expect(campaignService.createFromOpportunity(opportunity.id)).rejects.toThrow(AiProviderConfigError)
    expect(mocks.campaignDraftCreate).not.toHaveBeenCalled()
    expect(mocks.aiRunCreate).not.toHaveBeenCalled()
  })

  it('a IA nunca avança um draft para APPROVED — mesmo com todas as estratégias liberadas e distintas, o melhor que createFromOpportunity() atinge é AWAITING_HUMAN_APPROVAL', async () => {
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    mocks.getAiProvider.mockReturnValue({
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(),
      generateCampaignStrategies: vi.fn().mockResolvedValue({
        output: {
          opportunityId: opportunity.id,
          summary: 'x',
          // Direções reais do playbook de RECENT_CUSTOMER (A/B/C) no estado
          // degradado — coerente com candidateProducts=[] (sempre o caso em
          // createFromOpportunity hoje) — com texto genuinamente distinto,
          // sem nenhuma claim implícita não comprovada (Truth Hardening).
          strategies: [
            { direction: 'A', name: 'Relacionamento pós-compra', angle: 'Relacionamento pós-compra', audience: '8 elegíveis', productId: null, message: 'Obrigado por comprar com a gente recentemente! Ficamos à disposição se precisar de qualquer coisa.', cta: 'Responder esta mensagem', creativeBrief: 'Mensagem de agradecimento em tom pessoal.', warnings: ['Direção A (cross-sell complementar) degradada: nenhum produto candidato real foi fornecido — a variação gerada foca em relacionamento pós-compra, sem afirmar um complemento específico.'] },
            { direction: 'B', name: 'Orientação de estilo geral', angle: 'Orientação de estilo geral', audience: '8 elegíveis', productId: null, message: 'Preparamos algumas dicas gerais de cuidado e estilo que podem ser úteis no dia a dia.', cta: 'Ver dicas', creativeBrief: 'Carrossel com dicas gerais, sem citar produto específico.', warnings: ['Direção B (style guidance) degradada: nenhum produto candidato real foi fornecido — a variação gerada oferece orientação geral, sem citar um item específico.'] },
            { direction: 'C', name: 'Convite para o catálogo', angle: 'Convite para conhecer o catálogo atual', audience: '8 elegíveis', productId: null, message: 'Enquanto isso, você pode dar uma olhada no que temos disponível no catálogo atual.', cta: 'Ver catálogo', creativeBrief: 'Grade geral do catálogo, sem recorte de categoria.', warnings: ['Direção C (novidades relacionadas) degradada: nenhuma evidência real de categoria está disponível — a variação gerada convida a conhecer o catálogo atual, sem afirmar relação com a compra anterior.'] },
          ],
        },
        rawOutputText: '{}',
      }),
    })
    const result = await campaignService.createFromOpportunity(opportunity.id)
    expect(result.status).toBe('AWAITING_HUMAN_APPROVAL')
    expect(result.status).not.toBe('APPROVED')
  })

  it('purchasedProducts e cartProducts chegam ao CampaignPromptInput, mas NUNCA viram candidateProducts automaticamente (Live Evidence Probe v1.1, seções 6-7)', async () => {
    const purchased = [{ productId: 'p1', name: 'Vestido comprado antes', price: 199, compareAtPrice: null, stockStatus: 'in_stock', colors: null, sizes: null, url: null }]
    const cart = [{ productId: 'p2', name: 'Item no carrinho', price: 99, compareAtPrice: null, stockStatus: 'unknown', colors: null, sizes: null, url: null }]
    mocks.enrichOpportunityEvidence.mockResolvedValue({
      candidateProducts: [], // nenhuma regra de cross-sell real promove purchased/cart a candidato
      purchasedProducts: purchased,
      cartProducts: cart,
      evidenceFlags: emptyEvidence().evidenceFlags,
      evidenceSources: [],
    })
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    const generateCampaignStrategies = vi.fn().mockRejectedValue(new Error('stop-after-capture'))
    mocks.getAiProvider.mockReturnValue({ name: 'anthropic', model: 'claude-test', assertConfigured: vi.fn(), generateCampaignStrategies })

    await expect(campaignService.createFromOpportunity(opportunity.id)).rejects.toThrow('stop-after-capture')

    const promptInput = generateCampaignStrategies.mock.calls[0][0]
    expect(promptInput.purchasedProducts).toEqual(purchased)
    expect(promptInput.cartProducts).toEqual(cart)
    expect(promptInput.candidateProducts).toEqual([])
  })
})

describe('campaignService — idempotência (Final Pre-Activation Readiness, seção 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertAiDatabaseConfigured.mockImplementation(() => {})
    mocks.getAiPrisma.mockReturnValue(aiPrismaStub())
    mocks.campaignDraftUpdate.mockImplementation(async (args) => ({ id: 'draft_1', ...args.data }))
    mocks.enrichOpportunityEvidence.mockResolvedValue(emptyEvidence())
    mocks.getOpportunityById.mockResolvedValue(opportunity)
  })

  function successfulProvider() {
    return {
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(),
      generateCampaignStrategies: vi.fn().mockResolvedValue({
        output: {
          opportunityId: opportunity.id,
          summary: 'x',
          strategies: [
            { direction: 'A', name: 'A', angle: 'a', audience: 'a', productId: null, message: 'Mensagem A real.', cta: 'x', creativeBrief: 'x', warnings: [] },
            { direction: 'B', name: 'B', angle: 'b', audience: 'b', productId: null, message: 'Mensagem B real.', cta: 'x', creativeBrief: 'x', warnings: [] },
            { direction: 'C', name: 'C', angle: 'c', audience: 'c', productId: null, message: 'Mensagem C real.', cta: 'x', creativeBrief: 'x', warnings: [] },
          ],
        },
        rawOutputText: '{}',
      }),
    }
  }

  it('mesmo idempotencyKey em duas chamadas (retry) => uma única chamada à IA — a segunda devolve o draft já criado', async () => {
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    const provider = successfulProvider()
    mocks.getAiProvider.mockReturnValue(provider)

    // 1ª chamada: nenhum draft com esta key ainda existe.
    mocks.campaignDraftFindFirst.mockResolvedValueOnce(null)
    const first = await campaignService.createFromOpportunity(opportunity.id, 'human-click-abc123')
    expect(provider.generateCampaignStrategies).toHaveBeenCalledTimes(1)

    // 2ª chamada (retry da MESMA ação humana, mesma key): agora já existe.
    mocks.campaignDraftFindFirst.mockResolvedValueOnce({ id: first.id, status: first.status, strategies: first.strategies, complianceFindings: first.complianceFindings })
    const second = await campaignService.createFromOpportunity(opportunity.id, 'human-click-abc123')

    expect(provider.generateCampaignStrategies).toHaveBeenCalledTimes(1)
    expect(second.id).toBe(first.id)
    expect(mocks.campaignDraftCreate).toHaveBeenCalledTimes(1)
  })

  it('DOUBLE_CLICK_SECOND_PROVIDER_CALL=NO — uma nova idempotencyKey (nova ação humana) SEMPRE gera uma nova chamada à IA', async () => {
    mocks.campaignDraftFindFirst.mockResolvedValue(null)
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    const provider = successfulProvider()
    mocks.getAiProvider.mockReturnValue(provider)

    await campaignService.createFromOpportunity(opportunity.id, 'click-1')
    await campaignService.createFromOpportunity(opportunity.id, 'click-2')

    expect(provider.generateCampaignStrategies).toHaveBeenCalledTimes(2)
  })

  it('sem idempotencyKey (chamador não enviou), nenhum check de duplicidade é feito — comportamento anterior preservado', async () => {
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    const provider = successfulProvider()
    mocks.getAiProvider.mockReturnValue(provider)

    await campaignService.createFromOpportunity(opportunity.id)
    expect(mocks.campaignDraftFindFirst).not.toHaveBeenCalled()
  })
})

describe('campaignService — approval gate (IA nunca aprova sozinha)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertAiDatabaseConfigured.mockImplementation(() => {})
    mocks.getAiPrisma.mockReturnValue(aiPrismaStub())
    mocks.verifyMetaTemplateContract.mockResolvedValue(null) // aprovado, por padrão, nos testes que não são sobre o gate de template
  })

  it('approve() falha se o draft não está em AWAITING_HUMAN_APPROVAL', async () => {
    mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_1', status: 'DRAFT' })
    await expect(campaignService.approve('draft_1', 'peter')).rejects.toThrow(InvalidCampaignStateError)
  })

  it('approve() falha se nenhuma estratégia foi selecionada, mesmo estando no status certo', async () => {
    mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_1', status: 'AWAITING_HUMAN_APPROVAL', selectedStrategy: null })
    await expect(campaignService.approve('draft_1', 'peter')).rejects.toThrow(InvalidCampaignStateError)
  })

  it('approve() funciona quando status e seleção estão corretos, e exige approvedBy (identifica o humano)', async () => {
    mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_1', status: 'AWAITING_HUMAN_APPROVAL', selectedStrategy: 0 })
    mocks.campaignDraftUpdate.mockResolvedValue({ id: 'draft_1', status: 'APPROVED', approvedBy: 'peter' })
    const result = await campaignService.approve('draft_1', 'peter')
    expect(result.status).toBe('APPROVED')
    expect(mocks.campaignDraftUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvedBy: 'peter' }) }))
  })

  it('schedule() exige status APPROVED — nunca agenda direto de DRAFT ou AWAITING_HUMAN_APPROVAL', async () => {
    mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_1', status: 'AWAITING_HUMAN_APPROVAL' })
    await expect(campaignService.schedule('draft_1')).rejects.toThrow(InvalidCampaignStateError)
  })

  it('selectStrategy() rejeita índice fora do intervalo das 3 estratégias', async () => {
    mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_1', status: 'AWAITING_HUMAN_APPROVAL', strategies: [{}, {}, {}] })
    await expect(campaignService.selectStrategy('draft_1', 5)).rejects.toThrow(InvalidCampaignStateError)
  })
})

describe('campaignService — TEMPLATE_EXECUTION_GATE (Final Pre-Activation Readiness, seção 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertAiDatabaseConfigured.mockImplementation(() => {})
    mocks.getAiPrisma.mockReturnValue(aiPrismaStub())
    mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_1', status: 'APPROVED', opportunityType: 'ABANDONED_CART' })
  })

  it('copy gerada pela IA NÃO implica template aprovado: schedule() fica fail-closed quando a Meta não confirma aprovação', async () => {
    mocks.verifyMetaTemplateContract.mockResolvedValue('template_contract_mismatch')
    await expect(campaignService.schedule('draft_1')).rejects.toThrow(CampaignTemplateNotApprovedError)
    expect(mocks.campaignDraftUpdate).not.toHaveBeenCalled()
  })

  it('schedule() avança para SCHEDULED só quando o template está com aprovação real confirmada', async () => {
    mocks.verifyMetaTemplateContract.mockResolvedValue(null)
    mocks.campaignDraftUpdate.mockResolvedValue({ id: 'draft_1', status: 'SCHEDULED' })
    const result = await campaignService.schedule('draft_1')
    expect(result.status).toBe('SCHEDULED')
  })
})

describe('campaignService — envio real permanece desligado nesta fase', () => {
  it('schedule()/approve()/cancel() nunca chamam o whatsappService — dry-run garantido pela ausência estrutural de qualquer chamada de envio, não por uma flag que alguém possa esquecer ligada', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const text = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/campaignService.ts'), 'utf8')
    expect(text).not.toMatch(/whatsappService/)
    expect(text).not.toMatch(/sendTemplate|sendTextMessage/)
  })
})
