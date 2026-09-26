import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { StatCard } from '../../components/data/StatCard'
import { LoadingState } from '../../components/feedback/LoadingState'
import { ErrorState } from '../../components/feedback/ErrorState'
import { apiGet, ApiError } from '../../lib/api'
import type { DashboardResponse } from '../../lib/types'

export function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'today'],
    queryFn: ({ signal }) => apiGet<DashboardResponse>('dashboard?period=today', signal),
  })

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="O que esta acontecendo agora." />

      {isLoading && <LoadingState />}

      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Falha de rede ao consultar /crm-api/dashboard.'}
          onRetry={() => refetch()}
        />
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Mensagens criadas" value={data.messages.total} />
          <StatCard label="Enviadas no periodo" value={data.messages.sent} />
          <StatCard label="Clientes contatados" value={data.contactedCustomers} />
          <StatCard label="Mensagens recebidas" value={data.inboundMessages} />
          <StatCard label="Conversas recebidas" value={data.inboundConversations} />
          <StatCard label="Carrinhos abandonados" value={data.abandonedCheckouts} />
          <StatCard label="Carrinhos convertidos" value={data.convertedCheckouts} />
          <StatCard label="Pix pendentes" value={data.pixPending} />
          <StatCard label="Boletos pendentes" value={data.boletoPending} />
        </div>
      )}
    </div>
  )
}
