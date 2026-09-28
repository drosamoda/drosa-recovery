import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { navForPath } from './nav'

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  const { pathname } = useLocation()
  const nav = navForPath(pathname)
  const Icon = nav?.icon
  return (
    <div className="enter mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-accent sm:flex" style={{ borderColor: 'var(--border-default)', background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.14), rgb(var(--c-data) / 0.06))' }}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="t-section mb-1 text-accent">{eyebrow}</p>}
          <h1 className="t-page-title">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
