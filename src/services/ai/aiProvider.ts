import { z } from 'zod'

// Contrato de saída da IA. Validado por schema — nenhuma resposta que não
// bater exatamente com isto chega a virar draft de campanha.
export const strategySchema = z.object({
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
}

export class AiProviderConfigError extends Error {}
export class AiProviderTimeoutError extends Error {}
export class AiProviderResponseError extends Error {}

export interface AiProvider {
  readonly name: string
  readonly model: string
  generateCampaignStrategies(input: CampaignPromptInput): Promise<{ output: CampaignStrategiesOutput; rawOutputText: string }>
}
