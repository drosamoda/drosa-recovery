import { z } from 'zod'
import { ResolvedDirection } from './strategyPlaybook'

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

export type Strategy = z.infer<typeof strategySchema>
export type CampaignStrategiesOutput = z.infer<typeof campaignStrategiesSchema>

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
  candidateProducts: Array<{ productId: string; name: string | null; price: number | null; stockStatus: string }>
  // Strategy Lab v1: direção determinística por tipo de oportunidade
  // (strategyPlaybook.ts) — a IA deve gerar exatamente uma estratégia por
  // direção, na ordem A/B/C, e nunca inventar o dado que falta quando uma
  // direção estiver degradada (guidance já vem ajustada e requiredWarning
  // diz qual aviso é obrigatório nesse caso).
  playbook: ResolvedDirection[]
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
  generateCampaignStrategies(input: CampaignPromptInput): Promise<{ output: CampaignStrategiesOutput; rawOutputText: string }>
}
