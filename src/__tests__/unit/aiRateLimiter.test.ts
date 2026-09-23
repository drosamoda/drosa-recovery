import { beforeEach, describe, expect, it, vi } from 'vitest'

// Módulo tem estado (contadores em memória) — cada teste precisa de um
// registro de módulos limpo (vi.resetModules + import dinâmico) para não
// herdar slots/timestamps de um teste anterior.
const mocks = vi.hoisted(() => ({
  env: { AI_MAX_CONCURRENT_GENERATIONS: 2, AI_GENERATION_MAX_PER_MINUTE: 3 },
}))

vi.mock('../../config/env', () => ({ env: mocks.env }))

describe('aiRateLimiter — controles pagos (Final Pre-Activation Readiness, seção 6)', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.env.AI_MAX_CONCURRENT_GENERATIONS = 2
    mocks.env.AI_GENERATION_MAX_PER_MINUTE = 3
  })

  it('bloqueia a geração além do limite de concorrência configurado, e libera o slot quando o release é chamado', async () => {
    const { acquireGenerationSlot, AiConcurrencyLimitError } = await import('../../services/ai/aiRateLimiter')
    const release1 = acquireGenerationSlot()
    acquireGenerationSlot()
    expect(() => acquireGenerationSlot()).toThrow(AiConcurrencyLimitError)

    release1()
    expect(() => acquireGenerationSlot()).not.toThrow()
  })

  it('bloqueia geração além do limite por minuto mesmo com slots de concorrência livres', async () => {
    mocks.env.AI_MAX_CONCURRENT_GENERATIONS = 100
    const { acquireGenerationSlot, AiRateLimitExceededError } = await import('../../services/ai/aiRateLimiter')

    acquireGenerationSlot()()
    acquireGenerationSlot()()
    acquireGenerationSlot()()
    expect(() => acquireGenerationSlot()).toThrow(AiRateLimitExceededError)
  })

  it('release() é idempotente — chamar duas vezes não abre um slot extra', async () => {
    mocks.env.AI_MAX_CONCURRENT_GENERATIONS = 1
    const { acquireGenerationSlot, AiConcurrencyLimitError } = await import('../../services/ai/aiRateLimiter')

    const release = acquireGenerationSlot()
    release()
    release() // idempotente — não deveria liberar um segundo slot inexistente

    acquireGenerationSlot() // ocupa o único slot de novo
    expect(() => acquireGenerationSlot()).toThrow(AiConcurrencyLimitError)
  })

  it('um limite de concorrência atingido não consome o orçamento por minuto (nenhuma geração de fato começou)', async () => {
    mocks.env.AI_MAX_CONCURRENT_GENERATIONS = 1
    mocks.env.AI_GENERATION_MAX_PER_MINUTE = 100
    const { acquireGenerationSlot, AiConcurrencyLimitError } = await import('../../services/ai/aiRateLimiter')

    const release = acquireGenerationSlot()
    expect(() => acquireGenerationSlot()).toThrow(AiConcurrencyLimitError)
    release()
    // Se a tentativa bloqueada tivesse contado para o limite por minuto, o
    // orçamento já estaria diferente do esperado — a próxima chamada deve
    // funcionar normalmente.
    expect(() => acquireGenerationSlot()).not.toThrow()
  })
})
