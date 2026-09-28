import type { ReactNode } from 'react'
import { BarChart3 } from 'lucide-react'

// Moldura padrão de gráfico: título + a pergunta operacional que ele responde.
export function ChartCard({ title, question, actions, footer, children, className = '' }: { title: string; question?: string; actions?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel enter flex min-w-0 flex-col p-4 md:p-5 ${className}`} aria-label={title}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {question && <p className="mt-0.5 text-xs text-ink-faint">{question}</p>}
        </div>
        {actions}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
      {footer && <footer className="mt-3 border-t pt-3 text-xs text-ink-faint" style={{ borderColor: 'var(--border-subtle)' }}>{footer}</footer>}
    </section>
  )
}

export function ChartEmptyState({ title = 'Sem eventos no período', description }: { title?: string; description?: string }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center" style={{ borderColor: 'var(--border-default)' }}>
      <BarChart3 className="h-5 w-5 text-ink-faint" aria-hidden="true" />
      <p className="text-sm text-ink-muted">{title}</p>
      {description && <p className="max-w-xs text-xs text-ink-faint">{description}</p>}
    </div>
  )
}

export interface LegendItem {
  label: string
  color: string
  value?: string
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: i.color }} aria-hidden="true" />
          <span>{i.label}</span>
          {i.value && <span className="tabular-nums text-ink">{i.value}</span>}
        </li>
      ))}
    </ul>
  )
}
