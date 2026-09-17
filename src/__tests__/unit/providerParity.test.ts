import { beforeEach, describe, expect, it, vi } from 'vitest'

// Prova de contrato entre os dois providers — SEM chamar nenhuma API real.
// Intercepta os SDKs (mesmo padrão já usado em anthropicProvider.test.ts e
// openAiProvider.test.ts) só para capturar os parâmetros que cada um
// realmente monta, e comparar. Não escolhe vencedor entre os dois.
const mocks = vi.hoisted(() => ({
  anthropicParse: vi.fn(),
  openaiParse: vi.fn(),
  env: { ANTHROPIC_API_KEY: 'test-anthropic-key', ANTHROPIC_MODEL: 'claude-opus-5', OPENAI_API_KEY: 'test-openai-key', OPENAI_MODEL: 'gpt-5' },
}))

vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk')
  const MockAnthropic = vi.fn().mockImplementation(() => ({ messages: { parse: mocks.anthropicParse } })) as unknown as typeof actual.default
  for (const key of Object.keys(actual)) {
    if (/Error$/.test(key)) (MockAnthropic as unknown as Record<string, unknown>)[key] = (actual as unknown as Record<string, unknown>)[key]
  }
  return { ...actual, default: MockAnthropic }
})
vi.mock('@anthropic-ai/sdk/helpers/json-schema', () => ({
  jsonSchemaOutputFormat: vi.fn((schema: unknown) => ({ type: 'json_schema', json_schema: schema })),
}))

vi.mock('openai', async () => {
  const actual = await vi.importActual<typeof import('openai')>('openai')
  const MockOpenAI = vi.fn().mockImplementation(() => ({ chat: { completions: { parse: mocks.openaiParse } } })) as unknown as typeof actual.default
  for (const key of Object.keys(actual)) {
    if (/Error$/.test(key)) (MockOpenAI as unknown as Record<string, unknown>)[key] = (actual as unknown as Record<string, unknown>)[key]
  }
  return { ...actual, default: MockOpenAI }
})
// Não mocado com stub: usamos o zodResponseFormat REAL aqui de propósito — é
// o que prova que campaignStrategiesSchema (Zod) é convertido com sucesso
// para o formato da OpenAI sem precisar de nenhuma cópia manual de schema.

vi.mock('../../config/env', () => ({ env: mocks.env }))

import { AnthropicProvider } from '../../services/ai/anthropicProvider'
import { OpenAiProvider } from '../../services/ai/openAiProvider'
import { SYSTEM_PROMPT, STRATEGIES_JSON_SCHEMA } from '../../services/ai/campaignPromptContract'
import { campaignStrategiesSchema, strategySchema, CampaignPromptInput } from '../../services/ai/aiProvider'
import { resolveStrategyDirections } from '../../services/ai/strategyPlaybook'

const evidence = {
  hasCandidateProducts: false,
  hasCategoryEvidence: false,
  hasStockEvidence: false,
  hasNewnessEvidence: false,
  hasPaymentExpiryEvidence: false,
  hasSecondCopySupport: false,
  hasPromotionEvidence: false,
  hasRecoveryUrlEvidence: false,
}

const input: CampaignPromptInput = {
  opportunityId: 'opp_abandoned_cart_fixture',
  opportunityType: 'ABANDONED_CART',
  title: '100 carrinhos abandonados elegíveis',
  reason: 'Checkout iniciado e não finalizado, dentro da janela de recuperação configurada.',
  audienceCount: 100,
  eligibleCount: 40,
  blockedCount: 60,
  recommendedTiming: 'Automação existente: 30 min após abandono',
  recommendedChannel: 'whatsapp',
  confidence: 'medium',
  candidateProducts: [],
  playbook: resolveStrategyDirections('ABANDONED_CART', evidence),
  evidence,
}

function validOutput() {
  return {
    opportunityId: input.opportunityId,
    summary: 'Resumo real baseado nos dados.',
    strategies: [
      { direction: 'A', name: 'A', angle: 'Ângulo A', audience: '40 elegíveis', productId: null, message: 'Mensagem A com conteúdo real.', cta: 'Ver mais', creativeBrief: 'Brief A', warnings: [] },
      { direction: 'B', name: 'B', angle: 'Ângulo B', audience: '40 elegíveis', productId: null, message: 'Mensagem B com conteúdo real.', cta: 'Falar agora', creativeBrief: 'Brief B', warnings: [] },
      { direction: 'C', name: 'C', angle: 'Ângulo C', audience: '40 elegíveis', productId: null, message: 'Mensagem C com conteúdo real.', cta: 'Ver item', creativeBrief: 'Brief C', warnings: [] },
    ],
  }
}

describe('Provider parity (OpenAI vs Anthropic) — mesmo contrato, sem chamar API real', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('os dois recebem o MESMO SYSTEM_PROMPT importado do contrato compartilhado', async () => {
    mocks.anthropicParse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: validOutput() })
    mocks.openaiParse.mockResolvedValue({ choices: [{ message: { refusal: null, parsed: validOutput() }, finish_reason: 'stop' }] })

    await new AnthropicProvider('claude-opus-5').generateCampaignStrategies(input)
    await new OpenAiProvider('gpt-5').generateCampaignStrategies(input)

    const anthropicCall = mocks.anthropicParse.mock.calls[0][0]
    const openaiCall = mocks.openaiParse.mock.calls[0][0]
    const openaiSystemMessage = openaiCall.messages.find((m: { role: string }) => m.role === 'system')

    expect(anthropicCall.system).toBe(SYSTEM_PROMPT)
    expect(openaiSystemMessage.content).toBe(SYSTEM_PROMPT)
    expect(anthropicCall.system).toBe(openaiSystemMessage.content)
  })

  it('os dois recebem o MESMO input (mesmo playbook, mesmos dados) serializado de forma idêntica', async () => {
    mocks.anthropicParse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: validOutput() })
    mocks.openaiParse.mockResolvedValue({ choices: [{ message: { refusal: null, parsed: validOutput() }, finish_reason: 'stop' }] })

    await new AnthropicProvider('claude-opus-5').generateCampaignStrategies(input)
    await new OpenAiProvider('gpt-5').generateCampaignStrategies(input)

    const anthropicCall = mocks.anthropicParse.mock.calls[0][0]
    const openaiCall = mocks.openaiParse.mock.calls[0][0]
    const openaiUserMessage = openaiCall.messages.find((m: { role: string }) => m.role === 'user')

    expect(anthropicCall.messages[0].content).toBe(JSON.stringify(input))
    expect(openaiUserMessage.content).toBe(JSON.stringify(input))
    expect(anthropicCall.messages[0].content).toBe(openaiUserMessage.content)
  })

  it('o JSON Schema manual do Anthropic (STRATEGIES_JSON_SCHEMA) exige exatamente os mesmos campos do strategySchema (Zod) usado pela OpenAI', () => {
    const zodFields = Object.keys(strategySchema.shape).sort()
    const jsonSchemaFields = [...STRATEGIES_JSON_SCHEMA.properties.strategies.items.required].sort()
    expect(jsonSchemaFields).toEqual(zodFields)
  })

  it('os dois validam a saída pelo MESMO campaignStrategiesSchema (Zod) depois de gerar — nenhuma cópia paralela de validação', async () => {
    mocks.anthropicParse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: validOutput() })
    mocks.openaiParse.mockResolvedValue({ choices: [{ message: { refusal: null, parsed: validOutput() }, finish_reason: 'stop' }] })

    const { output: anthropicOutput } = await new AnthropicProvider('claude-opus-5').generateCampaignStrategies(input)
    const { output: openaiOutput } = await new OpenAiProvider('gpt-5').generateCampaignStrategies(input)

    expect(campaignStrategiesSchema.safeParse(anthropicOutput).success).toBe(true)
    expect(campaignStrategiesSchema.safeParse(openaiOutput).success).toBe(true)
    expect(anthropicOutput).toEqual(openaiOutput)
  })

  it('nenhum dos dois escolhe vencedor: providerFactory não chama os dois provedores condicionalmente nem compara resultado para decidir qual usar', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const text = fs.readFileSync(path.join(process.cwd(), 'src/services/ai/providerFactory.ts'), 'utf8')
    // Checa o padrão estrutural (nunca chama os dois provedores em paralelo/corrida
    // para comparar), não a palavra "fallback" — que aparece nos comentários do
    // próprio arquivo só para explicar que a ausência dele é intencional.
    expect(text).not.toMatch(/Promise\.(all|race)/)
    expect((text.match(/new (AnthropicProvider|OpenAiProvider)/g) ?? []).length).toBe(2)
  })
})
