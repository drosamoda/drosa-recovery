import { beforeEach, describe, expect, it, vi } from 'vitest'

// Contrato de IA para e-mail — SEM chamar nenhuma API real (Groq/OpenAI/Anthropic
// interceptados). Mesmo padrão de providerParity.test.ts; o zodResponseFormat é o
// REAL de propósito (prova que o schema de e-mail converte para o formato da OpenAI).
const mocks = vi.hoisted(() => ({
  anthropicParse: vi.fn(),
  openaiParse: vi.fn(),
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key', ANTHROPIC_MODEL: 'claude-opus-5',
    OPENAI_API_KEY: 'test-openai-key', OPENAI_MODEL: 'gpt-5',
    GROQ_API_KEY: 'test-groq-key', GROQ_MODEL: 'openai/gpt-oss-120b', GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
    AI_REQUEST_TIMEOUT_MS: 30000, AI_MAX_OUTPUT_TOKENS: 4096,
  },
}))

vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk')
  const MockAnthropic = vi.fn().mockImplementation(() => ({ messages: { parse: mocks.anthropicParse } })) as unknown as typeof actual.default
  for (const key of Object.keys(actual)) if (/Error$/.test(key)) (MockAnthropic as unknown as Record<string, unknown>)[key] = (actual as unknown as Record<string, unknown>)[key]
  return { ...actual, default: MockAnthropic }
})
vi.mock('@anthropic-ai/sdk/helpers/json-schema', () => ({ jsonSchemaOutputFormat: vi.fn((schema: unknown) => ({ type: 'json_schema', json_schema: schema })) }))
vi.mock('openai', async () => {
  const actual = await vi.importActual<typeof import('openai')>('openai')
  const MockOpenAI = vi.fn().mockImplementation(() => ({ chat: { completions: { parse: mocks.openaiParse } } })) as unknown as typeof actual.default
  for (const key of Object.keys(actual)) if (/Error$/.test(key)) (MockOpenAI as unknown as Record<string, unknown>)[key] = (actual as unknown as Record<string, unknown>)[key]
  return { ...actual, default: MockOpenAI }
})
vi.mock('../../config/env', () => ({ env: mocks.env }))

import { AnthropicProvider } from '../../services/ai/anthropicProvider'
import { OpenAiProvider } from '../../services/ai/openAiProvider'
import { GroqProvider } from '../../services/ai/groqProvider'
import {
  AiProviderResponseError,
  CampaignPromptInput,
  EmailCampaignPromptInput,
  campaignStrategiesSchema,
  emailCampaignStrategiesSchema,
  emailStrategySchema,
  isEmailStrategy,
  strategyText,
} from '../../services/ai/aiProvider'
import { EMAIL_PROMPT_VERSION, EMAIL_STRATEGIES_JSON_SCHEMA, EMAIL_SYSTEM_PROMPT, PROMPT_VERSION, STRATEGIES_JSON_SCHEMA, SYSTEM_PROMPT, promptVersionFor, systemPromptFor } from '../../services/ai/campaignPromptContract'
import { resolveStrategyDirections } from '../../services/ai/strategyPlaybook'

const evidence = { hasCandidateProducts: false, hasCategoryEvidence: false, hasStockEvidence: false, hasNewnessEvidence: false, hasPaymentExpiryEvidence: false, hasSecondCopySupport: false, hasPromotionEvidence: false, hasRecoveryUrlEvidence: false }

const emailInput: EmailCampaignPromptInput = {
  channel: 'email',
  opportunityId: 'opp_email_lapsed_61_90d_2026-09-19',
  opportunityType: 'EMAIL_LAPSED_61_90',
  segment: { key: 'LAPSED_61_90D', name: 'Sem comprar há 61–90 dias', description: 'Última compra paga válida entre 61 e 90 dias.', audienceCount: 2431, withValidEmailCount: 2400 },
  campaign: { key: 'WINBACK_61_90', name: 'Reativação: novidades desde a última compra', objective: 'Reengajar quem está esfriando', category: 'REACTIVATION', funnelStage: 'REACTIVATION', recommendedCooldownDays: 21 },
  sendEligibility: 'EMAIL_CONSENT_SOURCE_NOT_CONFIGURED',
  dataQualityFlags: [],
  candidateProducts: [], purchasedProducts: [], cartProducts: [],
  playbook: [
    { key: 'A', label: 'NOVIDADE', intent: 'Apresentar novidade real.', guidance: 'Reabra contato sem afirmar novidade.', degraded: true, requiredWarning: 'Direção degradada: nenhuma evidência comprovada de novidade.' },
    { key: 'B', label: 'RELEMBRE A DROSA', intent: 'Reforçar a marca.', guidance: 'Reforce a marca.', degraded: false, requiredWarning: null },
    { key: 'C', label: 'CONVERSA', intent: 'Abrir conversa.', guidance: 'Pergunte o que a cliente gostaria de encontrar.', degraded: false, requiredWarning: null },
  ],
  evidence,
}

function emailStrategy(direction: 'A' | 'B' | 'C', extra: Record<string, unknown> = {}) {
  return {
    direction, name: `Estratégia ${direction}`, angle: `Ângulo ${direction}`, audience: 'Clientes sem comprar há 61–90 dias', productId: null,
    subject: `Assunto ${direction}`, preheader: `Preheader complementar ${direction}`, headline: `Título ${direction}`,
    body: `Corpo do e-mail ${direction} com conteúdo real e útil para a cliente conhecer o catálogo atual da D'Rosa com calma.`,
    cta: 'Conhecer o catálogo', creativeBrief: `Brief ${direction}`, warnings: [], ...extra,
  }
}
const validEmailOutput = () => ({ opportunityId: emailInput.opportunityId, summary: 'Resumo.', strategies: [emailStrategy('A'), emailStrategy('B'), emailStrategy('C')] })
const openaiOk = (parsed: unknown) => ({ choices: [{ message: { refusal: null, parsed }, finish_reason: 'stop' }] })
const anthropicOk = (parsed: unknown) => ({ stop_reason: 'end_turn', parsed_output: parsed })

const whatsappInput: CampaignPromptInput = {
  opportunityId: 'opp_recent_customer_2026-09-19', opportunityType: 'RECENT_CUSTOMER', title: 't', reason: 'r', audienceCount: 10, eligibleCount: 8, blockedCount: 2,
  recommendedTiming: 'x', recommendedChannel: 'whatsapp', confidence: 'medium', candidateProducts: [], purchasedProducts: [], cartProducts: [],
  playbook: resolveStrategyDirections('RECENT_CUSTOMER', evidence), evidence,
}
const whatsappOutput = () => ({
  opportunityId: whatsappInput.opportunityId, summary: 's',
  strategies: (['A', 'B', 'C'] as const).map(direction => ({ direction, name: direction, angle: 'a', audience: 'a', productId: null, message: `Mensagem ${direction}`, cta: 'x', creativeBrief: 'x', warnings: [] })),
})

describe('schema de e-mail (Zod) — subject/preheader/headline/body/cta, exatamente 3 estratégias', () => {
  it('aceita a saída válida e expõe todos os campos de e-mail', () => {
    const parsed = emailCampaignStrategiesSchema.safeParse(validEmailOutput())
    expect(parsed.success).toBe(true)
    for (const field of ['subject', 'preheader', 'headline', 'body', 'cta', 'direction', 'name', 'angle', 'audience', 'productId', 'creativeBrief', 'warnings']) {
      expect(Object.keys(emailStrategySchema.shape)).toContain(field)
    }
    expect(Object.keys(emailStrategySchema.shape)).not.toContain('message')
  })

  it.each(['subject', 'preheader', 'headline', 'body', 'cta'])('rejeita estratégia sem %s (ou vazio)', field => {
    const strategies = [emailStrategy('A'), emailStrategy('B'), emailStrategy('C')]
    ;(strategies[1] as Record<string, unknown>)[field] = ''
    expect(emailCampaignStrategiesSchema.safeParse({ ...validEmailOutput(), strategies }).success).toBe(false)
    delete (strategies[1] as Record<string, unknown>)[field]
    expect(emailCampaignStrategiesSchema.safeParse({ ...validEmailOutput(), strategies }).success).toBe(false)
  })

  it('exige exatamente 3 estratégias', () => {
    expect(emailCampaignStrategiesSchema.safeParse({ ...validEmailOutput(), strategies: [emailStrategy('A'), emailStrategy('B')] }).success).toBe(false)
    expect(emailCampaignStrategiesSchema.safeParse({ ...validEmailOutput(), strategies: [emailStrategy('A'), emailStrategy('B'), emailStrategy('C'), emailStrategy('A')] }).success).toBe(false)
  })

  it('o JSON Schema manual do Anthropic exige exatamente os campos do schema Zod de e-mail (paridade)', () => {
    expect([...EMAIL_STRATEGIES_JSON_SCHEMA.properties.strategies.items.required].sort()).toEqual(Object.keys(emailStrategySchema.shape).sort())
    // e o de WhatsApp continua igual ao dele
    expect(STRATEGIES_JSON_SCHEMA.properties.strategies.items.required).not.toContain('subject')
  })

  it('isEmailStrategy/strategyText distinguem os canais e nunca perdem um campo de e-mail', () => {
    const email = emailStrategySchema.parse(emailStrategy('A'))
    expect(isEmailStrategy(email)).toBe(true)
    const text = strategyText(email)
    for (const part of [email.subject, email.preheader, email.headline, email.body]) expect(text).toContain(part)
    const whatsapp = campaignStrategiesSchema.parse(whatsappOutput()).strategies[0]
    expect(isEmailStrategy(whatsapp)).toBe(false)
    expect(strategyText(whatsapp)).toBe(whatsapp.message)
  })
})

describe('prompt de e-mail — mesmas regras absolutas + regras do canal', () => {
  it('mantém TODAS as regras do prompt base (e-mail não ganha exceção) e acrescenta as do canal', () => {
    expect(EMAIL_SYSTEM_PROMPT.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(EMAIL_SYSTEM_PROMPT.length).toBeGreaterThan(SYSTEM_PROMPT.length)
    for (const rule of ['subject', 'preheader', 'headline', 'body', 'cta', 'urgência falsa', 'NUNCA é prova', 'descadastro', 'tamanho da audiência']) {
      expect(EMAIL_SYSTEM_PROMPT).toContain(rule)
    }
    expect(EMAIL_SYSTEM_PROMPT).toMatch(/nunca invente desconto, cupom, frete grátis/i)
  })

  it('seleção por canal: whatsapp/ausente = contrato anterior inalterado; email = prompt e versão próprios', () => {
    expect(systemPromptFor('whatsapp')).toBe(SYSTEM_PROMPT)
    expect(systemPromptFor(undefined)).toBe(SYSTEM_PROMPT)
    expect(systemPromptFor('email')).toBe(EMAIL_SYSTEM_PROMPT)
    expect(promptVersionFor('whatsapp')).toBe(PROMPT_VERSION)
    expect(promptVersionFor('email')).toBe(EMAIL_PROMPT_VERSION)
    expect(EMAIL_PROMPT_VERSION).not.toBe(PROMPT_VERSION)
  })
})

const providers: Array<[string, () => { generateCampaignStrategies: (i: EmailCampaignPromptInput | CampaignPromptInput) => Promise<{ output: unknown; rawOutputText: string }> }, 'openai' | 'anthropic']> = [
  ['OpenAI', () => new OpenAiProvider('gpt-5'), 'openai'],
  ['Groq', () => new GroqProvider('openai/gpt-oss-120b'), 'openai'],
  ['Anthropic', () => new AnthropicProvider('claude-opus-5'), 'anthropic'],
]

describe.each(providers)('%s — pipeline único, canal e-mail', (_name, make, family) => {
  beforeEach(() => { vi.clearAllMocks() })
  const respond = (parsed: unknown) => (family === 'openai' ? mocks.openaiParse.mockResolvedValue(openaiOk(parsed)) : mocks.anthropicParse.mockResolvedValue(anthropicOk(parsed)))
  const callArgs = () => (family === 'openai' ? mocks.openaiParse.mock.calls[0][0] : mocks.anthropicParse.mock.calls[0][0])
  const systemSent = () => (family === 'openai' ? callArgs().messages.find((m: { role: string }) => m.role === 'system').content : callArgs().system)
  const userSent = (): string => (family === 'openai' ? callArgs().messages.find((m: { role: string }) => m.role === 'user').content : callArgs().messages[0].content)

  it('usa o prompt de e-mail e o schema de e-mail (não os de WhatsApp) e devolve as 3 estratégias validadas', async () => {
    respond(validEmailOutput())
    const { output } = await make().generateCampaignStrategies(emailInput)
    expect(systemSent()).toBe(EMAIL_SYSTEM_PROMPT)
    if (family === 'openai') expect(callArgs().response_format.json_schema.name).toBe('email_campaign_strategies')
    else expect(callArgs().output_config.format.json_schema).toEqual(EMAIL_STRATEGIES_JSON_SCHEMA)
    const strategies = (output as { strategies: Array<Record<string, unknown>> }).strategies
    expect(strategies).toHaveLength(3)
    for (const s of strategies) for (const field of ['subject', 'preheader', 'headline', 'body', 'cta']) expect(typeof s[field]).toBe('string')
  })

  it('envia EXATAMENTE o input agregado, sem nenhum dado pessoal (NO_PII_TO_AI)', async () => {
    respond(validEmailOutput())
    await make().generateCampaignStrategies(emailInput)
    const sent = userSent()
    expect(sent).toBe(JSON.stringify(emailInput))
    expect(sent).not.toMatch(/@/)
    // Só CHAVES de dado pessoal (o valor "email" de channel é legítimo).
    expect(sent.toLowerCase()).not.toMatch(/"(e-?mail|emails|customeremail|phone|telefone|normalizedphone|customerid|customername|customer|orderid|ordernumber|cpf)"\s*:/)
    expect(sent).not.toMatch(/\+?55\s*\d{2}\s*9?\d{4}-?\d{4}/)
    const parsed = JSON.parse(sent)
    expect(Object.keys(parsed).sort()).toEqual(['campaign', 'candidateProducts', 'channel', 'cartProducts', 'dataQualityFlags', 'evidence', 'opportunityId', 'opportunityType', 'playbook', 'purchasedProducts', 'segment', 'sendEligibility'].sort())
    expect(Object.keys(parsed.segment).sort()).toEqual(['audienceCount', 'description', 'key', 'name', 'withValidEmailCount'])
  })

  it('fail-closed: saída no formato de WhatsApp (message) para um input de e-mail é REJEITADA pela validação de schema', async () => {
    respond(whatsappOutput())
    await expect(make().generateCampaignStrategies(emailInput)).rejects.toThrow(AiProviderResponseError)
  })

  it('fail-closed: falta de preheader, ou menos de 3 estratégias, é rejeitada', async () => {
    const noPreheader = validEmailOutput()
    delete (noPreheader.strategies[0] as Record<string, unknown>).preheader
    respond(noPreheader)
    await expect(make().generateCampaignStrategies(emailInput)).rejects.toThrow(AiProviderResponseError)
    respond({ ...validEmailOutput(), strategies: [emailStrategy('A'), emailStrategy('B')] })
    await expect(make().generateCampaignStrategies(emailInput)).rejects.toThrow(AiProviderResponseError)
  })

  it('WhatsApp continua exatamente como antes: SYSTEM_PROMPT, schema campaign_strategies e validação por message', async () => {
    respond(whatsappOutput())
    const { output } = await make().generateCampaignStrategies(whatsappInput)
    expect(systemSent()).toBe(SYSTEM_PROMPT)
    if (family === 'openai') expect(callArgs().response_format.json_schema.name).toBe('campaign_strategies')
    else expect(callArgs().output_config.format.json_schema).toEqual(STRATEGIES_JSON_SCHEMA)
    expect((output as { strategies: Array<{ message: string }> }).strategies[0].message).toBe('Mensagem A')
  })

  it('e-mail nunca cai em fallback para outro provider: cada instância chama só o próprio SDK', async () => {
    respond(validEmailOutput())
    await make().generateCampaignStrategies(emailInput)
    if (family === 'openai') expect(mocks.anthropicParse).not.toHaveBeenCalled()
    else expect(mocks.openaiParse).not.toHaveBeenCalled()
  })
})
