// Contrato do provedor de e-mail. NENHUM provedor real está ligado nesta fase e a
// escolha entre eles continua em aberto: este arquivo só define a fronteira que
// qualquer um (SendGrid, Resend, SES...) terá de cumprir. O CRM é a fonte de
// verdade — segmentação, consentimento e supressão nunca migram para o provedor,
// que só recebe UMA mensagem já autorizada pelo gate e devolve eventos.
//
// Regras do contrato:
//  - Nada aqui importa serviços, banco ou env: é só tipos e erros.
//  - `send` NUNCA deve ser chamado diretamente por código de negócio; o único
//    caminho é sendEmailThroughGate (emailDispatcher.ts), que aplica o gate.
//  - `parseWebhook` recebe o corpo BRUTO (antes do JSON.parse) e verifica a
//    assinatura do provedor ele mesmo; assinatura inválida lança
//    InvalidWebhookSignatureError e NADA é interpretado.
//  - Eventos saem normalizados: o resto do sistema nunca vê formato de provedor.

export type EmailProviderEventType =
  | 'DELIVERED'
  | 'DEFERRED'
  | 'SOFT_BOUNCE'
  | 'HARD_BOUNCE'
  | 'BLOCKED'
  | 'SPAM_COMPLAINT'
  | 'UNSUBSCRIBE'
  | 'OPEN'
  | 'CLICK'

export interface OutboundEmail {
  // Endereço do destinatário: só existe aqui, no instante do envio. Nunca é
  // gravado em tabela nem colocado em log.
  to: string
  from: { address: string; name: string }
  subject: string
  html: string
  text: string
  // Cabeçalhos extras. Toda mensagem de marketing DEVE carregar List-Unsubscribe
  // e List-Unsubscribe-Post (RFC 8058) — o dispatcher recusa sem eles.
  headers: Readonly<Record<string, string>>
  // Vira "custom args"/tags no provedor e volta nos webhooks para atribuição.
  // Somente identificadores internos; nenhum e-mail, nome ou telefone.
  tracking: { sendId: string; campaignKey: string }
}

export interface EmailSendResult {
  providerMessageId: string
}

export interface NormalizedEmailEvent {
  provider: string
  // Id do evento no provedor: base da idempotência (o mesmo evento reenviado
  // pelo provedor não pode duplicar supressão nem métrica).
  providerEventId: string
  type: EmailProviderEventType
  providerMessageId: string | null
  // Destinatário como o provedor informou. Serve SÓ para calcular o emailHash
  // e nunca é persistido nem logado.
  recipient: string
  occurredAt: Date
  sendId: string | null
  campaignKey: string | null
}

export interface WebhookRequest {
  // Corpo exatamente como recebido (string), NUNCA o objeto já parseado.
  rawBody: string
  // Nomes de cabeçalho em minúsculas.
  headers: Readonly<Record<string, string | undefined>>
}

export interface EmailProviderAdapter {
  readonly name: string
  send(message: OutboundEmail): Promise<EmailSendResult>
  parseWebhook(request: WebhookRequest): NormalizedEmailEvent[]
}

export class EmailProviderSendError extends Error {
  // true = falha temporária (timeout, 5xx, limite de taxa): pode tentar de novo.
  // false = rejeição definitiva (endereço inválido, conteúdo recusado).
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super('Assinatura do webhook do provedor de e-mail inválida.')
  }
}

export class MalformedWebhookPayloadError extends Error {
  constructor(detail: string) {
    super(`Payload do webhook do provedor de e-mail malformado: ${detail}`)
  }
}
