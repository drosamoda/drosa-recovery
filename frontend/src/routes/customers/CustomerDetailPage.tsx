import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { LoadingState } from '../../components/feedback/LoadingState'
import { ErrorState } from '../../components/feedback/ErrorState'
import { EmptyState } from '../../components/feedback/EmptyState'
import { OrderList, type OrderListRow } from '../../components/data/OrderList'
import { ConsentStatus } from '../../components/data/ConsentStatus'
import { Tabs } from '../../components/overlay/Tabs'
import { Timeline } from '../../components/viz/Timeline'
import { apiGet, ApiError } from '../../lib/api'
import type { CustomerDetail, JourneyDetail } from '../../lib/types'
import { formatMoney } from '../../lib/labels'
import { Notice } from '../../components/feedback/Notice'
import { CustomerSummaryCard } from './CustomerSummaryCard'
import { ArrowLeft, LayoutGrid, MessageCircle, RefreshCcw, Route, ShieldCheck, ShoppingBag, ShoppingCart, MessagesSquare } from 'lucide-react'
import { KpiCard } from '../../components/data/KpiCard'
import { ProfileSkeleton } from '../../components/feedback/Skeleton'
import { MESSAGE_STATUS, lookup } from '../../lib/labels'

const TABS = [
  { key: 'overview', label: 'Visão Geral', icon: LayoutGrid },
  { key: 'journey', label: 'Jornada', icon: Route },
  { key: 'orders', label: 'Pedidos', icon: ShoppingBag },
  { key: 'recovery', label: 'Recovery', icon: RefreshCcw },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'consent', label: 'Privacidade', icon: ShieldCheck },
]

const JOURNEY_FILTER_DEFAULTS = { action: '', message: '', consent: '', responded: '', flow: '', period: 'all' }

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

  if (isPending) {
    return (
      <div className="space-y-4">
        <ProfileSkeleton />
        <LoadingState variant="kpis" />
      </div>
    )
  }
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
    status: lookup(MESSAGE_STATUS, m.status)?.label ?? m.status,
    date: m.createdAt,
    value: null,
  }))

  return (
    <div>
      <PageHeader title="Cliente 360" subtitle="Identidade, jornada, pedidos, recovery, WhatsApp e privacidade em um só lugar." actions={
        <button type="button" onClick={() => navigate('/customers')} className="btn">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Voltar para Clientes
        </button>
      } />

      <div className="mb-4"><CustomerSummaryCard customer={customer} /></div>

      <Tabs items={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Pedidos" value={customer.orders.length} icon={ShoppingBag} tone="success" />
            <KpiCard label="Carrinhos" value={customer.checkouts.length} icon={ShoppingCart} tone="accent" />
            <KpiCard label="Mensagens WhatsApp" value={customer.messages.length} icon={MessageCircle} tone="data" />
            <KpiCard label="Conversas" value={customer.conversations.length} icon={MessagesSquare} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="t-section mb-2">Pedidos recentes</h3>
              <OrderList rows={orderRows.slice(0, 4)} emptyLabel="Nenhum pedido encontrado." />
            </div>
            <div>
              <h3 className="t-section mb-2">WhatsApp recente</h3>
              <OrderList rows={messageRows.slice(0, 4)} emptyLabel="Nenhuma mensagem encontrada." />
            </div>
          </div>
          {/* /crm-api/customers/:id nao expoe historico de e-mail por cliente:
              gap declarado, sem dado ficticio nem UI vazia fingindo zero. */}
          <Notice>
            Histórico de e-mail por cliente: não disponível na API atual <span className="text-ink-faint">(NOT_AVAILABLE_FROM_CURRENT_API)</span>.
          </Notice>
        </div>
      )}
      {tab === 'orders' && <OrderList rows={orderRows} emptyLabel="Nenhum pedido encontrado." />}
      {tab === 'recovery' && <OrderList rows={checkoutRows} emptyLabel="Nenhum carrinho encontrado." />}
      {tab === 'whatsapp' && <OrderList rows={messageRows} emptyLabel="Nenhuma mensagem encontrada." />}

      {tab === 'consent' && (
        <div className="space-y-4">
          <div className="panel p-4">
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
          <div className="panel p-4">
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
                className="input py-1.5"
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
