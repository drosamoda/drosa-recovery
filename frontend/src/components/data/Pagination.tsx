import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Pagination as PaginationData } from '../../lib/types'

// Genérico: qualquer listagem paginada de /crm-api/* (mesmo contrato page/pageSize/total).
export function Pagination({ pagination, onPage, noun }: { pagination: PaginationData; onPage: (page: number) => void; noun: string }) {
  const pages = pagination.pages ?? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
  return (
    <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
      <span className="tabular-nums">
        {pagination.total.toLocaleString('pt-BR')} {noun} · página {pagination.page} de {pages}
      </span>
      <div className="flex gap-2">
        <button type="button" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} className="btn" aria-label="Anterior">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Anterior
        </button>
        <button type="button" disabled={pagination.page >= pages} onClick={() => onPage(pagination.page + 1)} className="btn" aria-label="Próxima">
          Próxima
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}
