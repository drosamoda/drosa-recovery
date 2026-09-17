import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { env } from '../../config/env'
import { AiProvider, AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError, CampaignPromptInput, campaignStrategiesSchema } from './aiProvider'
import { SYSTEM_PROMPT } from './campaignPromptContract'

// zodResponseFormat (helper oficial da OpenAI) aceita Zod v3 nativamente — ao contrário do
// helper equivalente da Anthropic, não precisa de um JSON Schema escrito à mão. O schema que
// molda a geração e o schema que valida a saída depois são literalmente o mesmo objeto
// (campaignStrategiesSchema), então os dois providers terminam validando pelo mesmo contrato
// por construção, não por coincidência entre duas cópias mantidas à mão.
const RESPONSE_FORMAT = zodResponseFormat(campaignStrategiesSchema, 'campaign_strategies')

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai'
  readonly model: string
  private client: OpenAI | null = null

  constructor(model: string = env.OPENAI_MODEL) {
    this.model = model
  }

  assertConfigured(): void {
    if (!env.OPENAI_API_KEY) {
      throw new AiProviderConfigError('OPENAI_API_KEY ausente — configure no ambiente antes de gerar campanhas com IA.')
    }
  }

  private getClient(): OpenAI {
    this.assertConfigured()
    if (!this.client) this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
    return this.client
  }

  async generateCampaignStrategies(input: CampaignPromptInput) {
    const client = this.getClient()

    let completion
    try {
      completion = await client.chat.completions.parse({
        model: this.model,
        max_completion_tokens: 4096,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(input) },
        ],
        response_format: RESPONSE_FORMAT,
      })
    } catch (error) {
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new AiProviderTimeoutError('Chamada ao provedor de IA excedeu o tempo limite.')
      }
      if (error instanceof OpenAI.RateLimitError) {
        throw new AiProviderResponseError('Provedor de IA com rate limit — tente novamente em instantes.')
      }
      if (error instanceof OpenAI.APIError) {
        throw new AiProviderResponseError(`Falha ao chamar o provedor de IA: ${error.message}`)
      }
      throw new AiProviderResponseError(`Falha ao chamar o provedor de IA: ${error instanceof Error ? error.message : String(error)}`)
    }

    const choice = completion.choices[0]
    if (choice?.finish_reason === 'content_filter') {
      throw new AiProviderResponseError('O provedor de IA recusou a geração desta campanha (filtro de conteúdo).')
    }
    if (choice?.message?.refusal) {
      throw new AiProviderResponseError(`O provedor de IA recusou a geração desta campanha: ${choice.message.refusal}`)
    }
    const parsedOutput = choice?.message?.parsed
    if (!parsedOutput) {
      throw new AiProviderResponseError('Resposta da IA não pôde ser interpretada como JSON estruturado.')
    }

    const parsed = campaignStrategiesSchema.safeParse(parsedOutput)
    if (!parsed.success) {
      throw new AiProviderResponseError(`Saída da IA não passou na validação de schema: ${parsed.error.message}`)
    }

    return { output: parsed.data, rawOutputText: JSON.stringify(parsedOutput) }
  }
}
