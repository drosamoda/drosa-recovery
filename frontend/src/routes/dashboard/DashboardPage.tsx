import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { StatCard } from '../../components/data/StatCard'
import { LoadingState } from '../../components/feedback/LoadingState'
import { ErrorState } from '../../components/feedback/ErrorState'
import { apiGet, ApiError } from '../../lib/api'
import type { DashboardResponse, HealthResponse } from '../../lib/types'
import { ActionCenter } from '../../components/data/ActionCenter'
import { buildAttentionItems } from '../../lib/attention'

export function DashboardPage() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'today'],
    queryFn: ({ signal }) => apiGet<DashboardResponse>('dashboard?period=today', signal),
  })

  // Falha no /health não derruba o Dashboard: o bloco só aparece com dado real.
  const health = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => apiGet<HealthResponse>('health', signal) })

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="O que esta acontecendo agora." />
      {health.data && <ActionCenter items={buildAttentionItems(health.data)} />}

      {/* isPending (nao isLoading): cobre tambem a janela de retry automatico
          entre uma falha e a proxima tentativa, onde isLoading do react-query
          v5 (= isPending && isFetching) fica false sem ainda haver erro nem
          dado — achado real em smoke test, ver FOUNDATION_INTEGRATION_REPORT. */}
      {isPending && <LoadingState />}

      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Falha de rede ao consultar /crm-api/dashboard.'}
          onRetry={() => refetch()}
        />
      )}

      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Mensagens criadas" value={data.messages.total} />
          <StatCard label="Disparadas no período" value={data.messages.sent} />
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
