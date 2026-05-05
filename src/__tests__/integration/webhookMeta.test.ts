import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createHmac } from 'crypto'
import app from '../../index'

vi.mock('../../services/webhookEventService', () => ({
  webhookEventService: {
    save: vi.fn().mockResolvedValue('event-id-456'),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markError: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/messageService', () => ({
  messageService: {
    updateStatusByMetaMessageId: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/customerService', () => ({
  customerService: {
    applyOptOutByPhone: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/inboxService', () => ({
  inboxService: {
    saveInboundMessagesFromMetaPayload: vi.fn().mockResolvedValue({ saved: 1, skipped: 0 }),
  },
}))

const META_APP_SECRET = process.env.META_APP_SECRET!
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!

function signMetaBody(body: string): string {
  const hash = createHmac('sha256', META_APP_SECRET).update(body, 'utf8').digest('hex')
  return `sha256=${hash}`
}

describe('GET /webhooks/meta (challenge)', () => {
  it('retorna challenge com token válido', async () => {
    const res = await request(app).get('/webhooks/meta').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': META_VERIFY_TOKEN,
      'hub.challenge': 'abc123xyz',
    })

    expect(res.status).toBe(200)
    expect(res.text).toBe('abc123xyz')
  })

  it('retorna 403 com token inválido', async () => {
    const res = await request(app).get('/webhooks/meta').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'token-errado',
      'hub.challenge': 'abc123',
    })

    expect(res.status).toBe(403)
  })
})

describe('POST /webhooks/meta (status e opt-out)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('responde 200 com assinatura válida', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] })
    const sig = signMetaBody(body)

    const res = await request(app)
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(body)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ received: true })
  })

  it('responde 401 com assinatura inválida', async () => {
    const res = await request(app)
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=assinatura-errada')
      .send(JSON.stringify({ object: 'whatsapp_business_account' }))

    expect(res.status).toBe(401)
  })

  it('processa opt-out por palavra-chave "parar"', async () => {
    const { customerService } = await import('../../services/customerService')

    const metaPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            messages: [{ from: '5531998021418', text: { body: 'parar' } }],
          },
        }],
      }],
    }

    const body = JSON.stringify(metaPayload)
    const sig = signMetaBody(body)

    await request(app)
      .post('/webhooks/meta')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(body)

    // Aguarda setImmediate executar
    await new Promise((r) => setImmediate(r))

    expect(customerService.applyOptOutByPhone).toHaveBeenCalledWith(
      expect.stringContaining('5531998021418')
    )
  })
})
