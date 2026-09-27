import type { StatusTone } from '../components/feedback/StatusBadge'

// Mapas PURAMENTE VISUAIS: traduzem o codigo real do backend para um rotulo.
// Nunca decidem nada — codigo desconhecido cai no valor cru (humanize), e o
// valor tecnico original continua disponivel em tooltip onde e exibido.

export interface Label {
  label: string
  tone: StatusTone
}

// Vocabulario de status individual de mensagem. Nunca "Enviada": "sent" e
// "Disparada (aguardando entrega)", distinto de entregue/lida.
export const MESSAGE_STATUS: Record<string, Label> = {
  pending: { label: 'Na fila', tone: 'neutral' },
  processing: { label: 'Em processamento', tone: 'neutral' },
  sent: { label: 'Disparada · aguardando entrega', tone: 'neutral' },
  delivered: { label: 'Entregue', tone: 'success' },
  read: { label: 'Lida', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  // skipped e bloqueio deliberado de regra (consentimento, janela...), nao erro.
  skipped: { label: 'Não disparada · bloqueada', tone: 'warning' },
  unknown: { label: 'Estado desconhecido', tone: 'neutral' },
}

// Categorias de falha/bloqueio produzidas por normalizeFailure() no backend.
export const FAILURE_CATEGORY: Record<string, Label> = {
  CONSENT_BLOCK: { label: 'Sem consentimento', tone: 'warning' },
  SUPPRESSION_BLOCK: { label: 'Suprimido / opt-out', tone: 'warning' },
  TEMPLATE_CONFIGURATION: { label: 'Configuração de template', tone: 'danger' },
  RETRY_EXHAUSTED: { label: 'Tentativas esgotadas', tone: 'danger' },
  DATA_QUALITY: { label: 'Dado incompleto ou incerto', tone: 'warning' },
  NETWORK_TRANSIENT: { label: 'Falha de rede transitória', tone: 'warning' },
  PROVIDER_REJECTION: { label: 'Rejeitada pelo provedor', tone: 'danger' },
  DELIVERY_UNKNOWN: { label: 'Entrega não confirmada', tone: 'neutral' },
  INTERNAL_ERROR: { label: 'Erro interno', tone: 'danger' },
  UNKNOWN_REASON: { label: 'Motivo não identificado', tone: 'neutral' },
}

// Motivos de inelegibilidade de Recovery (evaluateAbandonedCheckoutEligibility
// e eligibilitySnapshot do remarketing). Valor tecnico sempre no tooltip.
export const ELIGIBILITY_REASON: Record<string, Label> = {
  consent_unproven: { label: 'Consentimento não comprovado', tone: 'warning' },
  no_consent: { label: 'Sem consentimento', tone: 'warning' },
  order_after_checkout: { label: 'Pedido feito após o carrinho', tone: 'neutral' },
  converted: { label: 'Já convertido', tone: 'neutral' },
  outside_window: { label: 'Fora da janela', tone: 'neutral' },
  suppressed: { label: 'Suprimido', tone: 'warning' },
  opt_out: { label: 'Opt-out', tone: 'warning' },
  suppressed_by_higher_priority_segment: { label: 'Prioridade superior', tone: 'neutral' },
  history_completeness_unverified: { label: 'Histórico incompleto', tone: 'warning' },
  order_timing_uncertain: { label: 'Momento do pedido incerto', tone: 'warning' },
  evaluation_unavailable: { label: 'Avaliação indisponível', tone: 'neutral' },
}

export function humanize(code: string): string {
  return code.replace(/[_-]+/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

export function lookup(map: Record<string, Label>, code: string | null | undefined): Label | null {
  if (!code) return null
  return map[code] ?? { label: humanize(code), tone: 'neutral' }
}

export function formatMoney(total: number | string | null | undefined): string {
  if (total === null || total === undefined || total === '') return '—'
  const numeric = typeof total === 'number' ? total : Number(total)
  if (Number.isFinite(numeric)) return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return String(total)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
