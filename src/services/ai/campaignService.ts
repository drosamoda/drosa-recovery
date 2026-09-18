import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { getAiPrisma } from '../../config/aiPrisma'
import { getOpportunityById, Opportunity } from '../aiOpportunityEngine'
import { productTruthService } from '../productTruthService'
import { enrichOpportunityEvidence } from '../campaignEvidenceService'
import { segmentContracts, Segment } from '../remarketingService'
import { verifyMetaTemplateContract } from '../templateContracts'
import { getAiProvider } from './providerFactory'
import { acquireGenerationSlot, AiConcurrencyLimitError, AiRateLimitExceededError } from './aiRateLimiter'
import { PROMPT_VERSION } from './campaignPromptContract'
import { auditAllStrategies, auditClaimCategories, ComplianceFinding } from './complianceService'
import { AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError, CampaignPromptInput, Strategy } from './aiProvider'
import { resolveStrategyDirections, auditDirectionAdherence } from './strategyPlaybook'
import { evaluateCreativeDistance } from './strategyDistanceService'
import { evaluateStrategyQuality } from './strategyQualityRubric'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class CampaignNotFoundError extends Error {}
export class InvalidCampaignStateError extends Error {}
export class CampaignTemplateNotApprovedError extends Error {}

// Activation Wiring v2, seção 8: nunca persiste a mensagem de exceção
// (mesmo redigida) em ai_runs.errorMessage — só uma categoria fechada. A
// categoria é suficiente para um humano decidir "tentar de novo agora" vs.
// "isso precisa de configuração", sem risco de a coluna um dia ecoar prompt
// bruto, resposta bruta, stack trace ou segredo.
export type AiErrorCategory = 'AI_TIMEOUT' | 'AI_RATE_LIMIT' | 'AI_PROVIDER_ERROR' | 'AI_SCHEMA_ERROR' | 'AI_CONFIG_ERROR' | 'AI_UNKNOWN_ERROR'

function categorizeAiError(error: unknown): AiErrorCategory {
  if (error instanceof AiProviderTimeoutError) return 'AI_TIMEOUT'
  if (error instanceof AiConcurrencyLimitError || error instanceof AiRateLimitExceededError) return 'AI_RATE_LIMIT'
  if (error instanceof AiProviderConfigError) return 'AI_CONFIG_ERROR'
  if (error instanceof AiProviderResponseError) {
    // AiProviderResponseError cobre vários casos hoje (refusal, rate limit
    // 429, validação de schema, erro genérico da API) — todos com mensagens
    // que NÓS escrevemos em anthropicProvider.ts/openAiProvider.ts (nunca o
    // texto bruto do SDK), então checar por essas duas palavras-chave é
    // seguro, não um parsing de conteúdo de terceiros.
    if (/rate limit/i.test(error.message)) return 'AI_RATE_LIMIT'
    if (/valida(ç|c)ão de schema/i.test(error.message)) return 'AI_SCHEMA_ERROR'
    return 'AI_PROVIDER_ERROR'
  }
  return 'AI_UNKNOWN_ERROR'
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

// REPEAT_PURCHASE reaproveita o template de recent_customer (mesma escolha
// já feita em aiOpportunityEngine.ts para o campo evidence.template — nunca
// uma segunda cópia divergente da mesma decisão).
const OPPORTUNITY_TEMPLATE_SEGMENT: Record<Opportunity['type'], Segment> = {
  ABANDONED_CART: 'abandoned_cart',
  PIX_PENDING: 'pix_pending',
  BOLETO_PENDING: 'boleto_pending',
  RECENT_CUSTOMER: 'recent_customer',
  VIP: 'vip_customer',
  WINBACK: 'inactive_customer',
  REPEAT_PURCHASE: 'recent_customer',
  ENGAGED_NO_PURCHASE: 'engaged_no_purchase',
}

// Fail-closed por design: copy gerada pela IA nunca implica que o template
// correspondente está aprovado no WhatsApp Business — só
// verifyMetaTemplateContract() contra a Meta (mesma função já usada por
// remarketingService) prova isso. Chamado no único ponto que hoje se
// aproxima de "execução" (schedule); nenhum envio real acontece aqui nem em
// lugar nenhum desta rodada.
async function assertTemplateApprovedForSend(opportunityType: Opportunity['type']): Promise<void> {
  const segment = OPPORTUNITY_TEMPLATE_SEGMENT[opportunityType]
  const templateName = segmentContracts[segment].template
  const problem = await verifyMetaTemplateContract(templateName, 'pt_BR')
  if (problem !== null) {
    throw new CampaignTemplateNotApprovedError(`Agendamento bloqueado: template "${templateName}" não está com aprovação confirmada no WhatsApp (${problem}).`)
  }
}

// Evidence Enrichment v1: candidateProducts e evidenceFlags vêm de
// campaignEvidenceService.ts (dados reais — AbandonedCheckout/Order/Product
// Truth), nunca de heurística textual. "Product Truth antes da IA": qualquer
// id que chegue aqui já foi confirmado pela Nuvemshop dentro do próprio
// enrichOpportunityEvidence — a IA nunca vê um id não confirmado.
async function buildPromptInput(opportunity: Opportunity): Promise<CampaignPromptInput> {
  const evidence = await enrichOpportunityEvidence(opportunity)
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
    candidateProducts: evidence.candidateProducts,
    purchasedProducts: evidence.purchasedProducts,
    cartProducts: evidence.cartProducts,
    playbook: resolveStrategyDirections(opportunity.type, evidence.evidenceFlags),
    evidence: evidence.evidenceFlags,
  }
}

type CreateResult = { id: string; status: string; strategies: Strategy[] | null; complianceFindings: unknown }

function fromExistingDraft(draft: { id: string; status: string; strategies: unknown; complianceFindings: unknown }): CreateResult {
  return { id: draft.id, status: draft.status, strategies: draft.strategies as Strategy[] | null, complianceFindings: draft.complianceFindings }
}

export const campaignService = {
  // Gera um novo draft a partir de uma oportunidade real. Nunca chamado
  // automaticamente — sempre a partir de um clique humano em "Gerar campanha".
  //
  // idempotencyKey (Activation Wiring v2, seção 2-4): OBRIGATÓRIA — o
  // frontend gera uma por ação humana (crypto.randomUUID(), só em memória).
  // Reenviar a MESMA key (retry sequencial) devolve o draft já criado, sem
  // chamar a IA de novo. Duas requisições concorrentes com a MESMA key
  // (corrida real) são resolvidas pela constraint UNIQUE de
  // CampaignDraft.idempotencyKey: a que perder a corrida do create() recebe
  // P2002 do Postgres, busca o draft vencedor e o devolve — nunca chama o
  // provedor uma segunda vez.
  async createFromOpportunity(opportunityId: string, idempotencyKey: string): Promise<CreateResult> {
    // Primeira linha: nenhuma chamada paga, nenhuma escrita, quando o banco
    // de IA não está configurado.
    const aiPrisma = getAiPrisma()

    const existing = await aiPrisma.campaignDraft.findUnique({ where: { idempotencyKey } })
    if (existing) return fromExistingDraft(existing)

    const opportunity = await getOpportunityById(opportunityId)
    if (!opportunity) throw new CampaignNotFoundError(`Oportunidade não encontrada ou sem dados suficientes: ${opportunityId}`)

    // Falha rápido ANTES de qualquer escrita: se o provedor de IA não está
    // configurado (ex.: ANTHROPIC_API_KEY ausente), nenhum campaignDraft nem
    // aiRun é criado — evita rascunho órfão que nunca vai receber estratégias.
    const provider = getAiProvider()
    provider.assertConfigured()

    let draft
    try {
      draft = await aiPrisma.campaignDraft.create({
        data: {
          opportunityId: opportunity.id,
          opportunityType: opportunity.type,
          opportunityTitle: opportunity.title,
          status: 'DRAFT',
          idempotencyKey,
          audienceSnapshot: {
            audienceCount: opportunity.audienceCount,
            eligibleCount: opportunity.eligibleCount,
            blockedCount: opportunity.blockedCount,
            evidence: opportunity.evidence,
            generatedAt: opportunity.generatedAt,
          },
        },
      })
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Corrida real: outra requisição com a MESMA key venceu a criação
        // entre o findUnique acima e este create — busca o draft vencedor e
        // devolve, em vez de duplicar a chamada à IA.
        const winner = await aiPrisma.campaignDraft.findUnique({ where: { idempotencyKey } })
        if (winner) return fromExistingDraft(winner)
      }
      throw error
    }

    const promptInput = await buildPromptInput(opportunity)
    const inputHash = hash(JSON.stringify(promptInput))

    // Controles pagos: concorrência e taxa por minuto, checados
    // imediatamente antes da chamada paga em si.
    const releaseGenerationSlot = acquireGenerationSlot()
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

      await aiPrisma.aiRun.create({
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

      const updated = await aiPrisma.campaignDraft.update({
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
      await aiPrisma.aiRun.create({
        data: {
          campaignDraftId: draft.id,
          provider: provider.name,
          model: provider.model,
          promptVersion: PROMPT_VERSION,
          inputHash,
          status: 'error',
          errorMessage: categorizeAiError(error),
        },
      })
      throw error
    } finally {
      releaseGenerationSlot()
    }
  },

  async list() {
    return getAiPrisma().campaignDraft.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  },

  async getById(id: string) {
    const draft = await getAiPrisma().campaignDraft.findUnique({ where: { id } })
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
    return getAiPrisma().campaignDraft.update({ where: { id }, data: { selectedStrategy: strategyIndex, status: 'AWAITING_HUMAN_APPROVAL' } })
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
    return getAiPrisma().campaignDraft.update({ where: { id }, data: { status: 'APPROVED', approvedBy, approvedAt: new Date() } })
  },

  async schedule(id: string) {
    const draft = await campaignService.getById(id)
    if (draft.status !== 'APPROVED') throw new InvalidCampaignStateError(`Agendamento exige status APPROVED (atual: ${draft.status})`)
    await assertTemplateApprovedForSend(draft.opportunityType)
    // WHATSAPP_DRY_RUN permanece true nesta fase — nenhuma execução real de
    // envio é acionada por este endpoint, mesmo após aprovação humana.
    return getAiPrisma().campaignDraft.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt: new Date() } })
  },

  async cancel(id: string) {
    return getAiPrisma().campaignDraft.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  },
}
