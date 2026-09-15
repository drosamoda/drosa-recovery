import axios from 'axios'
import { env } from '../../config/env'
import { AiProvider, AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError, CampaignPromptInput, campaignStrategiesSchema } from './aiProvider'

export const PROMPT_VERSION = 'campaign-strategies-v1'

const TOOL_SCHEMA = {
  name: 'submit_campaign_strategies',
  description: 'Envia exatamente 3 estratégias de campanha baseadas apenas nos dados fornecidos.',
  input_schema: {
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
          required: ['name', 'angle', 'audience', 'productId', 'message', 'cta', 'creativeBrief'],
        },
      },
    },
    required: ['opportunityId', 'summary', 'strategies'],
  },
} as const

const SYSTEM_PROMPT = `Você é o motor de estratégia de campanhas da D'Rosa Recovery.

REGRAS ABSOLUTAS:
- Você só pode usar os dados numéricos e textuais fornecidos no input. Nunca invente estoque, benefício, resultado, urgência ou prova social.
- Se nenhum produto candidato for fornecido, use productId: null e diga isso explicitamente na mensagem (ex: "produto ainda não recomendado").
- Nunca afirme "últimas unidades", "mais vendido", "estoque acabando" ou qualquer alegação de escassez/performance sem que ela esteja literalmente no input.
- Nunca use termos de benefício de produto não comprovado (emagrece, afina, modela, alfaiataria, premium) a menos que venham literalmente da descrição do produto fornecida.
- audienceCount/eligibleCount/blockedCount já vêm calculados pelo backend — você nunca recalcula nem contesta elegibilidade.
- Gere exatamente 3 estratégias distintas (ângulos diferentes), cada uma com hook, argumento, produto (ou null), mensagem, CTA e brief criativo curto para o time de criação.
- Se algo no input for insuficiente para uma alegação, adicione um aviso em "warnings" em vez de inventar.
- Retorne a resposta apenas via a ferramenta submit_campaign_strategies.`

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'
  readonly model: string

  constructor(model: string = env.AI_MODEL) {
    this.model = model
  }

  async generateCampaignStrategies(input: CampaignPromptInput) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new AiProviderConfigError('ANTHROPIC_API_KEY ausente — configure no ambiente antes de gerar campanhas com IA.')
    }

    const userMessage = JSON.stringify(input)

    let response
    try {
      response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: this.model,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: [TOOL_SCHEMA],
          tool_choice: { type: 'tool', name: 'submit_campaign_strategies' },
          messages: [{ role: 'user', content: userMessage }],
        },
        {
          headers: {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          timeout: 30000,
        }
      )
    } catch (error) {
      const isTimeout = axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
      if (isTimeout) throw new AiProviderTimeoutError('Chamada ao provedor de IA excedeu o tempo limite.')
      throw new AiProviderResponseError(`Falha ao chamar o provedor de IA: ${axios.isAxiosError(error) ? error.message : String(error)}`)
    }

    const toolUse = (response.data?.content ?? []).find((block: { type: string }) => block.type === 'tool_use')
    if (!toolUse) throw new AiProviderResponseError('Resposta da IA não incluiu a ferramenta esperada (submit_campaign_strategies).')

    const parsed = campaignStrategiesSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      throw new AiProviderResponseError(`Saída da IA não passou na validação de schema: ${parsed.error.message}`)
    }

    return { output: parsed.data, rawOutputText: JSON.stringify(toolUse.input) }
  }
}
