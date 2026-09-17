import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { getOpportunityById, Opportunity } from '../aiOpportunityEngine'
import { productTruthService } from '../productTruthService'
import { getAiProvider } from './providerFactory'
import { PROMPT_VERSION } from './campaignPromptContract'
import { auditAllStrategies, auditClaimCategories, ComplianceFinding } from './complianceService'
import { CampaignPromptInput, Strategy } from './aiProvider'
import { EvidenceFlags, resolveStrategyDirections, auditDirectionAdherence } from './strategyPlaybook'
import { evaluateCreativeDistance } from './strategyDistanceService'
import { evaluateStrategyQuality } from './strategyQualityRubric'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class CampaignNotFoundError extends Error {}
export class InvalidCampaignStateError extends Error {}

// Strategy Lab v1.1 — Truth Hardening: única função que decide o que está
// realmente comprovado para esta oportunidade. hasCandidateProducts é a
// única flag genuinamente dinâmica hoje (verdadeira só se candidateProducts
// não estiver vazio); as outras cinco são sempre false porque nenhuma fonte
// real de categoria de interesse, estoque por candidato, indício de
// novidade, prazo de pagamento comprovado, segunda via de boleto ou promoção
// ativa existe no modelo de dados atual (Order/Opportunity não carregam
// nada disso). Centralizar aqui — em vez de espalhar `false` em vários
// lugares — significa que o dia em que uma fonte real existir, muda só isto.
function computeEvidenceFlags(candidateProducts: CampaignPromptInput['candidateProducts']): EvidenceFlags {
  return {
    hasCandidateProducts: candidateProducts.length > 0,
    hasCategoryEvidence: false,
    hasStockEvidence: false,
    hasNewnessEvidence: false,
    hasPaymentExpiryEvidence: false,
    hasSecondCopySupport: false,
    hasPromotionEvidence: false,
  }
}

function buildPromptInput(opportunity: Opportunity, candidateProducts: CampaignPromptInput['candidateProducts']): CampaignPromptInput {
  const evidence = computeEvidenceFlags(candidateProducts)
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
    playbook: resolveStrategyDirections(opportunity.type, evidence),
    evidence,
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
      const complianceFindings = auditAllStrategies(output.strategies, productResults.map(r => r.product))
      // Strategy Lab v1.1 — Truth Hardening: claims IMPLÍCITAS (ex.: "continua
      // disponível") que não usam nenhuma palavra de GUARDED_CLAIMS mas
      // pressupõem um fato que promptInput.evidence não comprova.
      const claimCategoryFindings = output.strategies.flatMap((strategy, index) =>
        auditClaimCategories(strategy, index, opportunity.type, promptInput.evidence))

      // Strategy Lab v1: dois gates adicionais, tão hard-block quanto compliance.
      // Adesão de direção garante que a IA não embaralhou/pulou A/B/C; distância
      // criativa garante que A/B/C não são a mesma ideia reescrita. Nenhum dos
      // dois é previsão de venda — são checagens estruturais do texto gerado.
      const directionFindings = auditDirectionAdherence(output.strategies, promptInput.playbook)
      const distanceFindings = evaluateCreativeDistance(output.strategies)

      const findings: ComplianceFinding[] = [
        ...complianceFindings,
        ...claimCategoryFindings,
        ...directionFindings.map(f => ({ strategyIndex: f.strategyIndex, claim: 'direction_mismatch', reason: f.reason })),
        ...distanceFindings.flatMap(f => ([
          { strategyIndex: f.strategyIndexA, claim: 'creative_distance', reason: f.reason },
          { strategyIndex: f.strategyIndexB, claim: 'creative_distance', reason: f.reason },
        ])),
      ]

      const strategiesWithStatus = output.strategies.map((strategy, index) => {
        const strategyFindings = findings.filter(f => f.strategyIndex === index)
        const qualityRubric = evaluateStrategyQuality(strategy, {
          product: productResults[index]?.product ?? null,
          complianceFindings,
          distanceFindings,
          strategyIndex: index,
        })
        return { ...strategy, status: strategyFindings.length ? 'BLOCKED' : 'OK', findings: strategyFindings, qualityRubric }
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
          strategies: strategiesWithStatus as unknown as Prisma.InputJsonValue,
          productTruthStatus: anyBlocked ? 'BLOCKED' : 'APPROVED',
          complianceStatus: anyBlocked ? 'BLOCKED' : 'APPROVED',
          complianceFindings: findings as unknown as Prisma.InputJsonValue,
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
