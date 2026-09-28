import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, OctagonAlert, TriangleAlert, Info } from 'lucide-react'
import type { AttentionItem } from '../../lib/attention'

const SEVERITY = {
  danger: { label: 'Crítico', icon: OctagonAlert, cls: 'text-status-danger bg-status-danger/10', bar: 'bg-status-danger' },
  warning: { label: 'Atenção', icon: TriangleAlert, cls: 'text-status-warning bg-status-warning/10', bar: 'bg-status-warning' },
  neutral: { label: 'Info', icon: Info, cls: 'text-data bg-data/10', bar: 'bg-data' },
} as const

export function ActionCenter({ items }: { items: AttentionItem[] }) {
  return (
    <section className="panel enter overflow-hidden" aria-label="Precisa de atenção">
      <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <h2 className="t-section">Precisa de atenção</h2>
        {items.length > 0 && <span className="rounded-full bg-white/5 px-2 text-xs tabular-nums text-ink-muted">{items.length}</span>}
      </header>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-5 text-sm text-ink-muted">
          <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden="true" />
          Nada exige atenção agora.
        </p>
      ) : (
        <ul>
          {items.map((i) => {
            const s = SEVERITY[i.severity]
            const Icon = s.icon
            return (
              <li key={i.key} className="relative border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className={`absolute inset-y-0 left-0 w-0.5 ${s.bar}`} aria-hidden="true" />
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${s.cls}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        <span className="sr-only">{s.label}: </span>
                        {i.title}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">{i.context}</p>
                    </div>
                  </div>
                  <Link to={i.to} className="btn shrink-0 text-xs">
                    {i.action}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
