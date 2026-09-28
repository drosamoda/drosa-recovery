import { CalendarDays } from 'lucide-react'
import { PERIODS, usePeriod, type PeriodKey } from '../../lib/period'

// Filtro global de período (compartilhado entre Dashboard, Recovery, Mensagens
// e BI). `allowed` restringe às janelas que a fonte da página suporta.
export function PeriodFilter({ allowed }: { allowed?: PeriodKey[] }) {
  const { period, setPeriod } = usePeriod()
  const options = allowed ? PERIODS.filter((p) => allowed.includes(p.key)) : PERIODS
  return (
    <div role="radiogroup" aria-label="Período" className="inline-flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--border-default)', background: 'rgb(var(--c-sunken) / 0.7)' }}>
      <CalendarDays className="mx-1.5 h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
      {options.map((p) => {
        const active = p.key === period
        return (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={p.label}
            onClick={() => setPeriod(p.key)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition-all duration-150 ${active ? 'bg-accent text-white shadow-glow' : 'text-ink-muted hover:bg-white/5 hover:text-ink'}`}
          >
            {p.short}
          </button>
        )
      })}
    </div>
  )
}
