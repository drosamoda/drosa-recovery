import { Resend } from 'resend'
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
} from './emailProviderAdapter'

interface ResendSendError {
  name?: string
}

interface ResendSendResponse {
  data?: { id?: string } | null
  error?: ResendSendError | null
}

interface ResendClientLike {
  emails: {
    send(input: {
      from: string
      to: string[]
      subject: string
      html: string
      text: string
      headers: Readonly<Record<string, string>>
      tags: Array<{ name: string; value: string }>
    }): Promise<ResendSendResponse>
  }
  webhooks: {
    verify(input: {
      payload: string
      headers: { id: string; timestamp: string; signature: string }
      webhookSecret: string
    }): unknown
  }
}
export interface ResendEmailProviderOptions {
  apiKey: string
  webhookSecret: string
  client?: ResendClientLike
}

type RecordValue = Record<string, unknown>

const RETRYABLE_ERROR_NAMES = new Set([
  'rate_limit_exceeded',
  'internal_server_error',
  'application_error',
])

const EVENT_TYPE_MAP: Readonly<Record<string, EmailProviderEventType | null>> = {
  'email.sent': null,
  'email.scheduled': null,
  'email.received': null,
  'email.delivered': 'DELIVERED',
  'email.delivery_delayed': 'DEFERRED',
  'email.complained': 'SPAM_COMPLAINT',
  'email.opened': 'OPEN',
  'email.clicked': 'CLICK',
  'email.failed': 'BLOCKED',
  'email.suppressed': 'HARD_BOUNCE',
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function tagValue(tags: unknown, name: string): string | null {
  if (!isRecord(tags)) return null
  return stringOrNull(tags[name])
}
function bounceType(data: RecordValue): EmailProviderEventType {
  const bounce = isRecord(data.bounce) ? data.bounce : null
  const type = bounce === null ? null : stringOrNull(bounce.type)
  return type?.toLowerCase() === 'permanent' ? 'HARD_BOUNCE' : 'SOFT_BOUNCE'
}

function normalizeEvent(verified: unknown, eventId: string): NormalizedEmailEvent[] {
  if (!isRecord(verified)) throw new MalformedWebhookPayloadError('evento não é um objeto')

  const resendType = stringOrNull(verified.type)
  if (resendType === null) throw new MalformedWebhookPayloadError('tipo ausente')

  let normalizedType: EmailProviderEventType | null | undefined
  if (resendType === 'email.bounced') {
    if (!isRecord(verified.data)) throw new MalformedWebhookPayloadError('data ausente')
    normalizedType = bounceType(verified.data)
  } else {
    normalizedType = EVENT_TYPE_MAP[resendType]
  }

  if (normalizedType === undefined) return []
  if (normalizedType === null) return []
  if (!isRecord(verified.data)) throw new MalformedWebhookPayloadError('data ausente')

  const recipientList = verified.data.to
  if (!Array.isArray(recipientList) || recipientList.length === 0) {
    throw new MalformedWebhookPayloadError('destinatário ausente')
  }
  const recipient = stringOrNull(recipientList[0])
  if (recipient === null) throw new MalformedWebhookPayloadError('destinatário inválido')

  const createdAt = stringOrNull(verified.created_at)
  const occurredAt = createdAt === null ? new Date(Number.NaN) : new Date(createdAt)
  if (Number.isNaN(occurredAt.getTime())) throw new MalformedWebhookPayloadError('data inválida')

  return [{
    provider: 'resend',
    providerEventId: eventId,
    type: normalizedType,
    providerMessageId: stringOrNull(verified.data.email_id),
    recipient,
    occurredAt,
    sendId: tagValue(verified.data.tags, 'send_id'),
    campaignKey: tagValue(verified.data.tags, 'campaign_key'),
  }]
}
export class ResendEmailProvider implements EmailProviderAdapter {
  readonly name = 'resend'
  private readonly webhookSecret: string
  private readonly client: ResendClientLike

  constructor(options: ResendEmailProviderOptions) {
    this.webhookSecret = options.webhookSecret
    this.client = options.client ?? (new Resend(options.apiKey) as unknown as ResendClientLike)
  }

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    let response: ResendSendResponse
    try {
      response = await this.client.emails.send({
        from: `${message.from.name} <${message.from.address}>`,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
        tags: [
          { name: 'send_id', value: message.tracking.sendId },
          { name: 'campaign_key', value: message.tracking.campaignKey },
        ],
      })
    } catch {
      throw new EmailProviderSendError('Falha de transporte do provedor de e-mail.', true)
    }

    const providerMessageId = stringOrNull(response.data?.id)
    if (response.error !== null && response.error !== undefined) {
      const retryable = RETRYABLE_ERROR_NAMES.has(response.error.name ?? '')
      throw new EmailProviderSendError('Provedor de e-mail recusou a solicitação.', retryable)
    }
    if (providerMessageId === null) {
      throw new EmailProviderSendError('Provedor de e-mail não retornou identificador.', true)
    }
    return { providerMessageId }
  }
  parseWebhook(request: WebhookRequest): NormalizedEmailEvent[] {
    const id = request.headers['svix-id']
    const timestamp = request.headers['svix-timestamp']
    const signature = request.headers['svix-signature']
    if (!id || !timestamp || !signature || this.webhookSecret.trim() === '') {
      throw new InvalidWebhookSignatureError()
    }

    let verified: unknown
    try {
      verified = this.client.webhooks.verify({
        payload: request.rawBody,
        headers: { id, timestamp, signature },
        webhookSecret: this.webhookSecret,
      })
    } catch {
      throw new InvalidWebhookSignatureError()
    }

    return normalizeEvent(verified, id)
  }
}
