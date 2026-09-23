import { describe, expect, it, vi } from 'vitest'
import { EmailProviderSendError, InvalidWebhookSignatureError, MalformedWebhookPayloadError, OutboundEmail } from '../../services/emailProviderAdapter'
import { ResendEmailProvider } from '../../services/resendEmailProvider'

const API_KEY = 're_test_key'
const WEBHOOK_SECRET = 'whsec_test_secret'

function message(): OutboundEmail {
  return {
    to: 'cliente@example.com',
    from: { address: 'novidades@drosamoda.com.br', name: "D'Rosa Moda" },
    subject: 'Novidades D\'Rosa',
    html: '<p>Olá</p>',
    text: 'Olá',
    headers: {
      'List-Unsubscribe': '<https://crm.exemplo.test/unsubscribe/email?t=abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tracking: { sendId: 'send_123', campaignKey: 'campanha_setembro' },
  }
}

function client() {
  return {
    emails: { send: vi.fn() },
    webhooks: { verify: vi.fn() },
  }
}
describe('ResendEmailProvider.send', () => {
  it('envia uma única mensagem com headers e tags opacas e devolve o email_id', async () => {
    const sdk = client()
    sdk.emails.send.mockResolvedValue({ data: { id: 'resend-email-1' }, error: null })
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })

    await expect(provider.send(message())).resolves.toEqual({ providerMessageId: 'resend-email-1' })
    expect(sdk.emails.send).toHaveBeenCalledWith({
      from: "D'Rosa Moda <novidades@drosamoda.com.br>",
      to: ['cliente@example.com'],
      subject: "Novidades D'Rosa",
      html: '<p>Olá</p>',
      text: 'Olá',
      headers: message().headers,
      tags: [
        { name: 'send_id', value: 'send_123' },
        { name: 'campaign_key', value: 'campanha_setembro' },
      ],
    })
  })

  it('classifica rate limit/erro interno como retryable sem vazar a mensagem do provedor', async () => {
    const sdk = client()
    sdk.emails.send.mockResolvedValue({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'cliente@example.com excedeu o limite' },
    })
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })

    const promise = provider.send(message())
    await expect(promise).rejects.toBeInstanceOf(EmailProviderSendError)
    await expect(promise).rejects.toMatchObject({ retryable: true })
    await expect(promise).rejects.not.toThrow(/cliente@example\.com/)
  })

  it('classifica rejeição de validação como definitiva', async () => {
    const sdk = client()
    sdk.emails.send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'bad input' } })
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })
    await expect(provider.send(message())).rejects.toMatchObject({ retryable: false })
  })
})
describe('ResendEmailProvider.parseWebhook', () => {
  function request() {
    return {
      rawBody: '{"type":"email.delivered"}',
      headers: {
        'webhook-id': 'msg_evt_1',
        'webhook-timestamp': '1780000000',
        'webhook-signature': 'v1,signature',
      },
    }
  }

  function verified(type: string, data: Record<string, unknown> = {}) {
    return {
      type,
      created_at: '2026-09-23T14:00:00.000Z',
      data: {
        email_id: 'resend-email-1',
        to: ['cliente@example.com'],
        tags: { send_id: 'send_123', campaign_key: 'campanha_setembro' },
        ...data,
      },
    }
  }

  it.each([
    ['email.delivered', 'DELIVERED'],
    ['email.delivery_delayed', 'DEFERRED'],
    ['email.complained', 'SPAM_COMPLAINT'],
    ['email.opened', 'OPEN'],
    ['email.clicked', 'CLICK'],
    ['email.failed', 'BLOCKED'],
  ])('%s -> %s', (resendType, normalizedType) => {
    const sdk = client()
    sdk.webhooks.verify.mockReturnValue(verified(resendType))
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })

    expect(provider.parseWebhook(request())).toEqual([{
      provider: 'resend',
      providerEventId: 'msg_evt_1',
      type: normalizedType,
      providerMessageId: 'resend-email-1',
      recipient: 'cliente@example.com',
      occurredAt: new Date('2026-09-23T14:00:00.000Z'),
      sendId: 'send_123',
      campaignKey: 'campanha_setembro',
    }])
  })
  it.each([
    ['Permanent', 'HARD_BOUNCE'],
    ['Transient', 'SOFT_BOUNCE'],
    ['Undetermined', 'SOFT_BOUNCE'],
  ])('email.bounced %s -> %s', (bounceType, normalizedType) => {
    const sdk = client()
    sdk.webhooks.verify.mockReturnValue(verified('email.bounced', { bounce: { type: bounceType } }))
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })
    expect(provider.parseWebhook(request())[0].type).toBe(normalizedType)
  })

  it('email.suppressed vira HARD_BOUNCE conservador para espelhar a lista de supressão do provider', () => {
    const sdk = client()
    sdk.webhooks.verify.mockReturnValue(verified('email.suppressed'))
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })
    expect(provider.parseWebhook(request())[0].type).toBe('HARD_BOUNCE')
  })

  it.each(['email.sent', 'email.scheduled', 'email.received'])('%s é ignorado', (type) => {
    const sdk = client()
    sdk.webhooks.verify.mockReturnValue(verified(type))
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })
    expect(provider.parseWebhook(request())).toEqual([])
  })

  it('verifica a assinatura sobre o raw body com os três headers Standard Webhooks', () => {
    const sdk = client()
    sdk.webhooks.verify.mockReturnValue(verified('email.delivered'))
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })
    const req = request()
    provider.parseWebhook(req)

    expect(sdk.webhooks.verify).toHaveBeenCalledWith({
      payload: req.rawBody,
      headers: {
        id: 'msg_evt_1',
        timestamp: '1780000000',
        signature: 'v1,signature',
      },
      webhookSecret: WEBHOOK_SECRET,
    })
  })
  it('assinatura inválida vira InvalidWebhookSignatureError antes de normalizar', () => {
    const sdk = client()
    sdk.webhooks.verify.mockImplementation(() => { throw new Error('invalid signature') })
    const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })
    expect(() => provider.parseWebhook(request())).toThrow(InvalidWebhookSignatureError)
  })

  it('payload sem destinatário ou data válida é rejeitado como malformado', () => {
    for (const event of [
      verified('email.delivered', { to: [] }),
      { ...verified('email.delivered'), created_at: 'not-a-date' },
    ]) {
      const sdk = client()
      sdk.webhooks.verify.mockReturnValue(event)
      const provider = new ResendEmailProvider({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET, client: sdk })
      expect(() => provider.parseWebhook(request())).toThrow(MalformedWebhookPayloadError)
    }
  })
})
