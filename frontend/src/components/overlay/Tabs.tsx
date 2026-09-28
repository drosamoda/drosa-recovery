export interface TabItem {
  key: string
  label: string
}

interface TabsProps {
  items: TabItem[]
  active: string
  onChange: (key: string) => void
}

// Scroll horizontal em mobile em vez de quebrar linha ou cortar texto —
// pedido explicito de responsividade para telas com tabs.
export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="mb-4 overflow-x-auto border-b border-ink-faint/15">
      <div className="flex min-w-max gap-1">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active === item.key
                ? 'border-bordo text-bordo'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
