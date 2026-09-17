import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import { env } from '../../config/env'
import { AiProvider, AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError, CampaignPromptInput, campaignStrategiesSchema } from './aiProvider'

export const PROMPT_VERSION = 'campaign-strategies-v1'

// jsonSchemaOutputFormat (não zodOutputFormat) porque o helper de Zod do SDK
// espera Zod v4 internamente; o projeto está em Zod v3 em todo o resto do
// código (env.ts, todos os outros schemas) e não vale a pena forçar duas
// versões de Zod coexistindo só por causa deste provider. O contrato de
// saída continua sendo validado de novo pelo campaignStrategiesSchema (Zod
// v3, já existente) depois do parse — validação em duas camadas.
const STRATEGIES_JSON_SCHEMA = {
  type: 'object',
  properties: {
    opportunityId: { type: 'string' },
    summary: { type: 'string' },
    strategies: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          angle: { type: 'string' },
          audience: { type: 'string' },
          productId: { type: ['string', 'null'] },
          message: { type: 'string' },
          cta: { type: 'string' },
          creativeBrief: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'angle', 'audience', 'productId', 'message', 'cta', 'creativeBrief', 'warnings'],
      },
    },
  },
  required: ['opportunityId', 'summary', 'strategies'],
} as const

const SYSTEM_PROMPT = `Você é o motor de estratégia de campanhas da D'Rosa Recovery.

REGRAS ABSOLUTAS:
- Você só pode usar os dados numéricos e textuais fornecidos no input. Nunca invente estoque, benefício, resultado, urgência ou prova social.
- Se nenhum produto candidato for fornecido, use productId: null e diga isso explicitamente na mensagem (ex: "produto ainda não recomendado").
- Nunca afirme "últimas unidades", "mais vendido", "estoque acabando" ou qualquer alegação de escassez/performance sem que ela esteja literalmente no input.
- Nunca use termos de benefício de produto não comprovado (emagrece, afina, modela, alfaiataria, premium) a menos que venham literalmente da descrição do produto fornecida.
- audienceCount/eligibleCount/blockedCount já vêm calculados pelo backend — você nunca recalcula nem contesta elegibilidade.
- Gere exatamente 3 estratégias distintas (ângulos diferentes), cada uma com hook, argumento, produto (ou null), mensagem, CTA e brief criativo curto para o time de criação.
- Se algo no input for insuficiente para uma alegação, adicione um aviso em "warnings" em vez de inventar.`

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'
  readonly model: string
  private client: Anthropic | null = null

  constructor(model: string = env.AI_MODEL) {
    this.model = model
  }

  assertConfigured(): void {
    if (!env.ANTHROPIC_API_KEY) {
      throw new AiProviderConfigError('ANTHROPIC_API_KEY ausente — configure no ambiente antes de gerar campanhas com IA.')
    }
  }

  private getClient(): Anthropic {
    this.assertConfigured()
    if (!this.client) this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    return this.client
  }

  async generateCampaignStrategies(input: CampaignPromptInput) {
    const client = this.getClient()

    let response
    try {
      response = await client.messages.parse({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        output_config: { format: jsonSchemaOutputFormat(STRATEGIES_JSON_SCHEMA) },
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      })
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AiProviderTimeoutError('Chamada ao provedor de IA excedeu o tempo limite.')
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new AiProviderResponseError('Provedor de IA com rate limit — tente novamente em instantes.')
      }
      if (error instanceof Anthropic.APIError) {
        throw new AiProviderResponseError(`Falha ao chamar o provedor de IA: ${error.message}`)
      }
      throw new AiProviderResponseError(`Falha ao chamar o provedor de IA: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (response.stop_reason === 'refusal') {
      throw new AiProviderResponseError('O provedor de IA recusou a geração desta campanha.')
    }
    if (!response.parsed_output) {
      throw new AiProviderResponseError('Resposta da IA não pôde ser interpretada como JSON estruturado.')
    }

    const parsed = campaignStrategiesSchema.safeParse(response.parsed_output)
    if (!parsed.success) {
      throw new AiProviderResponseError(`Saída da IA não passou na validação de schema: ${parsed.error.message}`)
    }

    return { output: parsed.data, rawOutputText: JSON.stringify(response.parsed_output) }
  }
}
