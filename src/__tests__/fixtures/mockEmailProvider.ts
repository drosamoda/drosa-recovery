import { createHmac, timingSafeEqual } from 'crypto'
import {
  EmailProviderAdapter,
  EmailProviderEventType,
  EmailProviderSendError,
  EmailSendResult,
  InvalidWebhookSignatureError,
  MalformedWebhookPayloadError,
  NormalizedEmailEvent,
  OutboundEmail,
  WebhookRequest,
} from '../../services/emailProviderAdapter'

// Provedor de e-mail FALSO para testes: não faz rede, não conhece nenhum
// fornecedor real e mora fora do build de produção (tsconfig.build exclui
// __tests__). Cumpre o mesmo contrato de um provedor real — em especial a
// verificação de assinatura sobre o corpo BRUTO antes de qualquer parse.

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature'

const EVENT_TYPES: readonly EmailProviderEventType[] = [
  'DELIVERED',
  'DEFERRED',
  'SOFT_BOUNCE',
  'HARD_BOUNCE',
  'BLOCKED',
  'SPAM_COMPLAINT',
  'UNSUBSCRIBE',
  'OPEN',
  'CLICK',
]

export function signMockWebhook(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

interface MockWebhookEvent {
  id: string
  type: EmailProviderEventType
  email: string
  timestamp: number
  messageId?: string
  sendId?: string
  campaignKey?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toMockEvent(value: unknown): MockWebhookEvent {
  if (!isRecord(value)) throw new MalformedWebhookPayloadError('evento não é um objeto')
  const { id, type, email, timestamp, messageId, sendId, campaignKey } = value
  if (typeof id !== 'string' || id === '') throw new MalformedWebhookPayloadError('id ausente')
  if (typeof type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(type)) {
    throw new MalformedWebhookPayloadError('tipo desconhecido')
  }
  if (typeof email !== 'string' || email === '') throw new MalformedWebhookPayloadError('email ausente')
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) throw new MalformedWebhookPayloadError('timestamp inválido')
  return {
    id,
    type: type as EmailProviderEventType,
    email,
    timestamp,
    messageId: typeof messageId === 'string' ? messageId : undefined,
    sendId: typeof sendId === 'string' ? sendId : undefined,
    campaignKey: typeof campaignKey === 'string' ? campaignKey : undefined,
  }
}

export class MockEmailProvider implements EmailProviderAdapter {
  readonly name = 'mock'
  readonly sent: OutboundEmail[] = []
  private pendingFailure: EmailProviderSendError | null = null

  constructor(private readonly webhookSecret: string) {}

  // A próxima chamada a send lança este erro (uma vez só).
  failNextSend(error: EmailProviderSendError): void {
    this.pendingFailure = error
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    if (this.pendingFailure !== null) {
      const failure = this.pendingFailure
      this.pendingFailure = null
      throw failure
    }
    this.sent.push(message)
    return { providerMessageId: `mock-${this.sent.length}` }
  }

  parseWebhook(request: WebhookRequest): NormalizedEmailEvent[] {
    const provided = request.headers[MOCK_SIGNATURE_HEADER]
    const expected = signMockWebhook(request.rawBody, this.webhookSecret)
    if (
      provided === undefined ||
      provided.length !== expected.length ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      throw new InvalidWebhookSignatureError()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(request.rawBody)
    } catch {
      throw new MalformedWebhookPayloadError('JSON inválido')
    }
    if (!Array.isArray(parsed)) throw new MalformedWebhookPayloadError('esperado um array de eventos')

    return parsed.map(toMockEvent).map((event) => ({
      provider: this.name,
      providerEventId: event.id,
      type: event.type,
      providerMessageId: event.messageId ?? null,
      recipient: event.email,
      occurredAt: new Date(event.timestamp * 1000),
      sendId: event.sendId ?? null,
      campaignKey: event.campaignKey ?? null,
    }))
  }
}
