import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { env } from '../../config/env'

// Rotas de inteligência de e-mail + geração de campanha de e-mail pelo MESMO
// endpoint de IA. Nenhum teste aqui acessa banco real, Groq, OpenAI ou Anthropic:
// o snapshot de audiência e o campaignService são substituídos.
const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  createFromOpportunity: vi.fn(),
  schedule: vi.fn(),
  generateEmailOpportunities: vi.fn(),
  generateOpportunities: vi.fn(),
}))

vi.mock('../../services/emailAudienceEngine', async () => {
  const actual = await vi.importActual<typeof import('../../services/emailAudienceEngine')>('../../services/emailAudienceEngine')
  return { ...actual, getEmailAudienceSnapshot: mocks.getSnapshot }
})
vi.mock('../../services/emailOpportunityService', async () => {
  const actual = await vi.importActual<typeof import('../../services/emailOpportunityService')>('../../services/emailOpportunityService')
  return { ...actual, generateEmailOpportunities: mocks.generateEmailOpportunities }
})
vi.mock('../../services/aiOpportunityEngine', async () => {
  const actual = await vi.importActual<typeof import('../../services/aiOpportunityEngine')>('../../services/aiOpportunityEngine')
  return { ...actual, generateOpportunities: mocks.generateOpportunities }
})
vi.mock('../../services/ai/campaignService', async () => {
  const actual = await vi.importActual<typeof import('../../services/ai/campaignService')>('../../services/ai/campaignService')
  return { ...actual, campaignService: { ...actual.campaignService, createFromOpportunity: mocks.createFromOpportunity, schedule: mocks.schedule } }
})

import { EmailBaseQuality, EmailIdentityRow, buildEmailAudienceSnapshot } from '../../services/emailAudienceEngine'
import { EmailCampaignNotAllowedError } from '../../services/ai/campaignService'
import { EmailSendNotAvailableError } from '../../services/emailSendGate'

const NOW = new Date('2026-09-19T12:00:00.000Z')
const DAY = 86_400_000
const QUALITY: EmailBaseQuality = { totalCustomers: 20, customersWithoutEmail: 3, paidOrders: 15, paidOrdersWithoutEmail: 1, paidOrdersWithoutDate: 0 }
const row = (o: Partial<EmailIdentityRow> = {}): EmailIdentityRow => ({ validEmail: true, paidOrderCount: 0, paidTotal: 0, lastPaidAt: null, undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false, ...o })
const buyer = (age: number) => row({ paidOrderCount: 1, paidTotal: 100, lastPaidAt: new Date(NOW.getTime() - age * DAY) })
const snapshot = buildEmailAudienceSnapshot([buyer(10), buyer(45), buyer(75), buyer(120), row(), row({ validEmail: false }), row({ recentAbandonedCart: true })], QUALITY, NOW)

const auth = () => ({ 'x-crm-read-secret': env.CRM_READ_SECRET })

async function get(path: string, headers: Record<string, string> = auth()) {
  const { default: app } = await import('../../index')
  return request(app).get(path).set(headers)
}

describe('GET /crm-api/email/* — autenticação e leitura', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getSnapshot.mockResolvedValue(snapshot) })

  it.each(['/crm-api/email/audiences', '/crm-api/email/campaign-library', '/crm-api/email/recommendations'])('%s sem x-crm-read-secret => 401 e nenhum cálculo', async path => {
    const res = await get(path, {})
    expect(res.status).toBe(401)
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
  })

  it('audiences: segmentos reais, base e prova de buckets sem sobreposição; sendEligibleCount sempre null', async () => {
    const res = await get('/crm-api/email/audiences')
    expect(res.status).toBe(200)
    expect(res.body.consentSource).toBe('NOT_CONFIGURED')
    expect(res.body.sendEligibility).toBe('NOT_READY')
    expect(res.body.cooldownStatus).toBe('NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY')
    expect(res.body.recencyCheck.overlapFree).toBe(true)
    expect(res.body.base).toEqual(expect.objectContaining({ emailKnown: 7, emailInvalid: 1, customersWithoutEmail: 3 }))
    const keys = res.body.segments.map((s: { segmentKey: string }) => s.segmentKey)
    for (const key of ['ALL_EMAIL_CUSTOMERS', 'ONE_TIME_BUYERS', 'REPEAT_BUYERS', 'VIP_CUSTOMERS', 'RECENT_BUYERS_0_30D', 'LAPSED_31_60D', 'LAPSED_61_90D', 'LAPSED_91_180D', 'LAPSED_181_365D', 'DORMANT_365D_PLUS', 'NO_PURCHASE_CUSTOMERS']) expect(keys).toContain(key)
    for (const s of res.body.segments) expect(s.sendEligibleCount).toBeNull()
    const affinity = res.body.segments.find((s: { segmentKey: string }) => s.segmentKey === 'CATEGORY_AFFINITY')
    expect(affinity).toEqual(expect.objectContaining({ status: 'NEEDS_DATA', audienceCount: null, eligibilityStatus: 'NEEDS_DATA' }))
    expect(res.body.segments.find((s: { segmentKey: string }) => s.segmentKey === 'ALL_EMAIL_CUSTOMERS').audienceCount).toBe(7)
  })

  it('nenhum e-mail, nome ou telefone de cliente aparece em nenhuma resposta (só agregados)', async () => {
    for (const path of ['/crm-api/email/audiences', '/crm-api/email/campaign-library', '/crm-api/email/recommendations']) {
      const res = await get(path)
      expect(JSON.stringify(res.body), path).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/)
    }
  })

  it('campaign-library: >= 30 campanhas, status por requisito, gate de envio fechado', async () => {
    const res = await get('/crm-api/email/campaign-library')
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThanOrEqual(30)
    expect(res.body.ready + res.body.needsData).toBe(res.body.total)
    expect(res.body.libraryVersion).toBe('email-campaign-library-v1')
    expect(res.body.sendGate.allowed).toBe(false)
    expect(res.body.sendGate.missing).toContain('EMAIL_PROVIDER_NOT_CONFIGURED')
    const byKey = Object.fromEntries(res.body.data.map((c: { key: string }) => [c.key, c]))
    expect(byKey.NEW_ARRIVALS.readiness.status).toBe('NEEDS_DATA')
    expect(byKey.NEW_ARRIVALS.readiness.missingHard).toContain('NEWNESS_EVIDENCE')
    expect(byKey.WINBACK_61_90.readiness.status).toBe('READY')
    expect(byKey.WINBACK_61_90).toEqual(expect.objectContaining({
      name: expect.any(String), objective: expect.any(String), priority: 7, recommendedCooldownDays: 21, sendEligibility: 'SEND_ELIGIBILITY_UNVERIFIED',
    }))
    expect(byKey.WINBACK_61_90.aiDirections).toHaveLength(3)
    expect(byKey.WINBACK_61_90.allowedSegments[0]).toEqual({ key: 'LAPSED_61_90D', name: expect.any(String) })
    // a biblioteca não depende do banco
    expect(mocks.getSnapshot).not.toHaveBeenCalled()
  })

  it('recommendations: ranking "o que fazer agora" determinístico com carrinho recente em primeiro', async () => {
    const res = await get('/crm-api/email/recommendations')
    expect(res.status).toBe(200)
    expect(res.body.consentSource).toBe('NOT_CONFIGURED')
    expect(res.body.recommendations[0]).toEqual(expect.objectContaining({ campaignKey: 'CART_RECOVERY_EMAIL', actionable: true, priority: 2, sendEligibleCount: null, sendEligibility: 'SEND_ELIGIBILITY_UNVERIFIED' }))
    expect(res.body.summary.total).toBe(res.body.recommendations.length)
    const winback = res.body.recommendations.find((r: { campaignKey: string; segmentKey: string }) => r.campaignKey === 'WINBACK_61_90' && r.segmentKey === 'LAPSED_61_90D')
    expect(winback).toEqual(expect.objectContaining({ audienceCount: 1, whyNow: expect.any(String), opportunityId: 'opp_email_lapsed_61_90d_2026-09-19', actionable: true }))
  })

  it('erro de banco vira 500 genérico — nunca vaza SQL, tabela ou stack', async () => {
    mocks.getSnapshot.mockRejectedValue(new Error('relation "public.customers" does not exist\n at Prisma...'))
    for (const path of ['/crm-api/email/audiences', '/crm-api/email/recommendations']) {
      const res = await get(path)
      expect(res.status).toBe(500)
      expect(JSON.stringify(res.body)).not.toMatch(/relation|public\.|customers|prisma|stack/i)
      expect(res.body.error).toMatch(/^Erro inesperado ao calcular/)
    }
  })

  it('nenhuma rota de escrita/envio de e-mail existe: POST/PUT/PATCH/DELETE => 404', async () => {
    const { default: app } = await import('../../index')
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      for (const path of ['/crm-api/email/audiences', '/crm-api/email/send', '/crm-api/email/campaigns', '/crm-api/email/schedule']) {
        const res = await request(app)[method](path).set(auth()).send({})
        expect(res.status, `${method} ${path}`).toBe(404)
      }
    }
    expect((await get('/crm-api/email/send')).status).toBe(404)
  })
})

describe('GET /crm-api/ai/opportunities — channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.generateOpportunities.mockResolvedValue([{ id: 'opp_recent_customer_2026-09-19', channel: 'whatsapp', type: 'RECENT_CUSTOMER' }])
    mocks.generateEmailOpportunities.mockResolvedValue([{ id: 'opp_email_lapsed_61_90d_2026-09-19', channel: 'email', type: 'EMAIL_LAPSED_61_90' }])
  })

  it('padrão continua sendo WhatsApp, contrato anterior: nunca calcula e-mail', async () => {
    const res = await get('/crm-api/ai/opportunities')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([{ id: 'opp_recent_customer_2026-09-19', channel: 'whatsapp', type: 'RECENT_CUSTOMER' }])
    expect(mocks.generateEmailOpportunities).not.toHaveBeenCalled()
  })

  it('channel=email devolve só as de e-mail e não toca o motor de WhatsApp', async () => {
    const res = await get('/crm-api/ai/opportunities?channel=email')
    expect(res.body.data.map((o: { channel: string }) => o.channel)).toEqual(['email'])
    expect(mocks.generateOpportunities).not.toHaveBeenCalled()
  })

  it('channel=all lista os dois canais explicitamente separados (nunca misturados silenciosamente)', async () => {
    const res = await get('/crm-api/ai/opportunities?channel=all')
    expect(res.body.data.map((o: { channel: string }) => o.channel)).toEqual(['whatsapp', 'email'])
  })

  it('channel inválido => 400', async () => {
    const res = await get('/crm-api/ai/opportunities?channel=sms')
    expect(res.status).toBe(400)
  })
})

describe('POST /crm-api/ai/campaigns — campanha de e-mail pelo mesmo pipeline', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.createFromOpportunity.mockResolvedValue({ id: 'draft_1', status: 'AWAITING_HUMAN_APPROVAL', strategies: [], complianceFindings: [] }) })
  const post = async (body: Record<string, unknown>) => {
    const { default: app } = await import('../../index')
    return request(app).post('/crm-api/ai/campaigns').set(auth()).send(body)
  }
  const KEY = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

  it('idempotencyKey continua obrigatória também para e-mail', async () => {
    const res = await post({ opportunityId: 'opp_email_lapsed_61_90d_2026-09-19', campaignKey: 'WINBACK_61_90' })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED')
    expect(mocks.createFromOpportunity).not.toHaveBeenCalled()
  })

  it('campaignKey é repassada ao service; sem campaignKey a chamada é exatamente a anterior (2 argumentos)', async () => {
    expect((await post({ opportunityId: 'opp_email_lapsed_61_90d_2026-09-19', idempotencyKey: KEY, campaignKey: 'WINBACK_61_90' })).status).toBe(201)
    expect(mocks.createFromOpportunity).toHaveBeenLastCalledWith('opp_email_lapsed_61_90d_2026-09-19', KEY, { campaignKey: 'WINBACK_61_90' })
    await post({ opportunityId: 'opp_recent_customer_2026-09-19', idempotencyKey: KEY })
    expect(mocks.createFromOpportunity).toHaveBeenLastCalledWith('opp_recent_customer_2026-09-19', KEY)
  })

  it.each([['winback_61_90'], ['WIN BACK'], ['x'], [123], ['A'.repeat(80)]])('campaignKey inválida (%s) => 400 e nenhuma geração', async bad => {
    const res = await post({ opportunityId: 'opp_email_lapsed_61_90d_2026-09-19', idempotencyKey: KEY, campaignKey: bad })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('CAMPAIGN_KEY_INVALID')
    expect(mocks.createFromOpportunity).not.toHaveBeenCalled()
  })

  it('campanha NEEDS_DATA/fora do segmento => 422 com code, mensagem própria (não vaza nada interno)', async () => {
    mocks.createFromOpportunity.mockRejectedValue(new EmailCampaignNotAllowedError('EMAIL_CAMPAIGN_NEEDS_DATA', 'A campanha NEW_ARRIVALS depende de dados que o sistema ainda não coleta: NEWNESS_EVIDENCE.'))
    const res = await post({ opportunityId: 'opp_email_lapsed_61_90d_2026-09-19', idempotencyKey: KEY, campaignKey: 'NEW_ARRIVALS' })
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('EMAIL_CAMPAIGN_NEEDS_DATA')
    expect(res.body.error).toContain('NEWNESS_EVIDENCE')
  })

  it('agendar draft de e-mail (ato administrativo) => 409 EMAIL_SEND_NOT_AVAILABLE, nunca 200', async () => {
    mocks.schedule.mockRejectedValue(new EmailSendNotAvailableError(['EMAIL_PROVIDER_NOT_CONFIGURED', 'EMAIL_SEND_DISABLED']))
    const { default: app } = await import('../../index')
    const res = await request(app).post('/crm-api/ai/campaigns/draft_email_1/schedule').set(auth()).set('x-admin-secret', env.ADMIN_SECRET).send({})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('EMAIL_SEND_NOT_AVAILABLE')
    expect(res.body.missing).toEqual(['EMAIL_PROVIDER_NOT_CONFIGURED', 'EMAIL_SEND_DISABLED'])
  })
})
