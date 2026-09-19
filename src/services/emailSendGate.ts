import { env } from '../config/env'
import { EMAIL_MARKETING_CONSENT_SOURCE } from './emailAudienceEngine'

// Gate de envio de e-mail — FAIL-CLOSED por construção. Nesta fase nenhum
// e-mail real pode sair: não existe provedor de e-mail, fonte de consentimento
// validada, lista de descadastro/supressão nem histórico de envio. Cada
// condição abaixo é verificada de forma independente e TODAS precisam ser
// verdadeiras. As duas constantes marcadas como `false` não são configuráveis
// por env: só uma implementação real (em rodada posterior, com decisão humana
// sobre o provedor) as troca — nunca uma variável de ambiente esquecida ligada.
export const EMAIL_PROVIDER_CONFIGURED = false as boolean
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
