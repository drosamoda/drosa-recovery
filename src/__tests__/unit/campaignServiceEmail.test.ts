import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  campaignDraftCreate: vi.fn(),
  campaignDraftUpdate: vi.fn(),
  campaignDraftFindUnique: vi.fn(),
  aiRunCreate: vi.fn(),
  getOpportunityById: vi.fn(),
  getAiProvider: vi.fn(),
  enrichOpportunityEvidence: vi.fn(),
  getAiPrisma: vi.fn(),
  verifyMetaTemplateContract: vi.fn(),
  productVerify: vi.fn(),
}))

vi.mock('../../config/aiPrisma', () => {
  class AiDatabaseNotConfiguredError extends Error {}
  return { getAiPrisma: mocks.getAiPrisma, AiDatabaseNotConfiguredError }
})
vi.mock('../../config/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))
vi.mock('../../services/aiOpportunityEngine', () => ({ getOpportunityById: mocks.getOpportunityById }))
vi.mock('../../services/ai/providerFactory', () => ({ getAiProvider: mocks.getAiProvider }))
vi.mock('../../services/productTruthService', () => ({ productTruthService: { verify: mocks.productVerify } }))
vi.mock('../../services/campaignEvidenceService', () => ({ enrichOpportunityEvidence: mocks.enrichOpportunityEvidence }))
vi.mock('../../services/templateContracts', () => ({ verifyMetaTemplateContract: mocks.verifyMetaTemplateContract }))

import { campaignService, CampaignNotFoundError, EmailCampaignNotAllowedError } from '../../services/ai/campaignService'
import { EmailSendNotAvailableError, evaluateEmailSendGate } from '../../services/emailSendGate'
import { EMAIL_PROMPT_VERSION } from '../../services/ai/campaignPromptContract'

function emailOpportunity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'opp_email_lapsed_61_90d_2026-09-19', channel: 'email' as const, type: 'EMAIL_LAPSED_61_90' as const, segmentKey: 'LAPSED_61_90D' as const,
    title: '2431 clientes: Sem comprar há 61–90 dias', reason: 'Última compra paga válida entre 61 e 90 dias.',
    audienceCount: 2431, withValidEmailCount: 2400, sendEligibleCount: null, eligibleCount: null, blockedCount: 31,
    eligibilityStatus: 'EMAIL_CONSENT_SOURCE_NOT_CONFIGURED' as const, recommendedTiming: 'x', recommendedChannel: 'email' as const, recommendedProduct: null,
    confidence: 'medium' as const, recommendedCampaignKeys: ['WINBACK_61_90', 'CATALOG_DISCOVERY'],
    cooldown: { days: 21, status: 'NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY' },
    evidence: { topBlockers: [{ reason: 'INVALID_EMAIL', count: 31 }], dataQuality: { level: 'PARTIAL', notes: ['31 com e-mail em formato inválido.'], consentSourceConfigured: false } },
    generatedAt: '2026-09-19T12:00:00.000Z', ...overrides,
  }
}

const emailStrategy = (direction: 'A' | 'B' | 'C', extra: Record<string, unknown> = {}) => ({
  direction, name: `Estratégia ${direction}`, angle: `Ângulo distinto da estratégia ${direction} sobre ${direction === 'A' ? 'reconexão' : direction === 'B' ? 'marca e bastidores' : 'conversa com a equipe'}`,
  audience: 'Clientes sem comprar há 61–90 dias', productId: null,
  subject: direction === 'A' ? 'Sentimos a sua falta por aqui' : direction === 'B' ? 'Um pouco sobre a nossa história' : 'Podemos ajudar você a escolher?',
  preheader: direction === 'A' ? 'Passe quando tiver um tempinho para conferir' : direction === 'B' ? 'Bastidores de quem faz a marca com carinho' : 'Nossa equipe responde com atenção total',
  headline: `Título distinto ${direction}`,
  body: direction === 'A'
    ? 'Faz um tempinho que não nos falamos e queríamos dizer que estamos por aqui. Se quiser conhecer o catálogo atual, ele está a um clique de você, sem pressa nenhuma e sem compromisso algum.'
    : direction === 'B'
      ? 'Somos uma marca pensada com carinho para mulheres reais e cada detalhe é escolhido pelo nosso time com muito cuidado. Queremos que você se sinta bem em cada ocasião da sua rotina inteira.'
      : 'Conte para nós o que você procura ultimamente e a equipe responde com atenção, ajudando a encontrar exatamente o que faz sentido para o seu momento e o seu estilo pessoal de vestir.',
  cta: direction === 'A' ? 'Conhecer o catálogo' : direction === 'B' ? 'Ver nossa história' : 'Falar com a equipe',
  creativeBrief: `Brief criativo da direção ${direction}`, warnings: direction === 'A' ? ['Direção degradada: nenhuma evidência comprovada de novidade.'] : [], ...extra,
})

function provider(strategies = [emailStrategy('A'), emailStrategy('B'), emailStrategy('C')]) {
  return {
    name: 'groq', model: 'openai/gpt-oss-120b', assertConfigured: vi.fn(),
    generateCampaignStrategies: vi.fn().mockResolvedValue({ output: { opportunityId: 'opp_email_lapsed_61_90d_2026-09-19', summary: 's', strategies }, rawOutputText: '{}' }),
  }
}

function aiPrismaStub() {
  return { campaignDraft: { create: mocks.campaignDraftCreate, update: mocks.campaignDraftUpdate, findUnique: mocks.campaignDraftFindUnique }, aiRun: { create: mocks.aiRunCreate } }
}

const KEY = 'PREVIEW-EMAIL-TEST-00000001'

describe('campaignService — pipeline de e-mail (mesmo pipeline do WhatsApp)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAiPrisma.mockReturnValue(aiPrismaStub())
    mocks.campaignDraftFindUnique.mockResolvedValue(null)
    mocks.campaignDraftCreate.mockResolvedValue({ id: 'draft_email_1' })
    mocks.campaignDraftUpdate.mockImplementation(async ({ data }) => ({ id: 'draft_email_1', status: data.status ?? 'DRAFT' }))
    mocks.aiRunCreate.mockResolvedValue({})
    mocks.productVerify.mockResolvedValue({ verified: false, product: null })
    mocks.getOpportunityById.mockResolvedValue(emailOpportunity())
  })

  it('gera as 3 estratégias de e-mail e persiste channel=EMAIL com segmento/campanha só como agregados', async () => {
    const p = provider(); mocks.getAiProvider.mockReturnValue(p)
    const result = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
    expect(result.strategies).toHaveLength(3)
    for (const s of result.strategies as Array<Record<string, unknown>>) for (const field of ['subject', 'preheader', 'headline', 'body', 'cta']) expect(typeof s[field]).toBe('string')

    const created = mocks.campaignDraftCreate.mock.calls[0][0].data
    expect(created.channel).toBe('EMAIL')
    expect(created.opportunityType).toBe('EMAIL_LAPSED_61_90')
    expect(created.idempotencyKey).toBe(KEY)
    expect(created.audienceSnapshot).toEqual(expect.objectContaining({
      channel: 'email', segmentKey: 'LAPSED_61_90D', campaignKey: 'WINBACK_61_90', audienceCount: 2431, withValidEmailCount: 2400, sendEligibleCount: null, eligibilityStatus: 'EMAIL_CONSENT_SOURCE_NOT_CONFIGURED',
    }))
    // a IA nunca aprova a própria campanha: fica aguardando aprovação humana (ou DRAFT se houve bloqueio)
    const updated = mocks.campaignDraftUpdate.mock.calls[0][0].data
    expect(['AWAITING_HUMAN_APPROVAL', 'DRAFT']).toContain(updated.status)
    expect(updated.status).not.toBe('APPROVED')
  })

  it('usa o mesmo pipeline seguro: Product Truth, compliance, rubrica de e-mail e registro de AiRun com versão de prompt de e-mail', async () => {
    mocks.getAiProvider.mockReturnValue(provider())
    await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
    expect(mocks.productVerify).toHaveBeenCalledTimes(3)
    const run = mocks.aiRunCreate.mock.calls[0][0].data
    expect(run).toEqual(expect.objectContaining({ provider: 'groq', model: 'openai/gpt-oss-120b', promptVersion: EMAIL_PROMPT_VERSION, status: 'ok' }))
    const saved = mocks.campaignDraftUpdate.mock.calls[0][0].data
    const criteria = (saved.strategies[0].qualityRubric as Array<{ criterion: string }>).map(r => r.criterion)
    expect(criteria).toEqual(expect.arrayContaining(['Email subject', 'Email preheader', 'Email suitability']))
    expect(criteria).not.toContain('WhatsApp suitability')
    expect(saved.complianceStatus).toBe('APPROVED')
  })

  it('NO_PII_TO_AI: o input enviado ao provedor é só agregado — sem e-mail, nome, telefone, id de cliente ou pedido', async () => {
    const p = provider(); mocks.getAiProvider.mockReturnValue(p)
    await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
    const input = p.generateCampaignStrategies.mock.calls[0][0]
    expect(input.channel).toBe('email')
    const serialized = JSON.stringify(input)
    expect(serialized).not.toMatch(/@/)
    expect(serialized.toLowerCase()).not.toMatch(/"(e-?mail|emails|customeremail|phone|telefone|normalizedphone|customerid|customername|customer|orderid|ordernumber|cpf)"\s*:/)
    expect(serialized).not.toMatch(/\d{8,}/) // nenhuma sequência longa de dígitos (telefone/pedido/cpf)
    expect(input.segment).toEqual({ key: 'LAPSED_61_90D', name: 'Sem comprar há 61–90 dias', description: 'Última compra paga válida entre 61 e 90 dias.', audienceCount: 2431, withValidEmailCount: 2400 })
    expect(input.candidateProducts).toEqual([])
    expect(input.evidence.hasNewnessEvidence).toBe(false)
    expect(input.sendEligibility).toBe('EMAIL_CONSENT_SOURCE_NOT_CONFIGURED')
    // direções vêm da biblioteca (backend), degradadas quando falta evidência
    expect(input.playbook.map((d: { key: string }) => d.key)).toEqual(['A', 'B', 'C'])
    expect(input.playbook[0].degraded).toBe(true)
  })

  it('não usa a evidência/elegibilidade do WhatsApp: enrichOpportunityEvidence e Meta template nunca são chamados para e-mail', async () => {
    mocks.getAiProvider.mockReturnValue(provider())
    await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
    expect(mocks.enrichOpportunityEvidence).not.toHaveBeenCalled()
    expect(mocks.verifyMetaTemplateContract).not.toHaveBeenCalled()
  })

  it('sem campaignKey usa a primeira campanha ACIONÁVEL recomendada pelo backend (nunca a IA)', async () => {
    mocks.getAiProvider.mockReturnValue(provider())
    await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY)
    expect(mocks.campaignDraftCreate.mock.calls[0][0].data.audienceSnapshot.campaignKey).toBe('WINBACK_61_90')
  })

  describe('fail-closed ANTES de qualquer escrita ou chamada paga', () => {
    const expectNoSideEffects = (p: ReturnType<typeof provider>) => {
      expect(mocks.campaignDraftCreate).not.toHaveBeenCalled()
      expect(mocks.aiRunCreate).not.toHaveBeenCalled()
      expect(p.generateCampaignStrategies).not.toHaveBeenCalled()
    }

    it('campanha NEEDS_DATA (novidade sem prova) => 422-equivalente, nenhum draft, nenhuma chamada à IA', async () => {
      const p = provider(); mocks.getAiProvider.mockReturnValue(p)
      const error = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'NEW_ARRIVALS' }).catch(e => e)
      expect(error).toBeInstanceOf(EmailCampaignNotAllowedError)
      expect(error.code).toBe('EMAIL_CAMPAIGN_NEEDS_DATA')
      expect(error.message).toContain('NEWNESS_EVIDENCE')
      expectNoSideEffects(p)
    })

    it('campanha fora do segmento permitido => EMAIL_CAMPAIGN_SEGMENT_MISMATCH', async () => {
      const p = provider(); mocks.getAiProvider.mockReturnValue(p)
      const error = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'SECOND_PURCHASE' }).catch(e => e)
      expect(error).toBeInstanceOf(EmailCampaignNotAllowedError)
      expect(error.code).toBe('EMAIL_CAMPAIGN_SEGMENT_MISMATCH')
      expectNoSideEffects(p)
    })

    it('campanha desconhecida => EMAIL_CAMPAIGN_UNKNOWN', async () => {
      const p = provider(); mocks.getAiProvider.mockReturnValue(p)
      const error = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'INVENTADA' }).catch(e => e)
      expect(error.code).toBe('EMAIL_CAMPAIGN_UNKNOWN')
      expectNoSideEffects(p)
    })

    it('segmento sem nenhuma campanha acionável e sem campaignKey => EMAIL_NO_ACTIONABLE_CAMPAIGN', async () => {
      const p = provider(); mocks.getAiProvider.mockReturnValue(p)
      mocks.getOpportunityById.mockResolvedValue(emailOpportunity({ recommendedCampaignKeys: [] }))
      const error = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY).catch(e => e)
      expect(error.code).toBe('EMAIL_NO_ACTIONABLE_CAMPAIGN')
      expectNoSideEffects(p)
    })

    it('oportunidade inexistente => CampaignNotFoundError, sem efeitos', async () => {
      const p = provider(); mocks.getAiProvider.mockReturnValue(p)
      mocks.getOpportunityById.mockResolvedValue(null)
      await expect(campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2020-01-01', KEY, { campaignKey: 'WINBACK_61_90' })).rejects.toBeInstanceOf(CampaignNotFoundError)
      expectNoSideEffects(p)
    })

    it('provedor de IA não configurado => falha rápido, sem draft órfão', async () => {
      const p = provider(); p.assertConfigured.mockImplementation(() => { throw new Error('GROQ_API_KEY ausente') })
      mocks.getAiProvider.mockReturnValue(p)
      await expect(campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })).rejects.toThrow('GROQ_API_KEY')
      expectNoSideEffects(p)
    })
  })

  it('saída inválida do provedor (schema) NUNCA vira campanha: erro categorizado e AiRun de erro', async () => {
    const p = provider(); p.generateCampaignStrategies.mockRejectedValue(new (await import('../../services/ai/aiProvider')).AiProviderResponseError('Saída da IA não passou na validação de schema: x'))
    mocks.getAiProvider.mockReturnValue(p)
    await expect(campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })).rejects.toThrow()
    expect(mocks.aiRunCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ status: 'error', errorMessage: 'AI_SCHEMA_ERROR', promptVersion: EMAIL_PROMPT_VERSION }))
    expect(mocks.campaignDraftUpdate).not.toHaveBeenCalled()
  })

  it('compliance bloqueia alegação inventada em e-mail: estratégia BLOCKED, draft não vai para aprovação humana', async () => {
    mocks.getAiProvider.mockReturnValue(provider([emailStrategy('A', { subject: 'Última chance: brinde grátis!' }), emailStrategy('B'), emailStrategy('C')]))
    const result = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
    const strategies = result.strategies as unknown as Array<{ status: string; findings: Array<{ claim: string }> }>
    expect(strategies[0].status).toBe('BLOCKED')
    expect(strategies[0].findings.length).toBeGreaterThan(0)
    expect(strategies[1].status).toBe('OK')
    expect(result.status).toBe('DRAFT')
    expect(mocks.campaignDraftUpdate.mock.calls[0][0].data.complianceStatus).toBe('BLOCKED')
  })

  describe('idempotência (mesmo mecanismo do WhatsApp)', () => {
    it('mesma idempotencyKey: devolve o draft existente e NÃO chama a IA de novo', async () => {
      const p = provider(); mocks.getAiProvider.mockReturnValue(p)
      mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_email_1', status: 'AWAITING_HUMAN_APPROVAL', strategies: [emailStrategy('A'), emailStrategy('B'), emailStrategy('C')], complianceFindings: [] })
      const result = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
      expect(result.id).toBe('draft_email_1')
      expect(p.generateCampaignStrategies).not.toHaveBeenCalled()
      expect(mocks.campaignDraftCreate).not.toHaveBeenCalled()
      expect(mocks.getOpportunityById).not.toHaveBeenCalled()
    })

    it('corrida (P2002): a requisição perdedora recupera o draft vencedor e não chama a IA', async () => {
      const p = provider(); mocks.getAiProvider.mockReturnValue(p)
      mocks.campaignDraftFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'draft_winner', status: 'DRAFT', strategies: null, complianceFindings: null })
      mocks.campaignDraftCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }))
      const result = await campaignService.createFromOpportunity('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
      expect(result.id).toBe('draft_winner')
      expect(p.generateCampaignStrategies).not.toHaveBeenCalled()
    })
  })

  describe('agendamento de e-mail FAIL-CLOSED (nenhum envio real existe)', () => {
    it('schedule() de draft de e-mail APPROVED lança EmailSendNotAvailableError e nunca atualiza para SCHEDULED', async () => {
      mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_email_1', channel: 'EMAIL', status: 'APPROVED', opportunityType: 'EMAIL_LAPSED_61_90' })
      const error = await campaignService.schedule('draft_email_1').catch(e => e)
      expect(error).toBeInstanceOf(EmailSendNotAvailableError)
      expect(error.missing).toEqual(expect.arrayContaining(['EMAIL_PROVIDER_NOT_CONFIGURED', 'EMAIL_MARKETING_CONSENT_SOURCE_NOT_CONFIGURED', 'EMAIL_UNSUBSCRIBE_SUPPRESSION_NOT_IMPLEMENTED', 'EMAIL_SEND_DISABLED']))
      expect(mocks.campaignDraftUpdate).not.toHaveBeenCalled()
      expect(mocks.verifyMetaTemplateContract).not.toHaveBeenCalled()
    })

    it('schedule() de WhatsApp continua exigindo o template Meta aprovado (contrato anterior intacto)', async () => {
      mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'draft_wa_1', channel: 'WHATSAPP', status: 'APPROVED', opportunityType: 'RECENT_CUSTOMER' })
      mocks.verifyMetaTemplateContract.mockResolvedValue('template_pendente')
      await expect(campaignService.schedule('draft_wa_1')).rejects.toThrow(/aprovação confirmada/)
      expect(mocks.verifyMetaTemplateContract).toHaveBeenCalled()
      expect(mocks.campaignDraftUpdate).not.toHaveBeenCalled()
    })

    it('draft de e-mail que ainda não foi aprovado por um humano nem chega ao gate', async () => {
      mocks.campaignDraftFindUnique.mockResolvedValue({ id: 'd', channel: 'EMAIL', status: 'AWAITING_HUMAN_APPROVAL', opportunityType: 'EMAIL_LAPSED_61_90' })
      await expect(campaignService.schedule('d')).rejects.toThrow(/exige status APPROVED/)
    })
  })

  it('WhatsApp NÃO mudou: sem canal de e-mail o draft é gravado como WHATSAPP com o snapshot antigo e o playbook de WhatsApp', async () => {
    const p = provider([{ direction: 'A', name: 'A', angle: 'a', audience: 'a', productId: null, message: 'Mensagem A real e suficiente.', cta: 'x', creativeBrief: 'x', warnings: [] } as never, { direction: 'B', name: 'B', angle: 'bbb', audience: 'b', productId: null, message: 'Outra mensagem completamente diferente B.', cta: 'y', creativeBrief: 'yy', warnings: [] } as never, { direction: 'C', name: 'C', angle: 'ccc', audience: 'c', productId: null, message: 'Terceira mensagem bem distinta C aqui.', cta: 'z', creativeBrief: 'zz', warnings: [] } as never])
    mocks.getAiProvider.mockReturnValue(p)
    mocks.getOpportunityById.mockResolvedValue({
      id: 'opp_recent_customer_2026-09-19', type: 'RECENT_CUSTOMER', title: '10 clientes recentes', reason: 'x', audienceCount: 10, eligibleCount: 8, blockedCount: 2,
      recommendedTiming: 'x', recommendedChannel: 'whatsapp', recommendedProduct: null, confidence: 'medium',
      evidence: { topBlockers: [], dataQuality: { historyTruncated: false, consentSourceConfigured: true, metaTemplatesVerified: true }, template: 'x' }, generatedAt: '2026-09-19T12:00:00.000Z',
    })
    mocks.enrichOpportunityEvidence.mockResolvedValue({ candidateProducts: [], purchasedProducts: [], cartProducts: [], evidenceFlags: { hasCandidateProducts: false, hasCategoryEvidence: false, hasStockEvidence: false, hasNewnessEvidence: false, hasPaymentExpiryEvidence: false, hasSecondCopySupport: false, hasPromotionEvidence: false, hasRecoveryUrlEvidence: false }, evidenceSources: [] })
    await campaignService.createFromOpportunity('opp_recent_customer_2026-09-19', 'wa-key-00000001')
    const created = mocks.campaignDraftCreate.mock.calls[0][0].data
    expect(created.channel).toBe('WHATSAPP')
    expect(created.audienceSnapshot).toEqual(expect.objectContaining({ audienceCount: 10, eligibleCount: 8, blockedCount: 2 }))
    expect(created.audienceSnapshot.channel).toBeUndefined()
    expect(mocks.enrichOpportunityEvidence).toHaveBeenCalledTimes(1)
    expect(p.generateCampaignStrategies.mock.calls[0][0].channel).toBeUndefined()
    expect(mocks.aiRunCreate.mock.calls[0][0].data.promptVersion).toBe('campaign-strategies-v4-evidence-context')
  })
})

describe('gate de envio de e-mail — fail-closed por construção', () => {
  it('sem os pré-requisitos operacionais, allowed é false com todos os blockers', () => {
    const gate = evaluateEmailSendGate()
    expect(gate.allowed).toBe(false)
    expect(gate.missing).toEqual([
      'EMAIL_PROVIDER_NOT_CONFIGURED',
      'EMAIL_MARKETING_CONSENT_SOURCE_NOT_CONFIGURED',
      'EMAIL_UNSUBSCRIBE_SUPPRESSION_NOT_IMPLEMENTED',
      'EMAIL_DOMAIN_NOT_AUTHENTICATED',
      'EMAIL_LEGAL_REVIEW_REQUIRED',
      'EMAIL_SEND_DISABLED',
    ])
  })

  it('EMAIL_SEND_ENABLED=true sozinho nunca abre o gate; os demais pré-requisitos continuam independentes', async () => {
    vi.resetModules()
    vi.doMock('../../config/env', () => ({ env: { EMAIL_SEND_ENABLED: true, NODE_ENV: 'test', VIP_MIN_ORDERS: 3, VIP_MIN_SPEND: 500 } }))
    vi.doMock('../../config/prisma', () => ({ prisma: { $queryRaw: vi.fn() } }))
    const gate = await import('../../services/emailSendGate')
    const result = gate.evaluateEmailSendGate()
    expect(result.allowed).toBe(false)
    expect(result.missing).not.toContain('EMAIL_SEND_DISABLED')
    expect(result.missing).toEqual(expect.arrayContaining(['EMAIL_PROVIDER_NOT_CONFIGURED', 'EMAIL_MARKETING_CONSENT_SOURCE_NOT_CONFIGURED', 'EMAIL_UNSUBSCRIBE_SUPPRESSION_NOT_IMPLEMENTED']))
    expect(() => gate.assertEmailSendAllowed()).toThrow(gate.EmailSendNotAvailableError)
    vi.doUnmock('../../config/env')
    vi.doUnmock('../../config/prisma')
  })
})

describe('zero envio real de e-mail', () => {
  it('só o SDK Resend está permitido nesta fase; outros provedores continuam ausentes', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.dependencies?.resend).toBeTruthy()

    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ')
    const forbiddenProviders = /sendgrid|brevo|sendinblue|mailchimp|mandrill|klaviyo|nodemailer|postmark|mailgun|aws-sdk\/client-ses|@aws-sdk\/client-sesv2/i
    expect(deps).not.toMatch(forbiddenProviders)

    // Instalar/configurar o adapter não abre envio: o gate global real continua fechado.
    const gate = evaluateEmailSendGate()
    expect(gate.allowed).toBe(false)
    expect(gate.missing).toContain('EMAIL_SEND_DISABLED')
    expect(gate.missing).toContain('EMAIL_MARKETING_CONSENT_SOURCE_NOT_CONFIGURED')
    expect(gate.missing).toContain('EMAIL_UNSUBSCRIBE_SUPPRESSION_NOT_IMPLEMENTED')
  })

  it('a única rota de e-mail é de LEITURA (GET): não há POST/PUT/PATCH/DELETE em emailIntelligence.routes', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const text = fs.readFileSync(path.join(process.cwd(), 'src/routes/emailIntelligence.routes.ts'), 'utf8')
    expect(text).not.toMatch(/router\.(post|put|patch|delete)\(/)
    expect((text.match(/router\.get\(/g) ?? []).length).toBe(3)
  })
})
