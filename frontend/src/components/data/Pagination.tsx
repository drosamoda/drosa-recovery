import type { Pagination as PaginationData } from '../../lib/types'

// Generico: qualquer listagem paginada de /crm-api/* (mesmo contrato page/pageSize/total).
export function Pagination({ pagination, onPage, noun }: { pagination: PaginationData; onPage: (page: number) => void; noun: string }) {
  const pages = pagination.pages ?? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm text-ink-muted">
      <span>
        {pagination.total.toLocaleString('pt-BR')} {noun} · página {pagination.page} de {pages}
      </span>
      <div className="flex gap-2">
        <button type="button" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} className="rounded-md border border-ink-faint/30 px-3 py-1 disabled:opacity-40">
          Anterior
        </button>
        <button type="button" disabled={pagination.page >= pages} onClick={() => onPage(pagination.page + 1)} className="rounded-md border border-ink-faint/30 px-3 py-1 disabled:opacity-40">
          Próxima
        </button>
      </div>
    </div>
  )
}
