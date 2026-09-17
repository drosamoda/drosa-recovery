import { env } from '../../config/env'
import { AiProvider } from './aiProvider'
import { AnthropicProvider } from './anthropicProvider'
import { OpenAiProvider } from './openAiProvider'

// Ponto único de troca de provedor. Nada no domínio (opportunity engine,
// compliance, campaignService) conhece qual provedor está ativo — só este
// arquivo. A escolha é sempre explícita via AI_PROVIDER; sem fallback
// automático entre provedores nesta fase.
export function getAiProvider(): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider()
    case 'openai':
      return new OpenAiProvider()
    default:
      throw new Error(`AI_PROVIDER desconhecido: ${env.AI_PROVIDER}`)
  }
}
