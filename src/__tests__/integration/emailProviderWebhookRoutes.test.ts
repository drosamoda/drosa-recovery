import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const mocks = vi.hoisted(() => ({
  adapter: { name: 'resend', send: vi.fn(), parseWebhook: vi.fn() },
  ingest: vi.fn(),
}))

vi.mock('../../services/emailProviderFactory', () => ({
  getEmailProviderAdapter: vi.fn(() => mocks.adapter),
  isEmailProviderConfigured: vi.fn(() => false),
}))

vi.mock('../../services/emailTrackingService', async () => {
  const actual = await vi.importActual<typeof import('../../services/emailTrackingService')>('../../services/emailTrackingService')
  return { ...actual, ingestProviderWebhook: mocks.ingest }
})

import app from '../../index'
import { InvalidWebhookSignatureError, MalformedWebhookPayloadError } from '../../services/emailProviderAdapter'
import { getEmailProviderAdapter } from '../../services/emailProviderFactory'

describe('POST /webhooks/email/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEmailProviderAdapter).mockReturnValue(mocks.adapter)
    mocks.ingest.mockResolvedValue({ received: 1, recorded: 1, duplicates: 0, unlinked: 0, suppressed: 0, rejected: 0 })
  })

  it('entrega o raw body e headers ao ingester e responde só contadores', async () => {
    const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'x' } })
    const res = await request(app)
      .post('/webhooks/email/resend')
      .set('Content-Type', 'application/json')
      .set('svix-id', 'msg_1')
      .set('svix-timestamp', '1780000000')
      .set('svix-signature', 'v1,test')
      .send(payload)

    expect(res.status).toBe(200)
    expect(mocks.ingest).toHaveBeenCalledTimes(1)
    const [adapter, webhookRequest] = mocks.ingest.mock.calls[0]
    expect(adapter).toBe(mocks.adapter)
    expect(webhookRequest.rawBody).toBe(payload)
    expect(webhookRequest.headers).toMatchObject({
      'svix-id': 'msg_1',
      'svix-timestamp': '1780000000',
      'svix-signature': 'v1,test',
    })
    expect(res.body).toEqual({ ok: true, received: 1, recorded: 1, duplicates: 0, unlinked: 0, suppressed: 0, rejected: 0 })
  })
  it('sem provider configurado responde 503 sem tentar ingerir', async () => {
    vi.mocked(getEmailProviderAdapter).mockReturnValue(null)
    const res = await request(app).post('/webhooks/email/resend').send({ type: 'email.delivered' })
    expect(res.status).toBe(503)
    expect(mocks.ingest).not.toHaveBeenCalled()
  })

  it.each([
    [new InvalidWebhookSignatureError(), 400],
    [new MalformedWebhookPayloadError('bad'), 400],
  ])('erro de assinatura/payload é rejeitado sem ecoar detalhes', async (error, status) => {
    mocks.ingest.mockRejectedValue(error)
    const res = await request(app)
      .post('/webhooks/email/resend')
      .set('svix-id', 'msg_1')
      .set('svix-timestamp', '1780000000')
      .set('svix-signature', 'v1,test')
      .send({ type: 'email.delivered' })
    expect(res.status).toBe(status)
    expect(JSON.stringify(res.body)).not.toContain('bad')
  })

  it('erro interno responde 500 e nunca expõe mensagem sensível', async () => {
    mocks.ingest.mockRejectedValue(new Error('cliente@example.com database secret'))
    const res = await request(app)
      .post('/webhooks/email/resend')
      .set('svix-id', 'msg_1')
      .set('svix-timestamp', '1780000000')
      .set('svix-signature', 'v1,test')
      .send({ type: 'email.delivered' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toMatch(/cliente@example\.com|database secret/)
  })
})
