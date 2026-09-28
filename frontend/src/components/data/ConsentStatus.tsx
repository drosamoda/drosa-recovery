import { StatusBadge, type StatusTone } from '../feedback/StatusBadge'

const CONSENT_LABEL: Record<string, string> = {
  GRANTED: 'Consentimento concedido',
  REVOKED: 'Consentimento revogado',
  UNKNOWN: 'Consentimento desconhecido',
}

// Tom sempre semantico, nunca derivado de um boolean isolado: GRANTED e um
// estado positivo real (success), REVOKED e negativo real (danger, nao so
// "false"), UNKNOWN e neutro (nem positivo nem negativo).
const CONSENT_TONE: Record<string, StatusTone> = {
  GRANTED: 'success',
  REVOKED: 'danger',
  UNKNOWN: 'neutral',
}

export function ConsentStatus({ consent }: { consent: 'GRANTED' | 'REVOKED' | 'UNKNOWN' }) {
  return <StatusBadge label={CONSENT_LABEL[consent] ?? consent} tone={CONSENT_TONE[consent] ?? 'neutral'} />
}
