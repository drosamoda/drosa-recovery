import { EmptyState } from '../feedback/EmptyState'

export interface OrderListRow {
  id: string
  title: string
  meta: string | null
  status: string
  date: string | null
  value: string | null
}

// Reutilizavel para Pedidos e Recovery (checkouts/pix/boleto) do Cliente 360 —
// quem chama mapeia os dados reais da API para essas 5 chaves, sem que este
// componente conheca a forma original de Order/AbandonedCheckout.
export function OrderList({ rows, emptyLabel }: { rows: OrderListRow[]; emptyLabel: string }) {
  if (rows.length === 0) return <EmptyState title={emptyLabel} />

  return (
    <ul className="panel enter divide-y divide-white/5 overflow-hidden">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-white/[0.025] md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">{row.title}</p>
            {row.meta && <p className="text-xs text-ink-muted">{row.meta}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
            {row.value && <span className="font-medium tabular-nums text-ink">{row.value}</span>}
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs">{row.status}</span>
            {row.date && <span className="tabular-nums text-xs text-ink-faint">{new Date(row.date).toLocaleDateString('pt-BR')}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}
