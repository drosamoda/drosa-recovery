import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  campaignDraftCreate: vi.fn(),
  campaignDraftUpdate: vi.fn(),
  campaignDraftFindUnique: vi.fn(),
  campaignDraftFindMany: vi.fn(),
  aiRunCreate: vi.fn(),
  getOpportunityById: vi.fn(),
  getAiProvider: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    campaignDraft: {
      create: mocks.campaignDraftCreate,
      update: mocks.campaignDraftUpdate,
      findUnique: mocks.campaignDraftFindUnique,
      findMany: mocks.campaignDraftFindMany,
    },
    aiRun: { create: mocks.aiRunCreate },
  },
}))

vi.mock('../../services/aiOpportunityEngine', () => ({
  getOpportunityById: mocks.getOpportunityById,
}))

vi.mock('../../services/ai/providerFactory', () => ({
  getAiProvider: mocks.getAiProvider,
}))

vi.mock('../../services/productTruthService', () => ({
  productTruthService: { verify: vi.fn().mockResolvedValue({ verified: false, product: null }) },
}))

import { campaignService, CampaignNotFoundError, InvalidCampaignStateError } from '../../services/ai/campaignService'
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

describe('campaignService — criação a partir de oportunidade real', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_1' })
    mocks.campaignDraftUpdate.mockImplementation(async (args) => ({ id: 'draft_1', ...args.data }))
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
          // Direções reais do playbook de RECENT_CUSTOMER (A/B/C), com texto
          // genuinamente distinto — evita colidir com o gate de Creative Distance.
          strategies: [
            { direction: 'A', name: 'Cross-sell', angle: 'Complemento da compra recente', audience: '8 elegíveis', productId: null, message: 'Oi! Notamos sua compra recente e temos um complemento que combina bem com ela.', cta: 'Ver complemento', creativeBrief: 'Foto do complemento em fundo neutro.', warnings: [] },
            { direction: 'B', name: 'Style guidance', angle: 'Como combinar o que já foi comprado', audience: '8 elegíveis', productId: null, message: 'Preparamos dicas de como aproveitar ao máximo sua última compra no dia a dia.', cta: 'Ver dicas', creativeBrief: 'Vídeo curto mostrando combinações.', warnings: [] },
            { direction: 'C', name: 'Novidades relacionadas', angle: 'Novidades da categoria', audience: '8 elegíveis', productId: null, message: 'Chegaram novidades na categoria que você comprou recentemente — quer dar uma olhada?', cta: 'Ver novidades', creativeBrief: 'Carrossel com as novidades da categoria.', warnings: [] },
          ],
        },
        rawOutputText: '{}',
      }),
    })
    const result = await campaignService.createFromOpportunity(opportunity.id)
    expect(result.status).toBe('AWAITING_HUMAN_APPROVAL')
    expect(result.status).not.toBe('APPROVED')
  })
})

describe('campaignService — approval gate (IA nunca aprova sozinha)', () => {
  beforeEach(() => { vi.clearAllMocks() })

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

describe('campaignService — envio real permanece desligado nesta fase', () => {
  it('schedule()/approve()/cancel() nunca chamam o whatsappService — dry-run garantido pela ausência estrutural de qualquer chamada de envio, não por uma flag que alguém possa esquecer ligada', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const text = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/campaignService.ts'), 'utf8')
    expect(text).not.toMatch(/whatsappService/)
    expect(text).not.toMatch(/sendTemplate|sendTextMessage/)
  })
})
