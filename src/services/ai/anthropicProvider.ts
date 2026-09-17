import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import { env } from '../../config/env'
import { AiProvider, AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError, CampaignPromptInput, campaignStrategiesSchema } from './aiProvider'
import { SYSTEM_PROMPT, STRATEGIES_JSON_SCHEMA } from './campaignPromptContract'

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic'
  readonly model: string
  private client: Anthropic | null = null

  constructor(model: string = env.ANTHROPIC_MODEL) {
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
