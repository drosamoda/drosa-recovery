import { useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

// Barra genérica de busca + filtros extras. A busca só é aplicada no Enter ou
// no botão, para não disparar um GET por tecla.
export function FilterBar({ placeholder, onSearch, children }: { placeholder: string; onSearch: (value: string) => void; children?: ReactNode }) {
  const [value, setValue] = useState('')
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch(value.trim())}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input w-full pl-9"
        />
      </div>
      <button type="button" onClick={() => onSearch(value.trim())} className="btn">
        Buscar
      </button>
      {children}
    </div>
  )
}

export function SelectFilter({ label, value, options, onChange, includeAll = true }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; includeAll?: boolean }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="input py-1.5 pr-8">
      {includeAll && <option value="">{label}: todos</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
