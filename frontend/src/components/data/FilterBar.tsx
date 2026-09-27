import { useState, type ReactNode } from 'react'

// Barra generica de busca + filtros extras. A busca so e aplicada no Enter ou
// no botao, para nao disparar um GET por tecla.
export function FilterBar({ placeholder, onSearch, children }: { placeholder: string; onSearch: (value: string) => void; children?: ReactNode }) {
  const [value, setValue] = useState('')
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSearch(value.trim())}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full max-w-sm rounded-md border border-ink-faint/30 px-3 py-2 text-sm outline-none focus:border-bordo"
      />
      <button type="button" onClick={() => onSearch(value.trim())} className="rounded-md border border-ink-faint/30 px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken">
        Buscar
      </button>
      {children}
    </div>
  )
}

export function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-ink-faint/30 bg-surface-raised px-3 py-2 text-sm">
      <option value="">{label}: todos</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
