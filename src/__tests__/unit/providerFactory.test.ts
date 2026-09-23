import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  env: { AI_PROVIDER: 'anthropic' as string },
}))

vi.mock('../../config/env', () => ({ env: mocks.env }))

import { getAiProvider } from '../../services/ai/providerFactory'
import { AnthropicProvider } from '../../services/ai/anthropicProvider'
import { OpenAiProvider } from '../../services/ai/openAiProvider'
import { GroqProvider } from '../../services/ai/groqProvider'

describe('providerFactory — AI_PROVIDER aceita anthropic | openai | groq, sem fallback automático', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('AI_PROVIDER=anthropic devolve AnthropicProvider', () => {
    mocks.env.AI_PROVIDER = 'anthropic'
    expect(getAiProvider()).toBeInstanceOf(AnthropicProvider)
  })

  it('AI_PROVIDER=openai devolve OpenAiProvider', () => {
    mocks.env.AI_PROVIDER = 'openai'
    expect(getAiProvider()).toBeInstanceOf(OpenAiProvider)
  })

  it('AI_PROVIDER=groq devolve GroqProvider', () => {
    mocks.env.AI_PROVIDER = 'groq'
    expect(getAiProvider()).toBeInstanceOf(GroqProvider)
  })

  it('um AI_PROVIDER desconhecido lança erro em vez de escolher um provedor por padrão', () => {
    mocks.env.AI_PROVIDER = 'algum-provedor-inventado'
    expect(() => getAiProvider()).toThrow(/AI_PROVIDER desconhecido/)
  })

  // Mesma prova estrutural já usada em providerParity.test.ts para os dois
  // provedores originais: nunca chama dois provedores em paralelo/corrida
  // para comparar e decidir automaticamente qual usar.
  it('nunca escolhe vencedor entre provedores: providerFactory não chama dois provedores condicionalmente nem compara resultado', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const text = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/providerFactory.ts'), 'utf8')
    expect(text).not.toMatch(/Promise\.(all|race)/)
    expect((text.match(/new (AnthropicProvider|OpenAiProvider|GroqProvider)/g) ?? []).length).toBe(3)
  })
})
