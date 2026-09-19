import { z } from 'zod'
import { EvidenceFlags, ResolvedDirection } from './strategyPlaybook'

// Contrato de saída da IA. Validado por schema — nenhuma resposta que não
// bater exatamente com isto chega a virar draft de campanha.
//
// `direction` (Strategy Lab v1): cada estratégia se autodeclara A/B/C,
// amarrada à direção do playbook (strategyPlaybook.ts) que ela deveria
// seguir. Isso é o que permite checar programaticamente que a estratégia no
// índice 0 realmente seguiu a direção A do playbook daquele tipo de
// oportunidade, em vez de confiar que a ordem de retorno da IA é a ordem
// pedida.
export const strategySchema = z.object({
  direction: z.enum(['A', 'B', 'C']),
  name: z.string().min(1),
  angle: z.string().min(1),
  audience: z.string().min(1),
  productId: z.string().nullable(),
  message: z.string().min(1),
  cta: z.string().min(1),
  creativeBrief: z.string().min(1),
  warnings: z.array(z.string()).default([]),
})

export const campaignStrategiesSchema = z.object({
  opportunityId: z.string().min(1),
  summary: z.string().min(1),
  strategies: z.array(strategySchema).length(3, 'A IA deve retornar exatamente 3 estratégias'),
})

// Email Campaign Intelligence — estratégia de E-MAIL. Mesmos campos de
// identidade/auditoria da estratégia de WhatsApp (direction, name, angle,
// audience, productId, cta, creativeBrief, warnings), mas o conteúdo é
// subject/preheader/headline/body em vez de `message`. Todos os campos são
// obrigatórios (sem opcionais) porque o JSON Schema estrito dos provedores
// não aceita campos opcionais. Limites de tamanho NÃO estão no schema (os
// provedores tratam minLength/maxLength de forma diferente): são verificados
// depois, de forma determinística, em strategyQualityRubric.
export const emailStrategySchema = z.object({
  direction: z.enum(['A', 'B', 'C']),
  name: z.string().min(1),
  angle: z.string().min(1),
  audience: z.string().min(1),
  productId: z.string().nullable(),
  subject: z.string().min(1),
  preheader: z.string().min(1),
  headline: z.string().min(1),
  body: z.string().min(1),
  cta: z.string().min(1),
  creativeBrief: z.string().min(1),
  warnings: z.array(z.string()).default([]),
})

export const emailCampaignStrategiesSchema = z.object({
  opportunityId: z.string().min(1),
  summary: z.string().min(1),
  strategies: z.array(emailStrategySchema).length(3, 'A IA deve retornar exatamente 3 estratégias'),
})

export type WhatsappStrategy = z.infer<typeof strategySchema>
export type EmailStrategy = z.infer<typeof emailStrategySchema>
// Strategy é a união dos dois canais. Código que só precisa de "o texto da
// estratégia" usa strategyText(); código que precisa de campos de e-mail
// estreita com isEmailStrategy().
export type Strategy = WhatsappStrategy | EmailStrategy
export type CampaignStrategiesOutput = z.infer<typeof campaignStrategiesSchema>
export type EmailCampaignStrategiesOutput = z.infer<typeof emailCampaignStrategiesSchema>
export type AnyCampaignStrategiesOutput = CampaignStrategiesOutput | EmailCampaignStrategiesOutput

export function isEmailStrategy(strategy: Strategy): strategy is EmailStrategy {
  return 'subject' in strategy
}

// Todo o texto voltado ao cliente de uma estratégia, em ordem de leitura.
// Compliance, distância criativa e rubrica leem por aqui — assim um campo de
// e-mail (assunto, preheader, corpo) nunca escapa de uma auditoria só porque o
// auditor foi escrito olhando `message`.
export function strategyText(strategy: Strategy): string {
  return isEmailStrategy(strategy)
    ? [strategy.subject, strategy.preheader, strategy.headline, strategy.body].join('\n')
    : strategy.message
}

export type CampaignProductFact = {
  productId: string
  name: string | null
  price: number | null
  compareAtPrice: number | null
  stockStatus: string
  colors: string[] | null
  sizes: string[] | null
  url: string | null
}

export type CampaignPromptInput = {
  opportunityId: string
  opportunityType: string
  title: string
  reason: string
  audienceCount: number
  eligibleCount: number
  blockedCount: number
  recommendedTiming: string
  recommendedChannel: string
  confidence: string
  // Evidence Enrichment v1: campos honestos vindos direto de Product Truth
  // (Nuvemshop confirmada) — nunca preenchidos por heurística. Ausente = null,
  // igual ao próprio ProductTruth (productTruthService.ts).
  //
  // Três significados DIFERENTES, nunca intercambiáveis (Live Evidence Probe
  // v1.1 — seção 6/7): candidateProducts é o único que a IA pode tratar como
  // "posso usar/recomendar isto"; os outros dois são só contexto factual.
  //   candidateProducts = produto que passou Product Truth e pode ser usado
  //     como candidato na estratégia, dentro das regras do playbook.
  //   purchasedProducts = produto comprovadamente comprado antes pelo
  //     cliente/segmento — CONTEXTO, nunca promovido a recomendação
  //     automática (não existe regra de cross-sell determinística ainda).
  //   cartProducts = produto comprovadamente presente num checkout real —
  //     CONTEXTO, não é por si só confirmação de estoque atual.
  candidateProducts: Array<CampaignProductFact>
  purchasedProducts: Array<CampaignProductFact>
  cartProducts: Array<CampaignProductFact>
  // Strategy Lab v1: direção determinística por tipo de oportunidade
  // (strategyPlaybook.ts) — a IA deve gerar exatamente uma estratégia por
  // direção, na ordem A/B/C, e nunca inventar o dado que falta quando uma
  // direção estiver degradada (guidance já vem ajustada e requiredWarning
  // diz qual aviso é obrigatório nesse caso).
  playbook: ResolvedDirection[]
  // Strategy Lab v1.1 — Truth Hardening: as mesmas flags usadas para resolver
  // o playbook, expostas cruas no input para a IA (e para
  // complianceService.auditClaimCategories) nunca tratar como comprovado um
  // fato que esta oportunidade não sustenta.
  evidence: EvidenceFlags
}

// Input de IA para campanha de E-MAIL. PRIVACIDADE (NO_PII_TO_AI): contém
// somente contagens agregadas, descrições de segmento/campanha, flags de
// evidência e o playbook — NUNCA e-mail, nome, telefone, id de cliente ou
// número de pedido. A audiência já foi decidida pelo backend; a IA só escreve
// copy para ela.
export type EmailCampaignPromptInput = {
  channel: 'email'
  opportunityId: string
  opportunityType: string
  segment: {
    key: string
    name: string
    description: string
    audienceCount: number
    withValidEmailCount: number
  }
  campaign: {
    key: string
    name: string
    objective: string
    category: string
    funnelStage: string
    recommendedCooldownDays: number
  }
  // Enquanto não existir fonte de consentimento, a IA sabe que NÃO deve
  // sugerir que o público está "pronto para enviar".
  sendEligibility: string
  dataQualityFlags: string[]
  // Contexto de produto verificado (Product Truth). Hoje sempre vazio para
  // e-mail: nenhuma seleção de produto por segmento existe — a IA precisa dizer
  // isso em vez de inventar.
  candidateProducts: Array<CampaignProductFact>
  purchasedProducts: Array<CampaignProductFact>
  cartProducts: Array<CampaignProductFact>
  playbook: ResolvedDirection[]
  evidence: EvidenceFlags
}

export type AnyCampaignPromptInput = CampaignPromptInput | EmailCampaignPromptInput

export function isEmailPromptInput(input: AnyCampaignPromptInput): input is EmailCampaignPromptInput {
  return (input as { channel?: string }).channel === 'email'
}

export class AiProviderConfigError extends Error {}
export class AiProviderTimeoutError extends Error {}
export class AiProviderResponseError extends Error {}

export interface AiProvider {
  readonly name: string
  readonly model: string
  // Valida configuração (ex.: API key) de forma síncrona e ANTES de qualquer
  // escrita de campanha — permite ao chamador falhar rápido (503) sem deixar
  // um campaignDraft/aiRun órfão no banco quando o provedor não está pronto.
  assertConfigured(): void
  // Um único pipeline para os dois canais: o provedor escolhe schema e prompt
  // pelo canal do input (ausente/whatsapp = contrato anterior, inalterado).
  generateCampaignStrategies(input: AnyCampaignPromptInput): Promise<{ output: AnyCampaignStrategiesOutput; rawOutputText: string }>
}
