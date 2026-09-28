import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { LoadingState } from '../../components/feedback/LoadingState'
import { ErrorState } from '../../components/feedback/ErrorState'
import { EmptyState } from '../../components/feedback/EmptyState'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { ConsentStatus } from '../../components/data/ConsentStatus'
import { apiGet, ApiError } from '../../lib/api'
import type { CustomerListItem, CustomersResponse } from '../../lib/types'

const PAGE_SIZE = 25

export function CustomersPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search) qs.set('search', search)
      return apiGet<CustomersResponse>(`customers?${qs}`, signal)
    },
    placeholderData: keepPreviousData,
  })

  function applySearch() {
    setSearch(searchInput.trim())
    setPage(1)
  }

  const columns: DataTableColumn<CustomerListItem>[] = [
    { key: 'name', label: 'Cliente', render: (row) => row.name || 'Nome nao informado' },
    { key: 'phone', label: 'Telefone', render: (row) => row.phone ?? '—' },
    { key: 'email', label: 'E-mail', render: (row) => row.email ?? '—', hideOnMobile: true },
    { key: 'orders', label: 'Pedidos', render: (row) => row.orders, hideOnMobile: true },
    { key: 'consent', label: 'Consentimento', render: (row) => <ConsentStatus consent={row.consent} /> },
  ]

  return (
    <div>
      <PageHeader title="Clientes" subtitle="Busca e identidade dos clientes conhecidos pelo Recovery." />

      <div className="mb-4 flex gap-2">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applySearch()}
          placeholder="Buscar por nome, telefone ou e-mail"
          className="w-full max-w-sm rounded-md border border-white/15 px-3 py-2 text-sm outline-none focus:border-bordo"
        />
        <button
          type="button"
          onClick={applySearch}
          className="rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
        >
          Buscar
        </button>
      </div>

      {isPending && <LoadingState />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Falha de rede ao consultar /crm-api/customers.'}
          onRetry={() => refetch()}
        />
      )}
      {data && data.data.length === 0 && <EmptyState title="Nenhum cliente encontrado." />}
      {data && data.data.length > 0 && (
        <>
          <DataTable columns={columns} rows={data.data} rowKey={(row) => row.id} onRowClick={(row) => navigate(`/customers/${row.id}`)} />
          <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
            <span>{data.pagination.total} clientes no total</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-white/15 px-3 py-1 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page * PAGE_SIZE >= data.pagination.total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-white/15 px-3 py-1 disabled:opacity-40"
              >
                Proxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
