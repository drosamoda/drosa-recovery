import type { LucideIcon } from 'lucide-react'

export interface TabItem {
  key: string
  label: string
  icon?: LucideIcon
  count?: number
}

interface TabsProps {
  items: TabItem[]
  active: string
  onChange: (key: string) => void
}

// Segmented control. Scroll horizontal em mobile em vez de quebrar linha.
export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="mb-5 overflow-x-auto">
      <div role="tablist" className="inline-flex min-w-max gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--border-default)', background: 'rgb(var(--c-sunken) / 0.7)' }}>
        {items.map((item) => {
          const selected = active === item.key
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.key)}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                selected ? 'bg-surface-overlay text-ink shadow-panel ring-1 ring-inset ring-white/10' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {Icon && <Icon className={`h-3.5 w-3.5 ${selected ? 'text-accent' : ''}`} aria-hidden="true" />}
              {item.label}
              {item.count !== undefined && <span className="rounded bg-white/5 px-1.5 text-[11px] tabular-nums text-ink-muted">{item.count}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
