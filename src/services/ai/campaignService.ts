import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { env } from '../../config/env'
import { getAiPrisma, assertAiDatabaseConfigured } from '../../config/aiPrisma'
import { getOpportunityById, Opportunity } from '../aiOpportunityEngine'
import { productTruthService } from '../productTruthService'
import { enrichOpportunityEvidence } from '../campaignEvidenceService'
import { segmentContracts, Segment } from '../remarketingService'
import { verifyMetaTemplateContract } from '../templateContracts'
import { getAiProvider } from './providerFactory'
import { acquireGenerationSlot } from './aiRateLimiter'
import { PROMPT_VERSION } from './campaignPromptContract'
import { auditAllStrategies, auditClaimCategories, ComplianceFinding } from './complianceService'
import { CampaignPromptInput, Strategy } from './aiProvider'
import { resolveStrategyDirections, auditDirectionAdherence } from './strategyPlaybook'
import { evaluateCreativeDistance } from './strategyDistanceService'
import { evaluateStrategyQuality } from './strategyQualityRubric'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export class CampaignNotFoundError extends Error {}
export class InvalidCampaignStateError extends Error {}
export class CampaignTemplateNotApprovedError extends Error {}

// Sanitização defensiva do erro ANTES de persistir em aiRun.errorMessage (uma
// coluna que humanos leem na tela de campanhas) — nunca confia que a
// mensagem de exceção do SDK/Prisma/axios já veio limpa. Redige tanto os
// valores reais dos segredos configurados (o caso mais provável de
// vazamento: um erro de auth ecoando o header enviado) quanto o padrão
// genérico usuário:senha de connection string, para cobrir erros de outras
// origens que citem uma URL de banco.
const SECRET_VALUES = [
  env.OPENAI_API_KEY, env.ANTHROPIC_API_KEY, env.ADMIN_SECRET, env.JOBS_SECRET,
  env.CRM_READ_SECRET, env.WEBHOOK_SECRET, env.META_ACCESS_TOKEN, env.NUVEMSHOP_ACCESS_TOKEN,
  env.AI_DATABASE_URL, env.DATABASE_URL, env.DIRECT_URL,
].filter((value) => value.length > 0)

function sanitizeErrorMessage(message: string): string {
  let sanitized = message
  for (const secret of SECRET_VALUES) sanitized = sanitized.split(secret).join('[REDACTED]')
  sanitized = sanitized.replace(/:\/\/[^\s:/@]+:[^\s@]+@/g, '://[REDACTED]:[REDACTED]@')
  return sanitized
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

// Fail-closed por design (seção 9, Final Pre-Activation Readiness): copy
// gerada pela IA nunca implica que o template correspondente está aprovado
// no WhatsApp Business — só verifyMetaTemplateContract() contra a Meta
// (mesma função já usada por remarketingService) prova isso. Chamado no
// único ponto que hoje se aproxima de "execução" (schedule); nenhum envio
// real acontece aqui nem em lugar nenhum desta rodada (REAL_SEND_ENABLED
// continua não existindo como caminho de código, só como intenção).
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

export const campaignService = {
  // Gera um novo draft a partir de uma oportunidade real. Nunca chamado
  // automaticamente — sempre a partir de um clique humano em "Gerar campanha".
  //
  // idempotencyKey (Final Pre-Activation Readiness, seção 5): opcional, vindo
  // de uma ação humana específica (um clique = uma key nova). Guardado dentro
  // de audienceSnapshot (Json já existente) em vez de uma coluna nova — evita
  // qualquer alteração de schema.prisma nesta rodada, o que evitaria também
  // que list()/getById() (que hoje continuam lendo o banco compartilhado
  // quando AI_DATABASE_URL está ausente) quebrassem contra colunas que a
  // migração real ainda não criou. A proteção de corrida verdadeira (dois
  // cliques simultâneos, não um retry sequencial) só passa a existir de
  // verdade quando o índice único preparado em
  // docs/sql/pending-activation/02-campaign-draft-idempotency-key.sql for
  // aplicado — até lá, o check abaixo (findFirst antes de create) já cobre o
  // caso pedido explicitamente: "mesmo retry => uma única chamada à IA".
  async createFromOpportunity(opportunityId: string, idempotencyKey?: string): Promise<CreateResult> {
    // Ordem importa: nenhuma chamada paga, nenhuma escrita, quando o banco de
    // IA não está configurado — a primeira linha da função, antes até da
    // busca da oportunidade.
    assertAiDatabaseConfigured()
    const aiPrisma = getAiPrisma()

    if (idempotencyKey) {
      const existing = await aiPrisma.campaignDraft.findFirst({
        where: { audienceSnapshot: { path: ['idempotencyKey'], equals: idempotencyKey } },
      })
      if (existing) {
        return { id: existing.id, status: existing.status, strategies: existing.strategies as Strategy[] | null, complianceFindings: existing.complianceFindings }
      }
    }

    const opportunity = await getOpportunityById(opportunityId)
    if (!opportunity) throw new CampaignNotFoundError(`Oportunidade não encontrada ou sem dados suficientes: ${opportunityId}`)

    // Falha rápido ANTES de qualquer escrita: se o provedor de IA não está
    // configurado (ex.: ANTHROPIC_API_KEY ausente), nenhum campaignDraft nem
    // aiRun é criado — evita rascunho órfão que nunca vai receber estratégias.
    const provider = getAiProvider()
    provider.assertConfigured()

    // Controles pagos (seção 6): concorrência e taxa por minuto, checados
    // ANTES da primeira escrita — um limite atingido também é zero writes.
    const releaseGenerationSlot = acquireGenerationSlot()

    try {
      const draft = await aiPrisma.campaignDraft.create({
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
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        },
      })

      const promptInput = await buildPromptInput(opportunity)
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
            errorMessage: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
          },
        })
        throw error
      }
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
