import type { ReactNode } from 'react'

export interface DataTableColumn<T> {
  key: string
  label: string
  render: (row: T) => ReactNode
  // esconde a coluna abaixo de md: (768px) — usar para colunas secundarias
  // que nao cabem em mobile, mantendo a tabela legivel sem scroll lateral.
  hideOnMobile?: boolean
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
}

// Componente generico de tabela — reutilizavel por qualquer listagem futura
// (Mensagens, Conversas, etc.), nao especifico de Clientes. Loading/error/
// empty ficam a cargo de quem chama (usar LoadingState/ErrorState/EmptyState).
export function DataTable<T>({ columns, rows, rowKey, onRowClick }: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-card border border-ink-faint/15 bg-surface-raised">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink-faint/15 text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 ${col.hideOnMobile ? 'hidden md:table-cell' : ''}`}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-ink-faint/10 last:border-0 ${
                onRowClick ? 'cursor-pointer hover:bg-surface-sunken' : ''
              }`}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 text-ink ${col.hideOnMobile ? 'hidden md:table-cell' : ''}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
