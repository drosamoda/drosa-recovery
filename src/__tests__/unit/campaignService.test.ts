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
import { AiProviderTimeoutError } from '../../services/ai/aiProvider'

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
      generateCampaignStrategies: vi.fn().mockRejectedValue(new AiProviderTimeoutError('timeout')),
    })

    await expect(campaignService.createFromOpportunity(opportunity.id)).rejects.toThrow(AiProviderTimeoutError)
    expect(mocks.aiRunCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'error' }) }))
    expect(mocks.campaignDraftUpdate).not.toHaveBeenCalled()
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
