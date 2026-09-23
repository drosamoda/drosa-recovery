import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  campaignDraftCreate: vi.fn(),
  campaignDraftUpdate: vi.fn(),
  campaignDraftFindUnique: vi.fn(),
  campaignDraftFindMany: vi.fn(),
  aiRunCreate: vi.fn(),
  getOpportunityById: vi.fn(),
  getAiProvider: vi.fn(),
  enrichOpportunityEvidence: vi.fn(),
  getAiPrisma: vi.fn(),
  verifyMetaTemplateContract: vi.fn(),
}))

// Activation Wiring v2: campaignService fala com campaign_drafts/ai_runs só
// através de getAiPrisma() (config/aiPrisma.ts) — nunca mais com
// config/prisma diretamente, e getAiPrisma() nunca tem um caminho de
// fallback (seção 5). Aqui mockamos o módulo inteiro; o comportamento real
// de "sem AI_DATABASE_URL, lança AiDatabaseNotConfiguredError" é testado à
// parte em aiPrisma.test.ts, contra a implementação real.
vi.mock('../../config/aiPrisma', () => {
  class AiDatabaseNotConfiguredError extends Error {}
  return {
    getAiPrisma: mocks.getAiPrisma,
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
    },
    aiRun: { create: mocks.aiRunCreate },
  }
}

function uniqueConstraintViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`idempotencyKey`)', { code: 'P2002', clientVersion: '5.14.0' })
}

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

describe('campaignService — criação a partir de oportunidade real', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAiPrisma.mockReturnValue(aiPrismaStub())
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    mocks.campaignDraftUpdate.mockImplementation(async (args) => ({ id: 'draft_1', ...args.data }))
    mocks.campaignDraftFindUnique.mockResolvedValue(null)
    mocks.enrichOpportunityEvidence.mockResolvedValue(emptyEvidence())
  })

  it('lança CampaignNotFoundError se a oportunidade não existe (não gera campanha do nada)', async () => {
    mocks.getOpportunityById.mockResolvedValue(null)
    await expect(campaignService.createFromOpportunity('opp_inexistente', 'key-1')).rejects.toThrow(CampaignNotFoundError)
    expect(mocks.campaignDraftCreate).not.toHaveBeenCalled()
  })

  it('registra AiRun com status=error (categoria AI_TIMEOUT) e propaga o erro quando o provedor falha (timeout)', async () => {
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    mocks.getAiProvider.mockReturnValue({
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(),
      generateCampaignStrategies: vi.fn().mockRejectedValue(new AiProviderTimeoutError('timeout')),
    })

    await expect(campaignService.createFromOpportunity(opportunity.id, 'key-1')).rejects.toThrow(AiProviderTimeoutError)
    expect(mocks.aiRunCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'error', errorMessage: 'AI_TIMEOUT' }) }))
    expect(mocks.campaignDraftUpdate).not.toHaveBeenCalled()
  })

  // K) Activation Wiring v2, seção 8: nunca a mensagem original — só uma
  // categoria fechada. Nem prompt, nem resposta, nem stack, nem segredo.
  it('K) AI_ERROR_STORAGE: erro salvo em aiRun é uma categoria fechada, nunca a mensagem/stack original', async () => {
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    mocks.getAiProvider.mockReturnValue({
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(),
      generateCampaignStrategies: vi.fn().mockRejectedValue(new Error('falha ao conectar em postgres://ai_user:s3nh4-secreta@db.internal:5432/ai — prompt bruto: "cliente João da Silva, telefone 5583988887777"')),
    })

    await expect(campaignService.createFromOpportunity(opportunity.id, 'key-1')).rejects.toThrow()
    const call = mocks.aiRunCreate.mock.calls[0][0]
    expect(call.data.errorMessage).toBe('AI_UNKNOWN_ERROR')
    expect(['AI_TIMEOUT', 'AI_RATE_LIMIT', 'AI_PROVIDER_ERROR', 'AI_SCHEMA_ERROR', 'AI_CONFIG_ERROR', 'AI_UNKNOWN_ERROR']).toContain(call.data.errorMessage)
  })

  it('provedor de IA não configurado (ex.: ANTHROPIC_API_KEY ausente) falha ANTES de qualquer escrita — zero campaignDraft, zero aiRun', async () => {
    mocks.getOpportunityById.mockResolvedValue(opportunity)
    mocks.getAiProvider.mockReturnValue({
      name: 'anthropic',
      model: 'claude-test',
      assertConfigured: vi.fn(() => { throw new AiProviderConfigError('ANTHROPIC_API_KEY ausente') }),
      generateCampaignStrategies: vi.fn(),
    })

    await expect(campaignService.createFromOpportunity(opportunity.id, 'key-1')).rejects.toThrow(AiProviderConfigError)
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
    const result = await campaignService.createFromOpportunity(opportunity.id, 'key-1')
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

    await expect(campaignService.createFromOpportunity(opportunity.id, 'key-1')).rejects.toThrow()

    const promptInput = generateCampaignStrategies.mock.calls[0][0]
    expect(promptInput.purchasedProducts).toEqual(purchased)
    expect(promptInput.cartProducts).toEqual(cart)
    expect(promptInput.candidateProducts).toEqual([])
  })
})

describe('campaignService — idempotência (Activation Wiring v2, seções 2-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAiPrisma.mockReturnValue(aiPrismaStub())
    mocks.campaignDraftUpdate.mockImplementation(async (args) => ({ id: 'draft_1', ...args.data }))
    mocks.enrichOpportunityEvidence.mockResolvedValue(emptyEvidence())
    mocks.getOpportunityById.mockResolvedValue(opportunity)
  })

  // E) mesma key sequencial => 1 provider call
  it('E) mesma idempotencyKey em duas chamadas sequenciais (retry) => uma única chamada à IA — a segunda devolve o draft já criado', async () => {
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    const provider = successfulProvider()
    mocks.getAiProvider.mockReturnValue(provider)

    // 1ª chamada: nenhum draft com esta key ainda existe.
    mocks.campaignDraftFindUnique.mockResolvedValueOnce(null)
    const first = await campaignService.createFromOpportunity(opportunity.id, 'human-click-abc123')
    expect(provider.generateCampaignStrategies).toHaveBeenCalledTimes(1)

    // 2ª chamada (retry da MESMA ação humana, mesma key): agora já existe.
    mocks.campaignDraftFindUnique.mockResolvedValueOnce({ id: first.id, status: first.status, strategies: first.strategies, complianceFindings: first.complianceFindings })
    const second = await campaignService.createFromOpportunity(opportunity.id, 'human-click-abc123')

    expect(provider.generateCampaignStrategies).toHaveBeenCalledTimes(1)
    expect(second.id).toBe(first.id)
    expect(mocks.campaignDraftCreate).toHaveBeenCalledTimes(1)
    expect(mocks.campaignDraftFindUnique).toHaveBeenCalledWith({ where: { idempotencyKey: 'human-click-abc123' } })
  })

  it('DOUBLE_CLICK_SECOND_PROVIDER_CALL=NO — uma nova idempotencyKey (nova ação humana) SEMPRE gera uma nova chamada à IA', async () => {
    mocks.campaignDraftFindUnique.mockResolvedValue(null)
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    const provider = successfulProvider()
    mocks.getAiProvider.mockReturnValue(provider)

    await campaignService.createFromOpportunity(opportunity.id, 'click-1')
    await campaignService.createFromOpportunity(opportunity.id, 'click-2')

    expect(provider.generateCampaignStrategies).toHaveBeenCalledTimes(2)
  })

  // F) P2002 concorrente => 1 geração/provider call
  it('F) duas requisições concorrentes com a MESMA key: a que perde a corrida do create() recebe P2002 e devolve o draft vencedor, sem chamar a IA', async () => {
    const provider = successfulProvider()
    mocks.getAiProvider.mockReturnValue(provider)

    // As duas passaram pelo findUnique ANTES de qualquer create() existir —
    // por isso as duas veem null (a corrida real acontece entre esse check
    // e o create(), não antes dele).
    mocks.campaignDraftFindUnique.mockResolvedValueOnce(null) // 1ª requisição: check inicial
    mocks.campaignDraftCreate.mockRejectedValueOnce(uniqueConstraintViolation()) // 1ª requisição: perde a corrida no create()
    mocks.campaignDraftFindUnique.mockResolvedValueOnce({ id: 'draft_winner', status: 'DRAFT', strategies: null, complianceFindings: null }) // 1ª requisição: busca o vencedor

    const loser = await campaignService.createFromOpportunity(opportunity.id, 'concurrent-key')

    expect(loser.id).toBe('draft_winner')
    expect(provider.generateCampaignStrategies).not.toHaveBeenCalled()
    expect(mocks.aiRunCreate).not.toHaveBeenCalled()
  })

  it('um erro de create() que NÃO é P2002 propaga normalmente (não é tratado como corrida de idempotência)', async () => {
    mocks.campaignDraftFindUnique.mockResolvedValue(null)
    mocks.campaignDraftCreate.mockRejectedValue(new Error('connection refused'))
    mocks.getAiProvider.mockReturnValue(successfulProvider())

    await expect(campaignService.createFromOpportunity(opportunity.id, 'key-1')).rejects.toThrow('connection refused')
  })

  // G) schema/migration têm UNIQUE idempotencyKey — prova contra o client
  // Prisma REAL gerado (DMMF), não só o texto do schema.prisma.
  it('G) o client Prisma gerado declara CampaignDraft.idempotencyKey como campo único', async () => {
    const { Prisma: RealPrisma } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client')
    const model = RealPrisma.dmmf.datamodel.models.find((m) => m.name === 'CampaignDraft')
    const field = model?.fields.find((f) => f.name === 'idempotencyKey')
    expect(field).toBeDefined()
    expect(field?.isUnique).toBe(true)
  })
})

describe('campaignService — approval gate (IA nunca aprova sozinha)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

describe('campaignService — TEMPLATE_EXECUTION_GATE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  // J) campaigns/learning/admin usam apenas aiPrisma — nenhum destes
  // arquivos importa config/prisma diretamente para tocar campaign_drafts/
  // ai_runs.
  it('J) campaignService.ts e learningService.ts nunca importam config/prisma — só config/aiPrisma', async () => {
    const fs = await import('fs')
    const path = await import('path')
    for (const file of ['src/services/ai/campaignService.ts', 'src/services/ai/learningService.ts']) {
      const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(text).not.toMatch(/from ['"](\.\.\/)*config\/prisma['"]/)
      expect(text).toMatch(/from ['"](\.\.\/)*config\/aiPrisma['"]/)
    }
  })
})
