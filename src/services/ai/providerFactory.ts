import { env } from '../../config/env'
import { AiProvider } from './aiProvider'
import { AnthropicProvider } from './anthropicProvider'

// Ponto único de troca de provedor. Trocar para OpenAI (ou outro) no futuro
// significa adicionar um case aqui — nada no domínio (opportunity engine,
// compliance, campaignService) conhece qual provedor está ativo.
export function getAiProvider(): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider()
    default:
      throw new Error(`AI_PROVIDER desconhecido: ${env.AI_PROVIDER}`)
  }
}
