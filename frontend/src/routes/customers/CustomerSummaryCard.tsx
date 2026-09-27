import type { CustomerDetail } from '../../lib/types'
import { StatusBadge } from '../../components/feedback/StatusBadge'

export function CustomerSummaryCard({ customer }: { customer: CustomerDetail }) {
  return (
    <div className="rounded-card border border-ink-faint/15 bg-surface-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{customer.name || 'Nome nao informado'}</h2>
          <p className="text-sm text-ink-muted">{customer.phone ?? 'Telefone nao informado'}</p>
          <p className="text-sm text-ink-muted">{customer.email ?? 'E-mail nao informado'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {customer.optOut && <StatusBadge label="Opt-out ativo" tone="warning" />}
          {customer.suppression && <StatusBadge label="Suprimido" tone="danger" />}
          {!customer.optOut && !customer.suppression && <StatusBadge label="Sem bloqueios ativos" tone="success" />}
        </div>
      </div>
    </div>
  )
}
