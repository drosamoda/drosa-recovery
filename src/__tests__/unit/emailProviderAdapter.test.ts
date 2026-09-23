import { describe, expect, it } from 'vitest'
import {
  EmailProviderSendError,
  InvalidWebhookSignatureError,
  MalformedWebhookPayloadError,
  OutboundEmail,
} from '../../services/emailProviderAdapter'
import { MOCK_SIGNATURE_HEADER, MockEmailProvider, signMockWebhook } from '../fixtures/mockEmailProvider'

// O mock cumpre o MESMO contrato que qualquer provedor real terá de cumprir:
// assinatura verificada sobre o corpo BRUTO, antes de qualquer parse, e eventos
// devolvidos já normalizados. Estes testes fixam o contrato do adapter.

const SECRET = 'whsec-de-teste-0123456789'

function body(events: unknown[]): string {
  return JSON.stringify(events)
}

function signed(rawBody: string, secret = SECRET): { rawBody: string; headers: Record<string, string> } {
  return { rawBody, headers: { [MOCK_SIGNATURE_HEADER]: signMockWebhook(rawBody, secret) } }
}

const EVENT = { id: 'evt-1', type: 'HARD_BOUNCE', email: 'cliente@example.com', timestamp: 1_790_000_000, messageId: 'mock-7', sendId: 'send_1', campaignKey: 'camp_x' }

describe('parseWebhook — assinatura', () => {
  it('aceita a assinatura correta e normaliza o evento', () => {
    const provider = new MockEmailProvider(SECRET)
    const events = provider.parseWebhook(signed(body([EVENT])))

    expect(events).toEqual([
      {
        provider: 'mock',
        providerEventId: 'evt-1',
        type: 'HARD_BOUNCE',
        providerMessageId: 'mock-7',
        recipient: 'cliente@example.com',
        occurredAt: new Date(1_790_000_000 * 1000),
        sendId: 'send_1',
        campaignKey: 'camp_x',
      },
    ])
  })

  it('campos opcionais ausentes viram null', () => {
    const provider = new MockEmailProvider(SECRET)
    const [event] = provider.parseWebhook(signed(body([{ id: 'e', type: 'OPEN', email: 'a@b.co', timestamp: 1 }])))
    expect(event).toMatchObject({ providerMessageId: null, sendId: null, campaignKey: null })
  })

  it('rejeita assinatura de outra chave, ausente ou de tamanho errado — sem interpretar o corpo', () => {
    const provider = new MockEmailProvider(SECRET)
    const raw = body([EVENT])
    expect(() => provider.parseWebhook(signed(raw, 'outra-chave'))).toThrow(InvalidWebhookSignatureError)
    expect(() => provider.parseWebhook({ rawBody: raw, headers: {} })).toThrow(InvalidWebhookSignatureError)
    expect(() => provider.parseWebhook({ rawBody: raw, headers: { [MOCK_SIGNATURE_HEADER]: 'curta' } })).toThrow(InvalidWebhookSignatureError)
  })

  it('a assinatura vale para o corpo BRUTO: reserializar o JSON (mesmos dados) invalida', () => {
    const provider = new MockEmailProvider(SECRET)
    const raw = body([EVENT])
    const { headers } = signed(raw)
    const reserialized = JSON.stringify(JSON.parse(raw), null, 2)
    expect(() => provider.parseWebhook({ rawBody: reserialized, headers })).toThrow(InvalidWebhookSignatureError)
  })

  it('corpo adulterado com a assinatura antiga é rejeitado', () => {
    const provider = new MockEmailProvider(SECRET)
    const { headers } = signed(body([EVENT]))
    const tampered = body([{ ...EVENT, type: 'DELIVERED' }])
    expect(() => provider.parseWebhook({ rawBody: tampered, headers })).toThrow(InvalidWebhookSignatureError)
  })
})

describe('parseWebhook — payload malformado (com assinatura válida)', () => {
  const provider = new MockEmailProvider(SECRET)

  it.each([
    ['JSON inválido', '{nao-json'],
    ['não é array', JSON.stringify({ id: 'x' })],
    ['evento não é objeto', body(['texto'])],
    ['sem id', body([{ ...EVENT, id: '' }])],
    ['tipo desconhecido', body([{ ...EVENT, type: 'EXPLODIU' }])],
    ['sem email', body([{ ...EVENT, email: '' }])],
    ['timestamp inválido', body([{ ...EVENT, timestamp: 'ontem' }])],
  ])('%s → MalformedWebhookPayloadError', (_label, raw) => {
    expect(() => provider.parseWebhook(signed(raw))).toThrow(MalformedWebhookPayloadError)
  })
})

describe('send', () => {
  const message: OutboundEmail = {
    to: 'cliente@example.com',
    from: { address: 'novidades@news.exemplo.test', name: "D'Rosa Moda" },
    subject: 's',
    html: '<p>x</p>',
    text: 'x',
    headers: {},
    tracking: { sendId: 'send_1', campaignKey: 'camp_x' },
  }

  it('registra a mensagem e devolve um id de provedor sequencial', async () => {
    const provider = new MockEmailProvider(SECRET)
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: 'mock-1' })
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: 'mock-2' })
    expect(provider.sent).toHaveLength(2)
  })

  it('failNextSend falha UMA vez e depois volta ao normal', async () => {
    const provider = new MockEmailProvider(SECRET)
    provider.failNextSend(new EmailProviderSendError('rejeitado', false))
    await expect(provider.send(message)).rejects.toMatchObject({ retryable: false })
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: 'mock-1' })
  })
})
