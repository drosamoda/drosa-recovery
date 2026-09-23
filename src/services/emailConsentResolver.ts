// Resolvedor PURO do consentimento de e-mail: recebe o histórico de eventos de
// UM e-mail e devolve o estado atual. Sem banco, sem env, sem relógio — mesma
// entrada, mesma saída. Fail-closed: a ausência de prova, o conflito e o valor
// desconhecido NUNCA resultam em opt-in. Só CONFIRMED_OPT_IN é elegível, e
// mesmo ele não autoriza envio sozinho (o EmailSendGate exige outras condições).

export type EmailConsentStatus = 'OPT_IN' | 'OPT_OUT' | 'UNKNOWN'

export type EmailConsentSource =
  | 'NUVEMSHOP_ORDER_PAYLOAD'
  | 'NUVEMSHOP_CHECKOUT_PAYLOAD'
  | 'NUVEMSHOP_CUSTOMER_API'
  | 'NUBESDK_EXPLICIT'
  | 'CRM_UNSUBSCRIBE'
  | 'PROVIDER_EVENT'
  | 'MANUAL_IMPORT'

// Fontes que só podem registrar recusa: descadastro no CRM e eventos do
// provedor (unsubscribe, reclamação de spam) nunca provam consentimento.
export const OPT_OUT_ONLY_SOURCES: readonly EmailConsentSource[] = ['CRM_UNSUBSCRIBE', 'PROVIDER_EVENT']

// Um OPT_OUT destas fontes é REVOGAÇÃO EXPLICITA: permanece valendo mesmo que
// a Nuvemshop continue dizendo accepts_marketing=true (a loja não sabe do
// descadastro feito pelo nosso link). Só um novo opt-in explícito, posterior,
// levanta a revogação.
export const HARD_REVOCATION_SOURCES: readonly EmailConsentSource[] = [
  'CRM_UNSUBSCRIBE',
  'PROVIDER_EVENT',
  'NUBESDK_EXPLICIT',
  'MANUAL_IMPORT',
]

// Fontes que leem o ESTADO ATUAL do cliente (ou registram uma ação explícita)
// e por isso substituem snapshots mais antigos. Pedido/checkout são retratos
// do momento da compra: não substituem uns aos outros, entram em votação.
export const AUTHORITATIVE_SOURCES: readonly EmailConsentSource[] = ['NUVEMSHOP_CUSTOMER_API', 'NUBESDK_EXPLICIT']

// Única fonte capaz de levantar uma revogação explícita.
export const REVOCATION_LIFT_SOURCE: EmailConsentSource = 'NUBESDK_EXPLICIT'

export interface ConsentEventInput {
  status: EmailConsentStatus
  source: EmailConsentSource
  sourceUpdatedAt: Date | null
  capturedAt: Date
}

export type EmailConsentState = 'CONFIRMED_OPT_IN' | 'CONFIRMED_OPT_OUT' | 'UNKNOWN' | 'NOT_COLLECTED'

export type ConsentResolutionReason =
  | 'HARD_REVOCATION'
  | 'AUTHORITATIVE_LATEST'
  | 'SNAPSHOTS_UNANIMOUS'
  | 'SIGNAL_CONFLICT'
  | 'UNKNOWN_SIGNAL'
  | 'NO_SIGNAL'

export interface ConsentResolution {
  state: EmailConsentState
  // null somente quando state = NOT_COLLECTED (não há linha a gravar).
  status: EmailConsentStatus | null
  reason: ConsentResolutionReason
  eventCount: number
  lastEventAt: Date | null
}

// Combinação inválida (ex.: CRM_UNSUBSCRIBE com OPT_IN) é descartada da
// votação: ignorar um OPT_IN forjado é o lado fail-closed.
export function isValidConsentEvent(event: Pick<ConsentEventInput, 'source' | 'status'>): boolean {
  return !(OPT_OUT_ONLY_SOURCES.includes(event.source) && event.status !== 'OPT_OUT')
}

function occurredAt(event: ConsentEventInput): number {
  return (event.sourceUpdatedAt ?? event.capturedAt).getTime()
}

function isHardRevocation(event: ConsentEventInput): boolean {
  return event.status === 'OPT_OUT' && HARD_REVOCATION_SOURCES.includes(event.source)
}

function isLift(event: ConsentEventInput): boolean {
  return event.source === REVOCATION_LIFT_SOURCE && event.status === 'OPT_IN'
}

function isAuthoritative(event: ConsentEventInput): boolean {
  return AUTHORITATIVE_SOURCES.includes(event.source)
}

function toState(status: EmailConsentStatus): EmailConsentState {
  if (status === 'OPT_IN') return 'CONFIRMED_OPT_IN'
  if (status === 'OPT_OUT') return 'CONFIRMED_OPT_OUT'
  return 'UNKNOWN'
}

function result(
  status: EmailConsentStatus,
  reason: ConsentResolutionReason,
  eventCount: number,
  lastEventAt: Date | null,
): ConsentResolution {
  return { state: toState(status), status, reason, eventCount, lastEventAt }
}

export function resolveEmailConsent(rawEvents: readonly ConsentEventInput[]): ConsentResolution {
  const events = rawEvents.filter(isValidConsentEvent)
  const eventCount = events.length
  if (eventCount === 0) {
    return { state: 'NOT_COLLECTED', status: null, reason: 'NO_SIGNAL', eventCount: 0, lastEventAt: null }
  }
  const lastEventAt = new Date(Math.max(...events.map(occurredAt)))

  // 1) Revogação explícita: vale até um opt-in explícito ESTRITAMENTE posterior.
  const revocations = events.filter(isHardRevocation)
  let considered = events
  if (revocations.length > 0) {
    const latestRevocation = Math.max(...revocations.map(occurredAt))
    const lifted = events.some((event) => isLift(event) && occurredAt(event) > latestRevocation)
    if (!lifted) return result('OPT_OUT', 'HARD_REVOCATION', eventCount, lastEventAt)
    // Levantada: o que veio antes da revogação está velho e não vota mais.
    considered = events.filter((event) => occurredAt(event) > latestRevocation)
  }

  // 2) Fonte autoritativa mais recente substitui snapshots mais antigos. Votam
  //    ela (e empates de horário com ela) e tudo que for estritamente posterior.
  const authoritative = considered.filter(isAuthoritative)
  let voters = considered
  let hasAuthority = false
  if (authoritative.length > 0) {
    hasAuthority = true
    const latestAuthority = Math.max(...authoritative.map(occurredAt))
    voters = considered.filter(
      (event) => occurredAt(event) > latestAuthority || (isAuthoritative(event) && occurredAt(event) === latestAuthority),
    )
  }

  // 3) Votação fail-closed entre os votantes.
  if (voters.some((event) => event.status === 'UNKNOWN')) {
    return result('UNKNOWN', 'UNKNOWN_SIGNAL', eventCount, lastEventAt)
  }
  const optIns = voters.filter((event) => event.status === 'OPT_IN').length
  const optOuts = voters.length - optIns
  if (optIns > 0 && optOuts > 0) return result('UNKNOWN', 'SIGNAL_CONFLICT', eventCount, lastEventAt)
  return result(
    optIns > 0 ? 'OPT_IN' : 'OPT_OUT',
    hasAuthority ? 'AUTHORITATIVE_LATEST' : 'SNAPSHOTS_UNANIMOUS',
    eventCount,
    lastEventAt,
  )
}

// Única definição de "elegível" em consentimento de e-mail.
export function isConsentSendEligible(state: EmailConsentState): boolean {
  return state === 'CONFIRMED_OPT_IN'
}
