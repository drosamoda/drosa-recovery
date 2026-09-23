import { env } from '../config/env'
import { logger } from '../config/logger'
import { hashEmail } from './emailConsentService'
import { EmailProviderAdapter, EmailProviderSendError, EmailSendResult, OutboundEmail } from './emailProviderAdapter'
import { assertEmailRecipientAllowed, assertEmailSendAllowed, EmailRecipientGateDeps } from './emailSendGate'
import { defaultEmailSendTracking, EmailSendTracking } from './emailTrackingService'
import {
  buildListUnsubscribeHeaders,
  buildUnsubscribeUrl,
  LIST_UNSUBSCRIBE_POST_VALUE,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './emailUnsubscribeToken'

// ÚNICO caminho até `adapter.send`. Nenhum código de negócio chama o adapter
// diretamente. Ordem, todas fail-closed (a primeira falha interrompe):
//   1. gate global  — hoje SEMPRE fechado (provedor/consentimento/supressão/flag);
//                     nenhuma leitura de banco acontece antes dele;
//   2. cabeçalhos   — List-Unsubscribe + One-Click presentes E pertencentes a
//                     este destinatário (token assinado com o hash dele);
//   3. destinatário — consentimento CONFIRMED_OPT_IN, não suprimido e fora do
//                     cooldown;
//   4. tentativa    — claim atômico QUEUED -> SENDING (EmailSend): duplo clique,
//                     retry ou worker concorrente NÃO enviam de novo;
//   5. só então adapter.send; depois registra SENT (ou FAILED / de volta a QUEUED).
// As checagens 1-3 não têm efeito colateral: nada é gravado antes de todas passarem.

export class MissingUnsubscribeHeadersError extends Error {
  constructor(detail: string) {
    super(`Mensagem de marketing recusada: ${detail}`)
  }
}

export interface DispatchDeps {
  assertGlobalGate?: () => void
  recipient?: EmailRecipientGateDeps
  // Livro-razão das tentativas de envio (padrão: o real, em banco). Injetável nos testes.
  tracking?: EmailSendTracking
}

function findHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const wanted = name.toLowerCase()
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted)
  return key === undefined ? undefined : headers[key]
}

// Extrai a URL https de "<https://...>" (o formato de List-Unsubscribe).
function extractHttpsUrl(headerValue: string): URL | null {
  const match = /<(https:\/\/[^>\s]+)>/i.exec(headerValue)
  if (match === null) return null
  try {
    return new URL(match[1])
  } catch {
    return null
  }
}

// Verifica que a mensagem leva o descadastro de UM clique e que o link é DO
// destinatário: um token de outro e-mail (ou adulterado) recusa o envio, para
// que ninguém seja descadastrado — nem deixe de ser — por link alheio.
export function assertUnsubscribeHeadersForRecipient(
  headers: Readonly<Record<string, string>>,
  to: string,
  pepper: string = env.EMAIL_HASH_PEPPER,
  expectedSendId?: string,
): void {
  const listUnsubscribe = findHeader(headers, 'List-Unsubscribe')
  const listUnsubscribePost = findHeader(headers, 'List-Unsubscribe-Post')
  if (listUnsubscribe === undefined || listUnsubscribePost === undefined) {
    throw new MissingUnsubscribeHeadersError('faltam List-Unsubscribe e/ou List-Unsubscribe-Post.')
  }
  if (listUnsubscribePost.trim() !== LIST_UNSUBSCRIBE_POST_VALUE) {
    throw new MissingUnsubscribeHeadersError('List-Unsubscribe-Post precisa ser "List-Unsubscribe=One-Click".')
  }
  const url = extractHttpsUrl(listUnsubscribe)
  if (url === null) throw new MissingUnsubscribeHeadersError('List-Unsubscribe precisa conter uma URL https entre <>.')

  const verification = verifyUnsubscribeToken(url.searchParams.get('t'))
  if (!verification.ok) {
    throw new MissingUnsubscribeHeadersError(`o token do link de descadastro não é válido (${verification.reason}).`)
  }
  if (verification.payload.emailHash !== hashEmail(to, pepper)) {
    throw new MissingUnsubscribeHeadersError('o link de descadastro não pertence a este destinatário.')
  }
  // O link carrega o sendId da própria tentativa (quando emitido com um): um link de
  // OUTRA tentativa quebraria a atribuição do descadastro à campanha certa.
  if (expectedSendId !== undefined && verification.payload.sendId !== null && verification.payload.sendId !== expectedSendId) {
    throw new MissingUnsubscribeHeadersError('o link de descadastro pertence a outra tentativa de envio.')
  }
}

export async function sendEmailThroughGate(
  adapter: EmailProviderAdapter,
  message: OutboundEmail,
  deps: DispatchDeps = {},
): Promise<EmailSendResult> {
  const assertGlobalGate = deps.assertGlobalGate ?? assertEmailSendAllowed
  assertGlobalGate()
  assertUnsubscribeHeadersForRecipient(message.headers, message.to, undefined, message.tracking.sendId)
  await assertEmailRecipientAllowed(message.to, deps.recipient)

  // Só aqui, com TODOS os gates aprovados, a tentativa é reivindicada. Perder o
  // claim (já enviada, em andamento, de outro destinatário) lança e não envia.
  const tracking = deps.tracking ?? defaultEmailSendTracking
  const { sendId } = message.tracking
  await tracking.claim(sendId, hashEmail(message.to))

  let result: EmailSendResult
  try {
    result = await adapter.send(message)
  } catch (error) {
    if (error instanceof EmailProviderSendError) {
      // Rejeição conhecida: volta a QUEUED (temporária) ou vira FAILED (definitiva).
      try {
        await tracking.markFailed(sendId, {
          retryable: error.retryable,
          reason: error.retryable ? 'PROVIDER_TEMPORARY' : 'PROVIDER_REJECTED',
        })
      } catch (trackingError) {
        // Não mascara o erro do provedor; a tentativa fica em SENDING (revisão humana).
        logger.error('[email/dispatch] falha ao registrar a rejeição do provedor', {
          errorName: trackingError instanceof Error ? trackingError.name : 'unknown',
        })
      }
    }
    // Qualquer OUTRO erro deixa a tentativa em SENDING de propósito: não se sabe se
    // o provedor aceitou a mensagem, e reenviar automaticamente arriscaria duplicar.
    // O webhook (DELIVERED/BOUNCE) reconcilia; o resto é revisão humana.
    throw error
  }

  try {
    await tracking.markSent(sendId, { provider: adapter.name, providerMessageId: result.providerMessageId })
  } catch (error) {
    // A mensagem JÁ saiu: não relança (o chamador poderia reenviar). A tentativa fica
    // em SENDING e o webhook do provedor a reconcilia. Só o NOME do erro é logado.
    logger.error('[email/dispatch] envio feito, mas o registro do envio falhou', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
  }
  return result
}

export interface IssueUnsubscribeOptions {
  sendId?: string | null
  issuedAt?: Date
  pepper?: string
  secret?: string
  baseUrl?: string
}

// Monta os cabeçalhos List-Unsubscribe/One-Click de UM destinatário. Lança se o
// pepper, a chave de assinatura ou a URL https não estiverem configurados —
// sem link válido não há mensagem.
export function issueUnsubscribeHeaders(email: string, options: IssueUnsubscribeOptions = {}): Record<string, string> {
  const emailHash = hashEmail(email, options.pepper)
  const token = signUnsubscribeToken({ emailHash, sendId: options.sendId, issuedAt: options.issuedAt }, options.secret)
  return buildListUnsubscribeHeaders(buildUnsubscribeUrl(token, options.baseUrl))
}
