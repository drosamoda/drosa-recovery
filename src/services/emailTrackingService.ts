import type { EmailEventType, EmailSendStatus } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { hashEmail, InvalidConsentEmailError } from './emailConsentService'
import { EmailProviderAdapter, NormalizedEmailEvent, WebhookRequest } from './emailProviderAdapter'
import { applyProviderEvent, ProviderEventOutcome } from './emailSuppressionService'

// Tracking de e-mail: livro-razão de TENTATIVAS de envio (EmailSend), eventos do
// provedor (EmailEventLog) e atribuição de compra. Nada aqui envia e-mail, abre
// caminho de envio ou chama a Nuvemshop. Só ids opacos e o emailHash (HMAC): o
// e-mail em texto existe apenas em memória, no instante de calcular o hash.
//
// Ordem de segurança nos webhooks: a SUPRESSÃO é aplicada ANTES do registro do
// evento e também no reenvio (replay) do mesmo evento. Assim, se a primeira
// entrega falhou no meio (evento gravado, supressão não), o reenvio do provedor
// cura a situação — a supressão é idempotente.

// Política de atribuição, EXPLÍCITA e sem heurística escondida:
//  - só o ÚLTIMO CLIQUE conta, dentro de 7 dias ANTES do pedido;
//  - abertura NUNCA atribui (pré-carregamento de imagens de clientes de e-mail
//    infla aberturas sem que a pessoa tenha lido nada);
//  - um pedido é atribuído a no máximo UM envio.
export const EMAIL_ATTRIBUTION_WINDOW_DAYS = 7
export const EMAIL_ATTRIBUTION_MODEL = 'LAST_CLICK_7D'

// Cooldown por destinatário: no máximo 1 e-mail de marketing por janela.
export const EMAIL_RECIPIENT_COOLDOWN_HOURS = 72

// Provider "virtual" dos eventos gerados pelo próprio CRM (compra atribuída, envio registrado).
export const CRM_EVENT_PROVIDER = 'CRM'

export class InvalidTrackingInputError extends Error {}

export type EmailSendNotClaimableReason = 'NOT_FOUND' | 'RECIPIENT_MISMATCH' | 'NOT_QUEUED'

export class EmailSendNotClaimableError extends Error {
  readonly reason: EmailSendNotClaimableReason
  constructor(reason: EmailSendNotClaimableReason) {
    // Sem e-mail nem hash na mensagem: erro pode ir parar em log.
    super(`Tentativa de envio não pode ser reivindicada (${reason}).`)
    this.reason = reason
  }
}

const EMAIL_HASH_FORMAT = /^[0-9a-f]{64}$/
const CAMPAIGN_KEY_FORMAT = /^[A-Za-z0-9_-]{3,60}$/
const WAVE_FORMAT = /^[A-Za-z0-9_-]{1,20}$/
const REASON_CODE_FORMAT = /^[A-Z_]{3,40}$/

// ---------------------------------------------------------------------------
// Tentativas de envio
// ---------------------------------------------------------------------------

export interface ReserveEmailSendInput {
  emailHash: string
  campaignKey: string
  // Onda da campanha (reenvio legítimo à mesma pessoa depois): padrão "1".
  wave?: string
}

export function buildSendKey(input: ReserveEmailSendInput): string {
  if (!EMAIL_HASH_FORMAT.test(input.emailHash)) throw new InvalidTrackingInputError('emailHash inválido.')
  if (!CAMPAIGN_KEY_FORMAT.test(input.campaignKey)) throw new InvalidTrackingInputError('campaignKey inválida.')
  const wave = input.wave ?? '1'
  if (!WAVE_FORMAT.test(wave)) throw new InvalidTrackingInputError('wave inválida.')
  return `${input.campaignKey}:${wave}:${input.emailHash}`
}

export interface EmailSendReservation {
  // Vai no link de descadastro e nos custom args do provedor.
  sendId: string
  sendKey: string
  status: EmailSendStatus
  // false quando a mesma tentativa já existia (chamada repetida).
  created: boolean
}

// Reserva idempotente da tentativa (QUEUED). Repetir devolve a MESMA linha, nunca
// uma segunda — a base da garantia "no máximo um e-mail por campanha/onda/pessoa".
export async function reserveEmailSend(input: ReserveEmailSendInput): Promise<EmailSendReservation> {
  const sendKey = buildSendKey(input)
  return prisma.$transaction(async (tx) => {
    const created = await tx.emailSend.createMany({
      data: [{ sendKey, emailHash: input.emailHash, campaignKey: input.campaignKey }],
      skipDuplicates: true,
    })
    const row = await tx.emailSend.findUnique({ where: { sendKey }, select: { id: true, status: true } })
    if (row === null) throw new InvalidTrackingInputError('Reserva de envio não encontrada após a criação.')
    return { sendId: row.id, sendKey, status: row.status, created: created.count === 1 }
  })
}

// Claim atômico QUEUED -> SENDING: só UM chamador ganha. Quem perde (duplo clique,
// retry, worker concorrente, tentativa já enviada) recebe EmailSendNotClaimableError
// e NÃO envia. Confere também que a tentativa pertence a este destinatário.
export async function claimEmailSend(sendId: string, emailHash: string): Promise<void> {
  const claimed = await prisma.emailSend.updateMany({
    where: { id: sendId, emailHash, status: 'QUEUED' },
    data: { status: 'SENDING', attempts: { increment: 1 } },
  })
  if (claimed.count === 1) return

  const existing = await prisma.emailSend.findUnique({ where: { id: sendId }, select: { emailHash: true } })
  if (existing === null) throw new EmailSendNotClaimableError('NOT_FOUND')
  if (existing.emailHash !== emailHash) throw new EmailSendNotClaimableError('RECIPIENT_MISMATCH')
  throw new EmailSendNotClaimableError('NOT_QUEUED')
}

export interface EmailSendSuccess {
  provider: string
  providerMessageId: string
  at?: Date
}

// SENDING -> SENT + evento SENT. Um webhook rápido (DELIVERED antes desta
// gravação) não é rebaixado: o status só sobe se ainda estiver em SENDING, e
// os campos do provedor são gravados de qualquer forma.
export async function markEmailSendSent(sendId: string, success: EmailSendSuccess): Promise<void> {
  const at = success.at ?? new Date()
  await prisma.$transaction(async (tx) => {
    const send = await tx.emailSend.findUnique({ where: { id: sendId }, select: { emailHash: true, campaignKey: true } })
    if (send === null) throw new EmailSendNotClaimableError('NOT_FOUND')
    await tx.emailSend.updateMany({ where: { id: sendId, status: 'SENDING' }, data: { status: 'SENT' } })
    await tx.emailSend.updateMany({
      where: { id: sendId },
      data: { provider: success.provider, providerMessageId: success.providerMessageId, sentAt: at },
    })
    await tx.emailEventLog.createMany({
      data: [
        {
          provider: CRM_EVENT_PROVIDER,
          providerEventId: `sent:${sendId}`,
          type: 'SENT',
          emailHash: send.emailHash,
          sendId,
          campaignKey: send.campaignKey,
          occurredAt: at,
        },
      ],
      skipDuplicates: true,
    })
  })
}

export interface EmailSendFailure {
  // true = falha temporária: a tentativa volta a QUEUED e pode ser reivindicada de novo.
  retryable: boolean
  // Código curto em MAIÚSCULAS (nunca texto livre, nunca mensagem do provedor).
  reason: string
}

export async function markEmailSendFailed(sendId: string, failure: EmailSendFailure): Promise<void> {
  if (!REASON_CODE_FORMAT.test(failure.reason)) throw new InvalidTrackingInputError('reason precisa ser um código em maiúsculas.')
  await prisma.emailSend.updateMany({
    where: { id: sendId, status: 'SENDING' },
    data: { status: failure.retryable ? 'QUEUED' : 'FAILED', failureReason: failure.reason },
  })
}

// Contrato usado pelo dispatcher (injetável nos testes).
export interface EmailSendTracking {
  claim(sendId: string, emailHash: string): Promise<void>
  markSent(sendId: string, success: EmailSendSuccess): Promise<void>
  markFailed(sendId: string, failure: EmailSendFailure): Promise<void>
}

export const defaultEmailSendTracking: EmailSendTracking = {
  claim: (sendId, emailHash) => claimEmailSend(sendId, emailHash),
  markSent: (sendId, success) => markEmailSendSent(sendId, success),
  markFailed: (sendId, failure) => markEmailSendFailed(sendId, failure),
}

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

// SENDING conta (envio em andamento); QUEUED e FAILED não (nada saiu).
const COOLDOWN_STATUSES: EmailSendStatus[] = ['SENDING', 'SENT', 'DELIVERED', 'SOFT_BOUNCED']

export interface CooldownOptions {
  hours?: number
  now?: Date
  pepper?: string
}

export async function hasRecentEmailSend(email: string, options: CooldownOptions = {}): Promise<boolean> {
  const hours = options.hours ?? EMAIL_RECIPIENT_COOLDOWN_HOURS
  const now = options.now ?? new Date()
  const since = new Date(now.getTime() - hours * 3_600_000)
  const count = await prisma.emailSend.count({
    where: {
      emailHash: hashEmail(email, options.pepper ?? env.EMAIL_HASH_PEPPER),
      status: { in: COOLDOWN_STATUSES },
      OR: [{ sentAt: { gte: since } }, { sentAt: null, queuedAt: { gte: since } }],
    },
  })
  return count > 0
}

// ---------------------------------------------------------------------------
// Eventos do provedor
// ---------------------------------------------------------------------------

// Um evento atrasado nunca REBAIXA o estado (ex.: DELIVERED depois de HARD_BOUNCE).
const SEND_STATUS_RANK: Readonly<Record<EmailSendStatus, number>> = {
  QUEUED: 0,
  SENDING: 1,
  FAILED: 1,
  SENT: 2,
  SOFT_BOUNCED: 3,
  DELIVERED: 4,
  HARD_BOUNCED: 5,
  COMPLAINED: 6,
}

const SEND_STATUS_BY_EVENT: Readonly<Partial<Record<EmailEventType, EmailSendStatus>>> = {
  DELIVERED: 'DELIVERED',
  SOFT_BOUNCE: 'SOFT_BOUNCED',
  HARD_BOUNCE: 'HARD_BOUNCED',
  SPAM_COMPLAINT: 'COMPLAINED',
}

function statusesBelow(target: EmailSendStatus): EmailSendStatus[] {
  return (Object.keys(SEND_STATUS_RANK) as EmailSendStatus[]).filter((status) => SEND_STATUS_RANK[status] < SEND_STATUS_RANK[target])
}

export interface RecordedProviderEvent {
  // false = evento já registrado antes (replay do provedor).
  recorded: boolean
  // false = a tentativa não foi encontrada (ou é de outro destinatário): o evento
  // fica registrado sem vínculo e não altera nenhum envio.
  linkedToSend: boolean
  suppression: ProviderEventOutcome
}

export async function recordProviderEmailEvent(
  event: NormalizedEmailEvent,
  pepper: string = env.EMAIL_HASH_PEPPER,
): Promise<RecordedProviderEvent> {
  const emailHash = hashEmail(event.recipient, pepper)

  // 1) Segurança primeiro (idempotente, também no replay).
  const suppression = await applyProviderEvent(event, pepper)

  // 2) Registro do evento + avanço do status da tentativa, na mesma transação.
  return prisma.$transaction(async (tx) => {
    let sendId: string | null = null
    let campaignKey: string | null = event.campaignKey

    const send =
      event.sendId !== null
        ? await tx.emailSend.findUnique({ where: { id: event.sendId }, select: { id: true, emailHash: true, campaignKey: true } })
        : event.providerMessageId !== null
          ? await tx.emailSend.findFirst({
              where: { provider: event.provider, providerMessageId: event.providerMessageId },
              select: { id: true, emailHash: true, campaignKey: true },
            })
          : null
    // Só vincula se a tentativa é DESTE destinatário: um sendId forjado ou trocado
    // no provedor não consegue mexer no envio de outra pessoa.
    if (send !== null && send.emailHash === emailHash) {
      sendId = send.id
      campaignKey = send.campaignKey
    }

    const created = await tx.emailEventLog.createMany({
      data: [
        {
          provider: event.provider,
          providerEventId: event.providerEventId,
          type: event.type,
          emailHash,
          sendId,
          campaignKey,
          occurredAt: event.occurredAt,
        },
      ],
      skipDuplicates: true,
    })
    const recorded = created.count === 1

    const nextStatus = SEND_STATUS_BY_EVENT[event.type]
    if (recorded && sendId !== null && nextStatus !== undefined) {
      await tx.emailSend.updateMany({
        where: { id: sendId, status: { in: statusesBelow(nextStatus) } },
        data: { status: nextStatus },
      })
    }
    return { recorded, linkedToSend: sendId !== null, suppression }
  })
}

export interface WebhookIngestSummary {
  received: number
  recorded: number
  duplicates: number
  unlinked: number
  suppressed: number
  // Evento com destinatário fora do formato de e-mail: descartado, nunca gravado.
  rejected: number
}

// Único caminho de entrada de eventos do provedor. `adapter.parseWebhook` verifica
// a assinatura sobre o corpo BRUTO e lança antes de qualquer interpretação: com
// assinatura inválida NADA é gravado. Erro de banco propaga (o provedor reenvia o
// lote; o que já foi gravado vira duplicata e a supressão é reaplicada).
export async function ingestProviderWebhook(
  adapter: EmailProviderAdapter,
  request: WebhookRequest,
  pepper: string = env.EMAIL_HASH_PEPPER,
): Promise<WebhookIngestSummary> {
  const events = adapter.parseWebhook(request)
  const summary: WebhookIngestSummary = { received: events.length, recorded: 0, duplicates: 0, unlinked: 0, suppressed: 0, rejected: 0 }
  for (const event of events) {
    let outcome: RecordedProviderEvent
    try {
      outcome = await recordProviderEmailEvent(event, pepper)
    } catch (error) {
      if (error instanceof InvalidConsentEmailError) {
        summary.rejected++
        continue
      }
      throw error
    }
    if (outcome.recorded) summary.recorded++
    else summary.duplicates++
    if (!outcome.linkedToSend) summary.unlinked++
    if (outcome.suppression === 'SUPPRESSED') summary.suppressed++
  }
  return summary
}

// ---------------------------------------------------------------------------
// Atribuição de compra
// ---------------------------------------------------------------------------

export interface AttributePurchaseInput {
  email: string
  // Id do pedido na Nuvemshop. Quem chama passa só pedidos pagos e não cancelados.
  orderId: string
  total: number | string
  currency?: string
  orderedAt: Date
}

export type AttributionOutcome = 'ATTRIBUTED' | 'NOT_ATTRIBUTED' | 'DUPLICATE'

// Idempotente e re-executável: um pedido sem clique na janela não grava nada, então
// rodar de novo depois (clique que chegou atrasado no webhook) ainda pode atribuir.
export async function attributePurchase(
  input: AttributePurchaseInput,
  pepper: string = env.EMAIL_HASH_PEPPER,
  windowDays: number = EMAIL_ATTRIBUTION_WINDOW_DAYS,
): Promise<AttributionOutcome> {
  if (input.orderId.trim() === '') throw new InvalidTrackingInputError('orderId é obrigatório.')
  const total = Number(input.total)
  if (!Number.isFinite(total) || total < 0) throw new InvalidTrackingInputError('total inválido.')
  const emailHash = hashEmail(input.email, pepper)
  const windowStart = new Date(input.orderedAt.getTime() - windowDays * 86_400_000)
  const providerEventId = `purchase:${input.orderId}`

  return prisma.$transaction(async (tx) => {
    const existing = await tx.emailEventLog.findUnique({
      where: { provider_providerEventId: { provider: CRM_EVENT_PROVIDER, providerEventId } },
      select: { id: true },
    })
    if (existing !== null) return 'DUPLICATE'

    const click = await tx.emailEventLog.findFirst({
      where: { emailHash, type: 'CLICK', sendId: { not: null }, occurredAt: { gte: windowStart, lte: input.orderedAt } },
      orderBy: { occurredAt: 'desc' },
      select: { sendId: true, campaignKey: true },
    })
    if (click === null) return 'NOT_ATTRIBUTED'

    const created = await tx.emailEventLog.createMany({
      data: [
        {
          provider: CRM_EVENT_PROVIDER,
          providerEventId,
          type: 'PURCHASE',
          emailHash,
          sendId: click.sendId,
          campaignKey: click.campaignKey,
          occurredAt: input.orderedAt,
          orderId: input.orderId,
          revenue: new Prisma.Decimal(total.toFixed(2)),
          currency: input.currency ?? 'BRL',
          attributionModel: EMAIL_ATTRIBUTION_MODEL,
        },
      ],
      skipDuplicates: true,
    })
    return created.count === 1 ? 'ATTRIBUTED' : 'DUPLICATE'
  })
}
