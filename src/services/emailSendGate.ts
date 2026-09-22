import { env } from '../config/env'
import { EMAIL_MARKETING_CONSENT_SOURCE } from './emailAudienceEngine'
import { getEmailConsentState } from './emailConsentService'
import { EmailConsentState, isConsentSendEligible } from './emailConsentResolver'
import { normalizeEmail } from './emailConsentSignals'
import { isEmailSuppressed } from './emailSuppressionService'
import { hasRecentEmailSend } from './emailTrackingService'

// Gate de envio de e-mail — FAIL-CLOSED por construção. Nesta fase nenhum
// e-mail real pode sair: não existe provedor de e-mail, fonte de consentimento
// validada nem histórico de envio, e o código de supressão/descadastro ainda
// não foi ativado (migration não aplicada, link não exercitado). Cada
// condição abaixo é verificada de forma independente e TODAS precisam ser
// verdadeiras. As duas constantes marcadas como `false` não são configuráveis
// por env: só uma implementação real (em rodada posterior, com decisão humana
// sobre o provedor) as troca — nunca uma variável de ambiente esquecida ligada.
export const EMAIL_PROVIDER_CONFIGURED = false as boolean
// Continua false DE PROPÓSITO mesmo com o código de supressão e descadastro
// já escrito (emailSuppressionService, emailUnsubscribeToken, rota pública):
// enquanto a migration `add_email_suppression` não estiver aplicada e o link
// de descadastro não tiver sido exercitado de ponta a ponta num ambiente real,
// declarar "implementado" seria afirmar o que não foi provado. Só vira true por
// decisão humana explícita, depois dessa prova.
export const EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED = false as boolean

export interface EmailSendGateResult {
  allowed: boolean
  missing: string[]
}

export function evaluateEmailSendGate(): EmailSendGateResult {
  const missing: string[] = []
  if (!EMAIL_PROVIDER_CONFIGURED) missing.push('EMAIL_PROVIDER_NOT_CONFIGURED')
  if (EMAIL_MARKETING_CONSENT_SOURCE !== 'CONFIGURED') missing.push('EMAIL_MARKETING_CONSENT_SOURCE_NOT_CONFIGURED')
  if (!EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED) missing.push('EMAIL_UNSUBSCRIBE_SUPPRESSION_NOT_IMPLEMENTED')
  if (!env.EMAIL_SEND_ENABLED) missing.push('EMAIL_SEND_DISABLED')
  return { allowed: missing.length === 0, missing }
}

export class EmailSendNotAvailableError extends Error {
  readonly missing: string[]
  constructor(missing: string[]) {
    super(`Envio de e-mail indisponível nesta fase — condições ausentes: ${missing.join(', ')}. Nenhum e-mail é enviado ou agendado.`)
    this.missing = missing
  }
}

// Único ponto de "agendar/enviar" e-mail: chamado por campaignService.schedule()
// para drafts de e-mail. Sempre lança enquanto qualquer condição faltar.
export function assertEmailSendAllowed(): void {
  const gate = evaluateEmailSendGate()
  if (!gate.allowed) throw new EmailSendNotAvailableError(gate.missing)
}

// ---------------------------------------------------------------------------
// Gate POR DESTINATÁRIO — liga o gate ao livro-razão de consentimento e à
// lista de supressão. Ele NÃO substitui o gate global acima: um envio precisa
// passar nos DOIS (global aberto E destinatário liberado). Fail-closed: qualquer
// dúvida (e-mail inválido, sem consentimento, suprimido, erro de banco, pepper
// ausente) bloqueia. Só CONFIRMED_OPT_IN e não suprimido libera.
// ---------------------------------------------------------------------------

export type EmailRecipientBlock =
  | 'EMAIL_INVALID'
  | 'EMAIL_SUPPRESSED'
  | 'EMAIL_CONSENT_NOT_OPT_IN'
  | 'EMAIL_COOLDOWN_ACTIVE'
  | 'EMAIL_RECIPIENT_CHECK_UNAVAILABLE'

export interface EmailRecipientGateResult {
  allowed: boolean
  blocks: EmailRecipientBlock[]
  // null quando o e-mail é inválido ou a verificação não pôde ser feita.
  consentState: EmailConsentState | null
}

export interface EmailRecipientGateDeps {
  getConsentState: (email: string) => Promise<{ state: EmailConsentState }>
  isSuppressed: (email: string) => Promise<boolean>
  // Cooldown por destinatário (histórico de envios). Opcional para não quebrar quem
  // injeta só consentimento/supressão; o padrão REAL abaixo sempre o inclui.
  isInCooldown?: (email: string) => Promise<boolean>
}

const defaultRecipientDeps: EmailRecipientGateDeps = {
  getConsentState: (email) => getEmailConsentState(email),
  isSuppressed: (email) => isEmailSuppressed(email),
  isInCooldown: (email) => hasRecentEmailSend(email),
}

export async function evaluateEmailRecipientGate(
  email: string,
  deps: EmailRecipientGateDeps = defaultRecipientDeps,
): Promise<EmailRecipientGateResult> {
  if (normalizeEmail(email) === null) return { allowed: false, blocks: ['EMAIL_INVALID'], consentState: null }

  let checks: [{ state: EmailConsentState }, boolean, boolean]
  try {
    checks = await Promise.all([
      deps.getConsentState(email),
      deps.isSuppressed(email),
      deps.isInCooldown ? deps.isInCooldown(email) : Promise.resolve(false),
    ])
  } catch {
    // Não distingue a causa de propósito (banco fora, pepper ausente, tabela
    // inexistente): sem prova, não envia. A mensagem do erro nunca sai daqui —
    // ela poderia carregar dado sensível.
    return { allowed: false, blocks: ['EMAIL_RECIPIENT_CHECK_UNAVAILABLE'], consentState: null }
  }

  const [consent, suppressed, inCooldown] = checks
  const blocks: EmailRecipientBlock[] = []
  if (suppressed) blocks.push('EMAIL_SUPPRESSED')
  if (!isConsentSendEligible(consent.state)) blocks.push('EMAIL_CONSENT_NOT_OPT_IN')
  if (inCooldown) blocks.push('EMAIL_COOLDOWN_ACTIVE')
  return { allowed: blocks.length === 0, blocks, consentState: consent.state }
}

export class EmailRecipientBlockedError extends Error {
  readonly blocks: EmailRecipientBlock[]
  constructor(blocks: EmailRecipientBlock[]) {
    // Sem o e-mail na mensagem: erro pode ir parar em log.
    super(`Destinatário bloqueado pelo gate de e-mail: ${blocks.join(', ')}.`)
    this.blocks = blocks
  }
}

export async function assertEmailRecipientAllowed(
  email: string,
  deps: EmailRecipientGateDeps = defaultRecipientDeps,
): Promise<void> {
  const result = await evaluateEmailRecipientGate(email, deps)
  if (!result.allowed) throw new EmailRecipientBlockedError(result.blocks)
}

export interface EmailSendDecision {
  allowed: boolean
  // Condições globais ausentes (mesma lista de evaluateEmailSendGate).
  globalMissing: string[]
  // null quando o gate global está fechado: nesse caso o destinatário NEM é
  // consultado (nenhuma leitura de banco enquanto não pode haver envio).
  recipient: EmailRecipientGateResult | null
}

// Visão completa para telas e diagnóstico: global primeiro, destinatário só se
// o global permitir.
export async function evaluateEmailSendForRecipient(
  email: string,
  deps: EmailRecipientGateDeps = defaultRecipientDeps,
  evaluateGlobal: () => EmailSendGateResult = evaluateEmailSendGate,
): Promise<EmailSendDecision> {
  const global = evaluateGlobal()
  if (!global.allowed) return { allowed: false, globalMissing: global.missing, recipient: null }
  const recipient = await evaluateEmailRecipientGate(email, deps)
  return { allowed: recipient.allowed, globalMissing: [], recipient }
}
