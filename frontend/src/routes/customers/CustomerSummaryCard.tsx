import { Clock, Mail, Phone, ShieldCheck, ShoppingBag } from 'lucide-react'
import type { CustomerDetail } from '../../lib/types'
import { StatusBadge } from '../../components/feedback/StatusBadge'
import { formatDateTime } from '../../lib/labels'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function latest(values: (string | null | undefined)[]): string | null {
  const ts = values.filter((v): v is string => Boolean(v)).sort()
  return ts.length ? ts[ts.length - 1] : null
}

// Header premium do Cliente 360: identidade, status, consentimentos, pedidos e
// contato mais recente — tudo derivado do próprio /crm-api/customers/:id.
export function CustomerSummaryCard({ customer }: { customer: CustomerDetail }) {
  const granted = customer.consents.filter((c) => c.consented && !c.revokedAt).map((c) => c.scope)
  const lastOrder = latest(customer.orders.map((o) => o.date))
  const lastContact = latest([...customer.messages.map((m) => m.createdAt), ...customer.conversations.map((c) => c.lastMessageAt)])
  return (
    <section className="panel enter relative overflow-hidden p-5" aria-label="Resumo do cliente">
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full blur-3xl" style={{ background: 'rgb(var(--c-accent) / 0.12)' }} aria-hidden="true" />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold text-white shadow-glow" style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent)), rgb(var(--c-data) / 0.8))' }} aria-hidden="true">
            {initials(customer.name || '?')}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-ink">{customer.name || 'Nome nao informado'}</h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
              <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />{customer.phone ?? 'Telefone nao informado'}</span>
              <span className="inline-flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" /><span className="truncate">{customer.email ?? 'E-mail nao informado'}</span></span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {customer.optOut && <StatusBadge label="Opt-out ativo" tone="warning" />}
              {customer.suppression && <StatusBadge label="Suprimido" tone="danger" />}
              {!customer.optOut && !customer.suppression && <StatusBadge label="Sem bloqueios ativos" tone="success" />}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          <HeaderStat icon={ShieldCheck} label="Consentimentos" value={granted.length ? granted.join(', ') : 'Nenhum ativo'} />
          <HeaderStat icon={ShoppingBag} label="Pedidos" value={`${customer.orders.length}${lastOrder ? ` · último ${formatDateTime(lastOrder).slice(0, 10)}` : ''}`} />
          <HeaderStat icon={Clock} label="Contato recente" value={lastContact ? formatDateTime(lastContact) : 'Sem contato'} />
        </dl>
      </div>
    </section>
  )
}

function HeaderStat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border p-2.5 sm:min-w-[9.5rem] sm:p-3" style={{ borderColor: 'var(--border-subtle)', background: 'rgb(var(--c-sunken) / 0.6)' }}>
      <dt className="flex items-center gap-1.5 text-[11px] text-ink-faint">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 text-xs font-medium text-ink [overflow-wrap:anywhere] sm:text-sm">{value}</dd>
    </div>
  )
}
