import { createHash } from 'crypto'
import { prisma } from '../../config/prisma'
import { getOpportunityById, Opportunity } from '../aiOpportunityEngine'
import { productTruthService } from '../productTruthService'
import { getAiProvider } from './providerFactory'
import { PROMPT_VERSION } from './campaignPromptContract'
import { auditAllStrategies } from './complianceService'
import { CampaignPromptInput, Strategy } from './aiProvider'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class CampaignNotFoundError extends Error {}
export class InvalidCampaignStateError extends Error {}

function buildPromptInput(opportunity: Opportunity, candidateProducts: CampaignPromptInput['candidateProducts']): CampaignPromptInput {
  return {
    opportunityId: opportunity.id,
    opportunityType: opportunity.type,
    title: opportunity.title,
    reason: opportunity.reason,
    audienceCount: opportunity.audienceCount,
    eligibleCount: opportunity.eligibleCount,
    blockedCount: opportunity.blockedCount,
    recommendedTiming: opportunity.recommendedTiming,
    recommendedChannel: opportunity.recommendedChannel,
    confidence: opportunity.confidence,
    candidateProducts,
  }
}

export const campaignService = {
  // Gera um novo draft a partir de uma oportunidade real. Nunca chamado
  // automaticamente — sempre a partir de um clique humano em "Gerar campanha".
  async createFromOpportunity(opportunityId: string): Promise<{ id: string; status: string; strategies: Strategy[] | null; complianceFindings: unknown }> {
    const opportunity = await getOpportunityById(opportunityId)
    if (!opportunity) throw new CampaignNotFoundError(`Oportunidade não encontrada ou sem dados suficientes: ${opportunityId}`)

    // Falha rápido ANTES de qualquer escrita: se o provedor de IA não está
    // configurado (ex.: ANTHROPIC_API_KEY ausente), nenhum campaignDraft nem
    // aiRun é criado — evita rascunho órfão que nunca vai receber estratégias.
    const provider = getAiProvider()
    provider.assertConfigured()

    const draft = await prisma.campaignDraft.create({
      data: {
        opportunityId: opportunity.id,
        opportunityType: opportunity.type,
        opportunityTitle: opportunity.title,
        status: 'DRAFT',
        audienceSnapshot: {
          audienceCount: opportunity.audienceCount,
          eligibleCount: opportunity.eligibleCount,
          blockedCount: opportunity.blockedCount,
          evidence: opportunity.evidence,
          generatedAt: opportunity.generatedAt,
        },
      },
    })

    const promptInput = buildPromptInput(opportunity, [])
    const inputHash = hash(JSON.stringify(promptInput))

    try {
      const { output, rawOutputText } = await provider.generateCampaignStrategies(promptInput)

      const productResults = await Promise.all(output.strategies.map(s => productTruthService.verify(s.productId)))
      const findings = auditAllStrategies(output.strategies, productResults.map(r => r.product))

      const strategiesWithStatus = output.strategies.map((strategy, index) => {
        const strategyFindings = findings.filter(f => f.strategyIndex === index)
        return { ...strategy, status: strategyFindings.length ? 'BLOCKED' : 'OK', findings: strategyFindings }
      })

      const anyBlocked = findings.length > 0
      const status = anyBlocked ? 'DRAFT' : 'AWAITING_HUMAN_APPROVAL'

      await prisma.aiRun.create({
        data: {
          campaignDraftId: draft.id,
          provider: provider.name,
          model: provider.model,
          promptVersion: PROMPT_VERSION,
          inputHash,
          outputHash: hash(rawOutputText),
          status: 'ok',
        },
      })

      const updated = await prisma.campaignDraft.update({
        where: { id: draft.id },
        data: {
          strategies: strategiesWithStatus,
          productTruthStatus: anyBlocked ? 'BLOCKED' : 'APPROVED',
          complianceStatus: anyBlocked ? 'BLOCKED' : 'APPROVED',
          complianceFindings: findings,
          status,
        },
      })

      return { id: updated.id, status: updated.status, strategies: strategiesWithStatus, complianceFindings: findings }
    } catch (error) {
      await prisma.aiRun.create({
        data: {
          campaignDraftId: draft.id,
          provider: provider.name,
          model: provider.model,
          promptVersion: PROMPT_VERSION,
          inputHash,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  },

  async list() {
    return prisma.campaignDraft.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  },

  async getById(id: string) {
    const draft = await prisma.campaignDraft.findUnique({ where: { id } })
    if (!draft) throw new CampaignNotFoundError(id)
    return draft
  },

  async selectStrategy(id: string, strategyIndex: number) {
    const draft = await campaignService.getById(id)
    if (draft.status !== 'AWAITING_HUMAN_APPROVAL' && draft.status !== 'AI_READY') {
      throw new InvalidCampaignStateError(`Não é possível selecionar estratégia no estado ${draft.status}`)
    }
    const strategies = draft.strategies as Strategy[] | null
    if (!strategies || strategyIndex < 0 || strategyIndex >= strategies.length) {
      throw new InvalidCampaignStateError('Índice de estratégia inválido')
    }
    return prisma.campaignDraft.update({ where: { id }, data: { selectedStrategy: strategyIndex, status: 'AWAITING_HUMAN_APPROVAL' } })
  },

  // Único caminho de escrita para APPROVED. Nunca é chamado pela IA nem por
  // nenhum job automático — só por uma rota protegida por adminAuth, ou
  // seja, sempre exige um humano com o segredo de admin.
  async approve(id: string, approvedBy: string) {
    const draft = await campaignService.getById(id)
    if (draft.status !== 'AWAITING_HUMAN_APPROVAL') {
      throw new InvalidCampaignStateError(`Aprovação exige status AWAITING_HUMAN_APPROVAL (atual: ${draft.status})`)
    }
    if (draft.selectedStrategy === null || draft.selectedStrategy === undefined) {
      throw new InvalidCampaignStateError('Nenhuma estratégia selecionada')
    }
    return prisma.campaignDraft.update({ where: { id }, data: { status: 'APPROVED', approvedBy, approvedAt: new Date() } })
  },

  async schedule(id: string) {
    const draft = await campaignService.getById(id)
    if (draft.status !== 'APPROVED') throw new InvalidCampaignStateError(`Agendamento exige status APPROVED (atual: ${draft.status})`)
    // WHATSAPP_DRY_RUN permanece true nesta fase — nenhuma execução real de
    // envio é acionada por este endpoint, mesmo após aprovação humana.
    return prisma.campaignDraft.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt: new Date() } })
  },

  async cancel(id: string) {
    return prisma.campaignDraft.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  },
}
