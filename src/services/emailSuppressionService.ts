import type { EmailSuppressionReason } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { hashEmail, recordEmailConsentEventByHashInTx } from './emailConsentService'
import { EmailConsentSource } from './emailConsentResolver'
import { EmailProviderEventType, NormalizedEmailEvent } from './emailProviderAdapter'

// Supressão de e-mail. Separada da tabela `suppressions` (WhatsApp, chaveada por
// telefone): aqui a chave é o emailHash do consentimento e o e-mail em texto
// nunca é gravado. Existir linha = NUNCA enviar a esse e-mail, qualquer que seja
// o consentimento. Não há "levantar" no código (fail-closed por decisão): remover
// uma linha é ato manual e deliberado, fora daqui — um opt-in posterior no
// livro-razão NÃO reabre um e-mail suprimido.

export class InvalidSuppressionError extends Error {}

const EMAIL_HASH_FORMAT = /^[0-9a-f]{64}$/

// Motivos que são também REVOGAÇÃO de consentimento entram no livro-razão como
// OPT_OUT da fonte correspondente; bounce duro e endereço inválido bloqueiam o
// envio mas não dizem nada sobre consentimento, então não geram evento.
const CONSENT_SOURCE_BY_REASON: Readonly<Partial<Record<EmailSuppressionReason, EmailConsentSource>>> = {
  UNSUBSCRIBE: 'CRM_UNSUBSCRIBE',
  PROVIDER_UNSUBSCRIBE: 'PROVIDER_EVENT',
  SPAM_COMPLAINT: 'PROVIDER_EVENT',
  MANUAL: 'MANUAL_IMPORT',
}

export interface SuppressEmailByHashInput {
  emailHash: string
  reason: EmailSuppressionReason
  // Identifica a observação (ex.: "unsubscribe-link:<sendId>:<emissão>" ou
  // "provider:<nome>:<idDoEvento>"). Nunca e-mail, nome, telefone ou payload.
  evidenceRef: string
  occurredAt?: Date
}

export interface SuppressEmailResult {
  // true só na PRIMEIRA supressão do e-mail; reenvios do mesmo evento dão false.
  newlySuppressed: boolean
  // true quando o motivo também foi registrado como OPT_OUT no livro-razão.
  consentRevoked: boolean
}

// Núcleo: recebe o hash (o descadastro por link só conhece o hash). Bloqueio e
// evento do livro-razão são gravados na MESMA transação: ou os dois ou nenhum.
// `createMany` + `skipDuplicates` torna a criação idempotente e segura contra
// concorrência (a primeira supressão vence, sem violação de unicidade).
export async function suppressEmailByHash(input: SuppressEmailByHashInput): Promise<SuppressEmailResult> {
  if (!EMAIL_HASH_FORMAT.test(input.emailHash)) throw new InvalidSuppressionError('emailHash inválido.')
  if (input.evidenceRef.trim() === '') throw new InvalidSuppressionError('evidenceRef é obrigatório.')
  const occurredAt = input.occurredAt ?? new Date()
  const consentSource = CONSENT_SOURCE_BY_REASON[input.reason]

  return prisma.$transaction(async (tx) => {
    const created = await tx.emailSuppression.createMany({
      data: [{ emailHash: input.emailHash, reason: input.reason, evidenceRef: input.evidenceRef, suppressedAt: occurredAt }],
      skipDuplicates: true,
    })
    if (consentSource !== undefined) {
      await recordEmailConsentEventByHashInTx(tx, input.emailHash, {
        status: 'OPT_OUT',
        source: consentSource,
        evidenceRef: input.evidenceRef,
        sourceUpdatedAt: occurredAt,
        capturedAt: occurredAt,
      })
    }
    return { newlySuppressed: created.count === 1, consentRevoked: consentSource !== undefined }
  })
}

export interface SuppressEmailInput {
  email: string
  reason: EmailSuppressionReason
  evidenceRef: string
  occurredAt?: Date
}

// Conveniência para quem tem o e-mail em mãos (descadastro manual, evento do
// provedor). E-mail inválido ou pepper ausente lançam antes de tocar no banco.
export async function suppressEmail(
  input: SuppressEmailInput,
  pepper: string = env.EMAIL_HASH_PEPPER,
): Promise<SuppressEmailResult> {
  return suppressEmailByHash({
    emailHash: hashEmail(input.email, pepper),
    reason: input.reason,
    evidenceRef: input.evidenceRef,
    occurredAt: input.occurredAt,
  })
}

// Leitura para o gate. E-mail inválido lança InvalidConsentEmailError e falta de
// pepper lança EmailHashPepperNotConfiguredError — quem chama trata como bloqueio.
export async function isEmailSuppressed(email: string, pepper: string = env.EMAIL_HASH_PEPPER): Promise<boolean> {
  const row = await prisma.emailSuppression.findUnique({
    where: { emailHash: hashEmail(email, pepper) },
    select: { emailHash: true },
  })
  return row !== null
}

// ---------------------------------------------------------------------------
// Eventos do provedor → supressão. Só três tipos bloqueiam definitivamente; o
// resto (entrega, adiamento, bounce mole, bloqueio de reputação, abertura,
// clique) não diz nada sobre o ENDEREÇO ou o consentimento e é ignorado aqui.
// ---------------------------------------------------------------------------

const SUPPRESSION_REASON_BY_EVENT: Readonly<Partial<Record<EmailProviderEventType, EmailSuppressionReason>>> = {
  HARD_BOUNCE: 'HARD_BOUNCE',
  SPAM_COMPLAINT: 'SPAM_COMPLAINT',
  UNSUBSCRIBE: 'PROVIDER_UNSUBSCRIBE',
}

export function suppressionReasonForProviderEvent(type: EmailProviderEventType): EmailSuppressionReason | null {
  return SUPPRESSION_REASON_BY_EVENT[type] ?? null
}

export type ProviderEventOutcome = 'SUPPRESSED' | 'ALREADY_SUPPRESSED' | 'IGNORED'

// Idempotente: o mesmo evento reenviado pelo provedor tem o mesmo evidenceRef
// (provedor + id do evento) e não duplica nada.
export async function applyProviderEvent(
  event: NormalizedEmailEvent,
  pepper: string = env.EMAIL_HASH_PEPPER,
): Promise<ProviderEventOutcome> {
  const reason = suppressionReasonForProviderEvent(event.type)
  if (reason === null) return 'IGNORED'
  const result = await suppressEmail(
    {
      email: event.recipient,
      reason,
      evidenceRef: `provider:${event.provider}:${event.providerEventId}`,
      occurredAt: event.occurredAt,
    },
    pepper,
  )
  return result.newlySuppressed ? 'SUPPRESSED' : 'ALREADY_SUPPRESSED'
}
