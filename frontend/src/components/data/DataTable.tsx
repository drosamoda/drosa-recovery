import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { useIsMobile } from '../../lib/useMediaQuery'

export interface DataTableColumn<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
  // Esconde a coluna na tabela abaixo de md: (768px); em mobile a linha vira
  // card e colunas secundárias aparecem como pares rótulo/valor.
  hideOnMobile?: boolean
  align?: 'left' | 'right'
  /** Presente = coluna ordenável (ordenação local, só sobre as linhas exibidas). */
  sortValue?: (row: T) => string | number | null
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  caption?: string
  maxHeight?: number
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null

// Tabela 2.0: header sticky, hover, ordenação indicada, colunas numéricas à
// direita e transformação em cards no mobile (sem overflow horizontal).
// Loading/erro/vazio ficam a cargo do chamador (QueryView).
export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption, maxHeight }: DataTableProps<T>) {
  const isMobile = useIsMobile()
  const [sort, setSort] = useState<Sort>(null)

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!sort || !col?.sortValue) return rows
    const get = col.sortValue
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b)
      if (va === vb) return 0
      if (va === null) return 1
      if (vb === null) return -1
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR')
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, columns, sort])

  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'desc' } : s.dir === 'desc' ? { key, dir: 'asc' } : null))

  if (isMobile) {
    const [primary, ...rest] = columns
    return (
      <ul className="space-y-2" aria-label={caption}>
        {sorted.map((row) => {
          const content = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm font-medium text-ink [overflow-wrap:anywhere]">{primary?.render(row)}</div>
                {onRowClick && <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {rest.map((col) => (
                  <div key={col.key} className="min-w-0">
                    <dt className="text-[11px] text-ink-faint">{col.label}</dt>
                    <dd className="text-xs text-ink [overflow-wrap:anywhere]">{col.render(row)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )
          return (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button type="button" onClick={() => onRowClick(row)} className="panel panel-interactive block w-full p-3 text-left">
                  {content}
                </button>
              ) : (
                <div className="panel p-3">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="panel enter overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10" style={{ background: 'rgb(var(--c-raised) / 0.97)', backdropFilter: 'blur(8px)' }}>
          <tr className="text-left">
            {columns.map((col) => {
              const active = sort?.key === col.key
              const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`whitespace-nowrap border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.align === 'right' ? 'text-right' : ''}`}
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  {col.sortValue ? (
                    <button type="button" onClick={() => toggle(col.key)} className={`inline-flex items-center gap-1 uppercase hover:text-ink ${active ? 'text-ink' : ''}`}>
                      {col.label}
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              )
            })}
            {onRowClick && <th aria-hidden="true" className="w-8 border-b" style={{ borderColor: 'var(--border-default)' }} />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(row)) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={`group border-b transition-colors last:border-0 even:bg-white/[0.012] hover:bg-white/[0.035] ${onRowClick ? 'cursor-pointer' : ''}`}
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 text-ink ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {col.render(row)}
                </td>
              ))}
              {onRowClick && (
                <td className="pr-3 text-right">
                  <ChevronRight className="inline h-4 w-4 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
