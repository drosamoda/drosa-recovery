import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { env } from '../../config/env'
import { AiProvider, AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError, AnyCampaignPromptInput, campaignStrategiesSchema, emailCampaignStrategiesSchema, isEmailPromptInput } from './aiProvider'
import { systemPromptFor } from './campaignPromptContract'

// Groq expõe uma API compatível com a da OpenAI (mesmo formato de request/
// response) — por isso reusa o SDK `openai`, só trocando `baseURL`. O
// mesmo `zodResponseFormat`/schema/validação usados por OpenAiProvider
// valem aqui: o schema é sempre reforçado no cliente (campaignStrategiesSchema
// .safeParse), então mesmo que o Groq não imponha o JSON Schema no lado do
// servidor com o mesmo rigor da OpenAI, a saída nunca escapa sem validação —
// fail-closed, igual aos outros dois provedores.
const RESPONSE_FORMAT = zodResponseFormat(campaignStrategiesSchema, 'campaign_strategies')
// Canal e-mail: mesmo pipeline, outro schema (subject/preheader/headline/body/cta).
const EMAIL_RESPONSE_FORMAT = zodResponseFormat(emailCampaignStrategiesSchema, 'email_campaign_strategies')

export class GroqProvider implements AiProvider {
  readonly name = 'groq'
  readonly model: string
  private client: OpenAI | null = null

  constructor(model: string = env.GROQ_MODEL) {
    this.model = model
  }

  assertConfigured(): void {
    if (!env.GROQ_API_KEY) {
      throw new AiProviderConfigError('GROQ_API_KEY ausente — configure no ambiente antes de gerar campanhas com IA.')
    }
  }

  private getClient(): OpenAI {
    this.assertConfigured()
    // Timeout explícito — mesmo controle de custo usado pelos outros dois
    // provedores, para que nenhum dos três possa ficar pendurado além do
    // limite configurado.
    if (!this.client) this.client = new OpenAI({ apiKey: env.GROQ_API_KEY, baseURL: env.GROQ_BASE_URL, timeout: env.AI_REQUEST_TIMEOUT_MS })
    return this.client
  }

  async generateCampaignStrategies(input: AnyCampaignPromptInput) {
    const client = this.getClient()
    const email = isEmailPromptInput(input)

    let completion
    try {
      completion = await client.chat.completions.parse({
        model: this.model,
        max_completion_tokens: env.AI_MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: systemPromptFor(email ? 'email' : 'whatsapp') },
          { role: 'user', content: JSON.stringify(input) },
        ],
        // O tipo do helper de parse é fixado pelo schema de WhatsApp; o valor em
        // runtime é o formato correto do canal e a saída é revalidada abaixo
        // com o schema do canal — o cast só evita duplicar o método inteiro.
        response_format: (email ? EMAIL_RESPONSE_FORMAT : RESPONSE_FORMAT) as typeof RESPONSE_FORMAT,
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

    const parsed = (email ? emailCampaignStrategiesSchema : campaignStrategiesSchema).safeParse(parsedOutput)
    if (!parsed.success) {
      throw new AiProviderResponseError(`Saída da IA não passou na validação de schema: ${parsed.error.message}`)
    }

    return { output: parsed.data, rawOutputText: JSON.stringify(parsedOutput) }
  }
}
