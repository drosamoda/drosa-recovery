import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ env: { AI_PROVIDER: 'anthropic' as string } }))

vi.mock('../../config/env', () => ({ env: mocks.env }))

import { getAiProvider } from '../../services/ai/providerFactory'
import { AnthropicProvider } from '../../services/ai/anthropicProvider'
import { OpenAiProvider } from '../../services/ai/openAiProvider'

describe('providerFactory — escolha explícita, sem fallback automático', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('AI_PROVIDER=anthropic retorna AnthropicProvider', () => {
    mocks.env.AI_PROVIDER = 'anthropic'
    expect(getAiProvider()).toBeInstanceOf(AnthropicProvider)
  })

  it('AI_PROVIDER=openai retorna OpenAiProvider', () => {
    mocks.env.AI_PROVIDER = 'openai'
    expect(getAiProvider()).toBeInstanceOf(OpenAiProvider)
  })

  it('AI_PROVIDER desconhecido lança erro controlado em vez de cair num provedor por acidente', () => {
    mocks.env.AI_PROVIDER = 'gemini'
    expect(() => getAiProvider()).toThrow(/AI_PROVIDER desconhecido/)
  })
})
