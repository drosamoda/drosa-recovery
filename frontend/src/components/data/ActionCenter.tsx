import { Link } from 'react-router-dom'
import { StatusBadge } from '../feedback/StatusBadge'
import type { AttentionItem } from '../../lib/attention'

const LABEL = { danger: 'Crítico', warning: 'Atenção', neutral: 'Info' } as const

export function ActionCenter({ items }: { items: AttentionItem[] }) {
  return (
    <section className="mb-6 rounded-card border border-ink-faint/15 bg-surface-raised p-4" aria-label="Precisa de atenção">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Precisa de atenção</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Nada exige atenção agora.</p>
      ) : (
        <ul className="divide-y divide-ink-faint/10">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusBadge label={LABEL[i.severity]} tone={i.severity} />
                  <span className="text-sm font-medium text-ink">{i.title}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">{i.context}</p>
              </div>
              <Link to={i.to} className="shrink-0 text-sm text-bordo hover:underline">
                {i.action} →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
