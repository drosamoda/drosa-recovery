import type { ReactNode } from 'react'
import { Inbox, type LucideIcon } from 'lucide-react'

export function EmptyState({ title, description, icon: Icon = Inbox, action }: { title: string; description?: string; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="enter flex flex-col items-center rounded-card border border-dashed p-10 text-center" style={{ borderColor: 'var(--border-default)' }}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-ink-faint">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
