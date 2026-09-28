import type { Series } from '../components/charts/charts'

// Partição exclusiva de mensagens por status (mesma semântica do BI): nunca "Enviadas".
export const MESSAGE_SERIES: Series[] = [
  { key: 'read', label: 'Lidas', color: 'var(--chart-3)' },
  { key: 'delivered', label: 'Entregues (não lidas)', color: 'var(--chart-1)' },
  { key: 'awaiting', label: 'Disparadas · aguardando entrega', color: 'var(--chart-5)' },
  { key: 'queued', label: 'Na fila', color: 'var(--chart-6)' },
  { key: 'blocked', label: 'Bloqueadas (regra)', color: 'var(--chart-4)' },
  { key: 'failed', label: 'Falhas', color: 'var(--chart-danger)' },
]

// Série do gráfico -> filtro real de /messages?status=
export const SERIES_TO_STATUS: Record<string, string> = { read: 'read', delivered: 'delivered', awaiting: 'sent', queued: 'pending', blocked: 'skipped', failed: 'failed' }

export const CART_SERIES: Series[] = [
  { key: 'abandoned', label: 'Carrinhos abandonados', color: 'var(--chart-2)' },
  { key: 'eligible', label: 'Elegíveis (estado atual)', color: 'var(--chart-4)' },
  { key: 'dispatched', label: 'Com mensagem disparada', color: 'var(--chart-1)' },
]

export const ORDER_SERIES: Series[] = [
  { key: 'paid', label: 'Pagos', color: 'var(--chart-3)' },
  { key: 'pending', label: 'Pagamento pendente', color: 'var(--chart-4)' },
  { key: 'other', label: 'Outros status', color: 'var(--chart-6)' },
]
