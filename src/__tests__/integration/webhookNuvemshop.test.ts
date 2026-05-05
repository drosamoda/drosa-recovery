import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createHmac } from 'crypto'
import app from '../../index'

// Mocka serviços que tocam no banco/APIs externas
vi.mock('../../services/webhookEventService', () => ({
  webhookEventService: {
    save: vi.fn().mockResolvedValue('event-id-123'),
    markProcessed: vi.fn().mockResolvedValue(undefined),
    markError: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../services/orderService', () => ({
  orderService: {
    handleNuvemshopOrderWebhook: vi.fn().mockResolvedValue(undefined),
  },
}))

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!

function signBody(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex')
}

function signBodyBase64(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('base64')
}

const samplePayload = {
  id: 12345,
  number: 1001,
  status: 'open',
  payment_status: 'pending',
  contact_name: 'Maria Silva',
  contact_phone: '31998021418',
  total: '199.90',
}

describe('POST /webhooks/nuvemshop/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('responde 200 com HMAC válido', async () => {
    const body = JSON.stringify(samplePayload)
    const sig = signBody(body)

    const res = await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', sig)
      .set('x-linkedstore-topic', 'orders/created')
      .send(body)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ received: true })
  })

  it('responde 401 com HMAC inválido', async () => {
    const res = await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', 'assinatura-errada')
      .send(JSON.stringify(samplePayload))

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ reason: 'signature_invalid' })
  })

  it('responde 401 sem header de assinatura', async () => {
    const res = await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(samplePayload))

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ reason: 'signature_missing' })
  })

  it('responde 400 em JSON quando payload do pedido estiver incompleto', async () => {
    const { webhookEventService } = await import('../../services/webhookEventService')
    const body = JSON.stringify({ event: 'order/created' })
    const sig = signBody(body)

    const res = await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', sig)
      .send(body)

    expect(res.status).toBe(400)
    expect(res.type).toContain('json')
    expect(res.body).toMatchObject({
      error: 'Payload inválido',
      details: 'Campo id do pedido ausente',
    })
    expect(webhookEventService.save).not.toHaveBeenCalled()
  })

  it('responde 400 em JSON quando o JSON estiver malformado', async () => {
    const body = '{"id":12345,'
    const sig = signBody(body)

    const res = await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', sig)
      .send(body)

    expect(res.status).toBe(400)
    expect(res.type).toContain('json')
    expect(res.body).toMatchObject({ error: 'Payload inválido' })
    expect(res.text).not.toContain('<html')
  })

  it('mantem compatibilidade com assinatura base64 configurada anteriormente', async () => {
    const body = JSON.stringify(samplePayload)
    const sig = signBodyBase64(body)

    const res = await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', sig)
      .send(body)

    expect(res.status).toBe(200)
  })

  it('salva webhook_event antes de responder', async () => {
    const { webhookEventService } = await import('../../services/webhookEventService')
    const body = JSON.stringify(samplePayload)
    const sig = signBody(body)

    await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', sig)
      .send(body)

    expect(webhookEventService.save).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'nuvemshop', hmacValid: true })
    )
  })

  it('não bloqueia resposta esperando processamento', async () => {
    const body = JSON.stringify(samplePayload)
    const sig = signBody(body)
    const start = Date.now()

    await request(app)
      .post('/webhooks/nuvemshop/orders')
      .set('Content-Type', 'application/json')
      .set('x-linkedstore-hmac-sha256', sig)
      .send(body)

    // Deve responder em menos de 500ms (processamento é assíncrono)
    expect(Date.now() - start).toBeLessThan(500)
  })
})
