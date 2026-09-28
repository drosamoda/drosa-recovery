import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Barcode, CheckCheck, Inbox, MessageSquareReply, QrCode, Send, ShoppingCart, UsersRound } from 'lucide-react'
import { PageHeader } from '../../components/shell/PageHeader'
import { PeriodFilter } from '../../components/navigation/PeriodFilter'
import { SystemPulse } from '../../components/status/SystemPulse'
import { KpiCard } from '../../components/data/KpiCard'
import { ActionCenter } from '../../components/data/ActionCenter'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { CodeBadge } from '../../components/data/CodeBadge'
import { ChartCard, ChartEmptyState, ChartLegend } from '../../components/charts/ChartCard'
import { HorizontalBarChart, StackedBarChart, TrendAreaChart } from '../../components/charts/charts'
import { CART_SERIES, MESSAGE_SERIES, ORDER_SERIES, SERIES_TO_STATUS } from '../../lib/chartSeries'
import { KpiSkeleton, ChartSkeleton, TableSkeleton } from '../../components/feedback/Skeleton'
import { ErrorState } from '../../components/feedback/ErrorState'
import { apiGet, errorMessage } from '../../lib/api'
import { buildAttentionItems } from '../../lib/attention'
import { formatPct, messageSemantics, pct, sumCart, type CartDailyRow, type MessageDailyRow, type OrdersDailyRow } from '../../lib/biMetrics'
import { MESSAGE_STATUS, formatDateTime } from '../../lib/labels'
import { periodOption, usePeriod } from '../../lib/period'
import { useBiDataset, useDashboard, useHealth, type WebhookSummaryRow } from '../../lib/queries'
import { cartSeries, hasAny, messageSeries, ordersSeries } from '../../lib/series'
import type { ListResponse, MessageListItem } from '../../lib/types'

const nf = (v: number) => v.toLocaleString('pt-BR')

export function DashboardPage() {
  const navigate = useNavigate()
  const { period } = usePeriod()
  const opt = periodOption(period)
  // Gráficos diários precisam de mais de 1 ponto: "Hoje" mostra a tendência de 7 dias.
  const chartDays = Math.max(opt.days, 7)

  const dashboard = useDashboard(period)
  const health = useHealth()
  const messages = useBiDataset<MessageDailyRow>('messageDaily', chartDays)
  const cart = useBiDataset<CartDailyRow>('abandonedCartDaily', chartDays)
  const orders = useBiDataset<OrdersDailyRow>('ordersDaily', chartDays)
  const kpiMessages = useBiDataset<MessageDailyRow>('messageDaily', opt.days)
  const kpiCart = useBiDataset<CartDailyRow>('abandonedCartDaily', opt.days)
  const hooks = useBiDataset<WebhookSummaryRow>('webhookDaily', chartDays)

  const d = dashboard.data
  const msgPoints = messages.data ? messageSeries(messages.data.data, chartDays) : []
  const cartPoints = cart.data ? cartSeries(cart.data.data, chartDays) : []
  const orderPoints = orders.data ? ordersSeries(orders.data.data, chartDays) : []
  const m = kpiMessages.data ? messageSemantics(kpiMessages.data.data) : null
  const c = kpiCart.data ? sumCart(kpiCart.data.data) : null
  const trendNote = opt.days < chartDays ? ' · tendência 7 dias' : ''

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="D’Rosa Command Center"
        title="Como está a operação"
        subtitle={`Estado dos sistemas, indicadores de ${opt.label.toLowerCase()} e o que precisa de ação.`}
        actions={<PeriodFilter />}
      />

      <SystemPulse apiOk={dashboard.isError ? false : d ? true : null} />

      {/* Faixa 2 — KPIs principais */}
      {dashboard.isPending ? (
        <KpiSkeleton count={6} />
      ) : dashboard.isError ? (
        <ErrorState message={errorMessage(dashboard.error, 'Falha de rede ao consultar /crm-api/dashboard.')} onRetry={() => dashboard.refetch()} />
      ) : d ? (
        <section aria-label="Indicadores principais" className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          <KpiCard label="Disparadas no período" value={nf(d.messages.sent)} icon={Send} tone="data" size="lg" context={`${nf(d.messages.total)} mensagens criadas`} tooltip="Fonte: /crm-api/dashboard" to="/messages" />
          <KpiCard
            label="Entregues"
            value={m ? nf(m.delivered) : '—'}
            icon={CheckCheck}
            tone="success"
            size="lg"
            context={m ? `${formatPct(pct(m.delivered, m.dispatched))} das disparadas · ${nf(m.read)} lidas` : 'BI indisponível'}
            spark={msgPoints.map((p) => p.delivered + p.read)}
            tooltip="Fonte: bi_message_daily_stats (entregues + lidas)"
            to="/messages?status=delivered"
          />
          <KpiCard label="Clientes contatados" value={nf(d.contactedCustomers)} icon={UsersRound} tone="accent" size="lg" context="telefones distintos com disparo" tooltip="Fonte: /crm-api/dashboard" to="/customers" />
          <KpiCard
            label="Carrinhos abandonados"
            value={c ? nf(c.evaluated) : nf(d.abandonedCheckouts)}
            icon={ShoppingCart}
            tone="accent"
            size="lg"
            context={c ? `${nf(c.dispatched)} com mensagem disparada` : undefined}
            spark={cartPoints.map((p) => p.abandoned)}
            tooltip={c ? 'Fonte: bi_abandoned_cart_funnel_daily' : 'Fonte: /crm-api/dashboard'}
            to="/recovery?tab=checkouts"
          />
          <KpiCard label="PIX pendentes" value={nf(d.pixPending)} icon={QrCode} tone={d.pixPending > 0 ? 'warning' : 'default'} size="lg" context="pedidos PIX sem pagamento confirmado" tooltip="Fonte: /crm-api/dashboard" to="/recovery?tab=pix" />
          <KpiCard label="Boletos pendentes" value={nf(d.boletoPending)} icon={Barcode} tone={d.boletoPending > 0 ? 'warning' : 'default'} size="lg" context="boletos sem pagamento confirmado" tooltip="Fonte: /crm-api/dashboard" to="/recovery?tab=boleto" />
        </section>
      ) : null}

      {/* Faixa 3 — Tendências + Faixa 4 — Precisa de atenção */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {messages.isPending ? (
            <ChartSkeleton height={260} />
          ) : (
            <ChartCard
              title={`Mensagens por dia${trendNote}`}
              question="Quanto saiu por dia e o que aconteceu com cada mensagem? Clique numa série para abrir as mensagens."
              actions={<Link to="/messages" className="btn shrink-0 text-xs">Mensagens <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}
            >
              {messages.isError ? (
                <ChartEmptyState title="BI indisponível" description={errorMessage(messages.error, 'Falha ao ler bi_message_daily_stats.')} />
              ) : hasAny(msgPoints, ['read', 'delivered', 'awaiting', 'queued', 'blocked', 'failed']) ? (
                <>
                  <StackedBarChart data={msgPoints} series={MESSAGE_SERIES} height={260} ariaLabel="Mensagens por dia e status" onBarClick={(k) => navigate(`/messages?status=${SERIES_TO_STATUS[k]}`)} />
                  <ChartLegend items={MESSAGE_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
                </>
              ) : (
                <ChartEmptyState />
              )}
            </ChartCard>
          )}
        </div>
        <div>
          {health.isPending ? (
            <TableSkeleton rows={4} />
          ) : health.data ? (
            <ActionCenter items={buildAttentionItems(health.data)} />
          ) : (
            <ErrorState message={errorMessage(health.error, 'Falha ao consultar /crm-api/health.')} onRetry={() => health.refetch()} />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ChartCard title={`Recovery · carrinhos${trendNote}`} question="O volume de disparos acompanha o abandono?" footer="Elegibilidade calculada com o consentimento de hoje. Pedido vinculado não é atribuição.">
          {cart.isPending ? (
            <ChartSkeletonInline />
          ) : cart.isError ? (
            <ChartEmptyState title="BI indisponível" />
          ) : hasAny(cartPoints, ['abandoned', 'eligible', 'dispatched']) ? (
            <>
              <TrendAreaChart data={cartPoints} series={CART_SERIES} height={200} ariaLabel="Carrinhos abandonados, elegíveis e disparos por dia" />
              <ChartLegend items={CART_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
            </>
          ) : (
            <ChartEmptyState />
          )}
        </ChartCard>
        <ChartCard title={`Pedidos por dia${trendNote}`} question="Pedidos entrando, por status de pagamento (quantidade, não faturamento)." actions={<Link to="/bi" className="btn shrink-0 text-xs">BI <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}>
          {orders.isPending ? (
            <ChartSkeletonInline />
          ) : orders.isError ? (
            <ChartEmptyState title="BI indisponível" />
          ) : hasAny(orderPoints, ['paid', 'pending', 'other']) ? (
            <>
              <StackedBarChart data={orderPoints} series={ORDER_SERIES} height={200} ariaLabel="Pedidos por dia e status de pagamento" />
              <ChartLegend items={ORDER_SERIES.map((s) => ({ label: s.label, color: s.color, value: nf(orderPoints.reduce((a, p) => a + (p[s.key as 'paid'] ?? 0), 0)) }))} />
            </>
          ) : (
            <ChartEmptyState />
          )}
        </ChartCard>
        <ChartCard title={`Integrações · webhooks${trendNote}`} question="Quais integrações estão recebendo eventos, e com erro?" actions={<Link to="/health" className="btn shrink-0 text-xs">Saúde <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>} className="lg:col-span-2 xl:col-span-1">
          {hooks.isPending ? (
            <ChartSkeletonInline />
          ) : hooks.isError ? (
            <ChartEmptyState title="BI indisponível" />
          ) : hooks.data && hooks.data.data.length > 0 ? (
            <HorizontalBarChart
              ariaLabel="Eventos de webhook por provider e tópico"
              data={[...hooks.data.data]
                .sort((a, b) => b.events - a.events)
                .slice(0, 6)
                .map((r) => ({ label: `${r.provider} · ${r.topic ?? '—'}`, value: r.events, color: r.errors > 0 ? 'var(--chart-danger)' : 'var(--chart-1)', hint: r.errors > 0 ? `${nf(r.errors)} erros` : undefined }))}
              onSelect={() => navigate('/health')}
            />
          ) : (
            <ChartEmptyState title="Nenhum webhook no período" />
          )}
        </ChartCard>
      </div>

      {/* Faixa 5 — Operação */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <RecentMessages />
        </div>
        {d && (
          <section className="panel enter p-4" aria-label="Atendimento">
            <h2 className="t-section mb-3">Atendimento no período</h2>
            <div className="grid grid-cols-2 gap-3">
              <MiniStat icon={MessageSquareReply} label="Mensagens recebidas" value={nf(d.inboundMessages)} to="/conversations" />
              <MiniStat icon={Inbox} label="Conversas com mensagem recebida" value={nf(d.inboundConversations)} to="/conversations" />
              <MiniStat icon={ShoppingCart} label="Carrinhos com pedido vinculado" value={nf(d.convertedCheckouts)} to="/recovery?tab=checkouts" hint="vínculo, não atribuição" />
              <MiniStat icon={Send} label="Mensagens criadas" value={nf(d.messages.total)} to="/messages" />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function ChartSkeletonInline() {
  return <div className="skeleton h-[200px] w-full" aria-hidden="true" />
}

function MiniStat({ icon: Icon, label, value, to, hint }: { icon: typeof Send; label: string; value: string; to: string; hint?: string }) {
  return (
    <Link to={to} className="group rounded-lg border p-3 transition-colors hover:border-white/20" style={{ borderColor: 'var(--border-subtle)', background: 'rgb(var(--c-sunken) / 0.6)' }}>
      <Icon className="h-4 w-4 text-ink-faint group-hover:text-accent" aria-hidden="true" />
      <p className="t-metric mt-2 text-xl">{value}</p>
      <p className="text-xs text-ink-muted">{label}</p>
      {hint && <p className="text-[11px] text-ink-faint">{hint}</p>}
    </Link>
  )
}

function RecentMessages() {
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['messages', '', '', 1, 'recent'], queryFn: ({ signal }) => apiGet<ListResponse<MessageListItem>>('messages?page=1&pageSize=8', signal) })
  const columns: DataTableColumn<MessageListItem>[] = [
    { key: 'createdAt', label: 'Criada em', render: (r) => <span className="tabular-nums text-ink-muted">{formatDateTime(r.createdAt)}</span> },
    { key: 'customer', label: 'Cliente', render: (r) => r.customer ?? r.phone ?? '—' },
    { key: 'template', label: 'Template', render: (r) => <span className="text-ink-muted">{r.template ?? '—'}</span>, hideOnMobile: true },
    { key: 'status', label: 'Status', render: (r) => <CodeBadge code={r.status} map={MESSAGE_STATUS} /> },
  ]
  return (
    <section aria-label="Atividade recente">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="t-section">Atividade recente · mensagens</h2>
        <Link to="/messages" className="text-xs text-accent hover:underline">Ver todas</Link>
      </div>
      {query.isPending ? (
        <TableSkeleton rows={5} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error, 'Falha ao consultar /crm-api/messages.')} onRetry={() => query.refetch()} />
      ) : (
        <DataTable columns={columns} rows={query.data.data} rowKey={(r) => r.id} onRowClick={(r) => navigate(`/messages?id=${r.id}`)} caption="Mensagens mais recentes" />
      )}
    </section>
  )
}
