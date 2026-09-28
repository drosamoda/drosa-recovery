import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { MiniSparkline } from '../charts/charts'

export type KpiTone = 'default' | 'accent' | 'data' | 'success' | 'warning' | 'danger'

const TONE: Record<KpiTone, { icon: string; spark: string }> = {
  default: { icon: 'text-ink-muted bg-white/5', spark: 'var(--chart-6)' },
  accent: { icon: 'text-accent bg-accent/10', spark: 'var(--chart-2)' },
  data: { icon: 'text-data bg-data/10', spark: 'var(--chart-1)' },
  success: { icon: 'text-status-success bg-status-success/10', spark: 'var(--chart-3)' },
  warning: { icon: 'text-status-warning bg-status-warning/10', spark: 'var(--chart-4)' },
  danger: { icon: 'text-status-danger bg-status-danger/10', spark: 'var(--chart-danger)' },
}

export interface KpiCardProps {
  label: string
  value: ReactNode
  icon?: LucideIcon
  tone?: KpiTone
  context?: ReactNode
  /** Série real (mesma fonte do valor). Sem série, sem sparkline. */
  spark?: number[]
  /** Comparação só quando existe base real; nunca seta fictícia. */
  comparison?: ReactNode
  status?: ReactNode
  tooltip?: string
  to?: string
  size?: 'md' | 'lg'
}

export function KpiCard({ label, value, icon: Icon, tone = 'default', context, spark, comparison, status, tooltip, to, size = 'md' }: KpiCardProps) {
  const t = TONE[tone]
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.icon}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          <p className="t-label truncate" title={tooltip}>{label}</p>
        </div>
        {status ?? (to && <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-accent" aria-hidden="true" />)}
      </div>
      <p className={`t-metric mt-3 ${size === 'lg' ? 'text-3xl' : 'text-2xl'}`}>{value}</p>
      {(context || comparison) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          {comparison}
          {context && <span>{context}</span>}
        </div>
      )}
      {spark && <div className="mt-3"><MiniSparkline values={spark} color={t.spark} /></div>}
    </>
  )
  const cls = 'panel enter group block min-w-0 p-4'
  if (to) {
    return (
      <Link to={to} className={`${cls} panel-interactive`} aria-label={`${label}: abrir detalhes`}>
        {body}
      </Link>
    )
  }
  return <div className={cls}>{body}</div>
}
