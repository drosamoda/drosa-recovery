import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { LoadingState } from '../../components/feedback/LoadingState'
import { ErrorState } from '../../components/feedback/ErrorState'
import { EmptyState } from '../../components/feedback/EmptyState'
import { StatCard } from '../../components/data/StatCard'
import { OrderList, type OrderListRow } from '../../components/data/OrderList'
import { ConsentStatus } from '../../components/data/ConsentStatus'
import { Tabs } from '../../components/overlay/Tabs'
import { Timeline } from '../../components/viz/Timeline'
import { apiGet, ApiError } from '../../lib/api'
import type { CustomerDetail, JourneyDetail } from '../../lib/types'
import { CustomerSummaryCard } from './CustomerSummaryCard'

const TABS = [
  { key: 'overview', label: 'Visao Geral' },
  { key: 'orders', label: 'Pedidos' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'consent', label: 'Consentimentos & Privacidade' },
  { key: 'journey', label: 'Jornada' },
]

const JOURNEY_FILTER_DEFAULTS = { action: '', message: '', consent: '', responded: '', flow: '', period: 'all' }

// /crm-api/customers/:id devolve total como string (Decimal do Prisma
// serializado em JSON, nunca number na pratica — confirmado contra a API
// real, nao suposto) — formata como moeda quando for um numero valido, sem
// arriscar interpretar errado um valor que a API nao garanta ser numerico.
function formatMoney(total: number | string): string {
  const numeric = typeof total === 'number' ? total : Number(total)
  if (Number.isFinite(numeric)) return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  return String(total)
}

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [journeyFilters, setJourneyFilters] = useState(JOURNEY_FILTER_DEFAULTS)

  const {
    data: customer,
    isPending,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['customer', id],
    queryFn: ({ signal }) => apiGet<CustomerDetail>(`customers/${id}`, signal),
    enabled: Boolean(id),
  })

  // Jornada usa o prefixo `customer:<id>` que /crm-api/journey/:id ja resolve
  // para o telefone certo — nao duplica endpoint, so reaproveita.
  const journeyQuery = useQuery({
    queryKey: ['journey', id, journeyFilters],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams(Object.entries(journeyFilters).filter(([, v]) => v) as [string, string][])
      return apiGet<JourneyDetail>(`journey/customer:${id}?${qs}`, signal)
    },
    enabled: Boolean(id) && tab === 'journey',
  })

  if (isPending) return <LoadingState />
  if (isError) {
    return (
      <ErrorState
        message={error instanceof ApiError ? error.message : 'Falha de rede ao consultar /crm-api/customers/:id.'}
        onRetry={() => refetch()}
      />
    )
  }
  if (!customer) return <EmptyState title="Cliente nao encontrado." />

  const orderRows: OrderListRow[] = customer.orders.map((o) => ({
    id: o.id,
    title: `Pedido ${o.orderNumber}`,
    meta: o.paymentMethod,
    status: `${o.status} · ${o.paymentStatus}`,
    date: o.date,
    value: formatMoney(o.total),
  }))

  const checkoutRows: OrderListRow[] = customer.checkouts.map((c) => ({
    id: c.id,
    title: `Carrinho ${c.checkout}`,
    meta: c.products,
    status: c.status,
    date: c.date,
    value: formatMoney(c.total),
  }))

  const messageRows: OrderListRow[] = customer.messages.map((m) => ({
    id: m.id,
    title: m.templateName ?? 'Sem template',
    meta: m.entityType,
    status: m.status,
    date: m.createdAt,
    value: null,
  }))

  return (
    <div>
      <PageHeader title="Cliente 360" subtitle="Identidade, pedidos e historico consolidado." actions={
        <button type="button" onClick={() => navigate('/customers')} className="text-sm text-ink-muted hover:text-ink">
          Voltar para Clientes
        </button>
      } />

      <div className="mb-4"><CustomerSummaryCard customer={customer} /></div>

      <Tabs items={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Pedidos" value={customer.orders.length} />
          <StatCard label="Carrinhos" value={customer.checkouts.length} />
          <StatCard label="Mensagens WhatsApp" value={customer.messages.length} />
          <StatCard label="Conversas" value={customer.conversations.length} />
        </div>
      )}

      {tab === 'orders' && <OrderList rows={orderRows} emptyLabel="Nenhum pedido encontrado." />}
      {tab === 'recovery' && <OrderList rows={checkoutRows} emptyLabel="Nenhum carrinho encontrado." />}
      {tab === 'whatsapp' && <OrderList rows={messageRows} emptyLabel="Nenhuma mensagem encontrada." />}

      {tab === 'consent' && (
        <div className="space-y-4">
          <div className="rounded-card border border-ink-faint/15 bg-surface-raised p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">Consentimentos por escopo</h3>
            {customer.consents.length === 0 ? (
              <p className="text-sm text-ink-muted">Nenhum consentimento registrado.</p>
            ) : (
              <ul className="space-y-2">
                {customer.consents.map((c, i) => (
                  <li key={`${c.scope}-${i}`} className="flex items-center justify-between text-sm">
                    <span className="text-ink">{c.scope}</span>
                    <span className="flex items-center gap-2 text-ink-muted">
                      <ConsentStatus consent={c.consented && !c.revokedAt ? 'GRANTED' : 'REVOKED'} />
                      {c.source && <span>{c.source}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-card border border-ink-faint/15 bg-surface-raised p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">Suppression</h3>
            {customer.suppression ? (
              <p className="text-sm text-ink-muted">
                Motivo: {customer.suppression.reason} · Origem: {customer.suppression.source ?? 'nao informada'} · Desde{' '}
                {new Date(customer.suppression.suppressedAt).toLocaleDateString('pt-BR')}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">Nenhuma suppression registrada para este contato.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'journey' && (
        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {(['action', 'message', 'consent', 'responded', 'flow'] as const).map((key) => (
              <select
                key={key}
                value={journeyFilters[key]}
                onChange={(e) => setJourneyFilters((f) => ({ ...f, [key]: e.target.value }))}
                className="rounded-md border border-ink-faint/30 px-2 py-1 text-sm"
              >
                <option value="">{key}</option>
                {key === 'consent' && ['GRANTED', 'REVOKED', 'UNKNOWN'].map((v) => <option key={v} value={v}>{v}</option>)}
                {key === 'responded' && ['yes', 'no'].map((v) => <option key={v} value={v}>{v}</option>)}
                {key === 'message' && ['none', 'sent', 'delivered', 'read', 'failed'].map((v) => <option key={v} value={v}>{v}</option>)}
                {key === 'flow' && ['carrinho', 'pix', 'boleto', 'remarketing', 'outros'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ))}
          </div>

          {journeyQuery.isPending && <LoadingState />}
          {journeyQuery.isError && (
            <ErrorState
              message={journeyQuery.error instanceof ApiError ? journeyQuery.error.message : 'Falha ao consultar /crm-api/journey.'}
              onRetry={() => journeyQuery.refetch()}
            />
          )}
          {journeyQuery.data && <Timeline events={journeyQuery.data.timeline} />}
        </div>
      )}
    </div>
  )
}
