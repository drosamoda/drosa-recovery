import { useState, type ReactNode } from 'react'
import { PageHeader } from '../../components/shell/PageHeader'
import { Tabs } from '../../components/overlay/Tabs'
import { StatCard } from '../../components/data/StatCard'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { QueryView } from '../../components/data/QueryView'
import { PeriodFilter } from '../../components/navigation/PeriodFilter'
import { ChartCard, ChartEmptyState, ChartLegend } from '../../components/charts/ChartCard'
import { DonutChart, HorizontalBarChart, StackedBarChart, TrendAreaChart } from '../../components/charts/charts'
import { CART_SERIES, MESSAGE_SERIES, ORDER_SERIES } from '../../lib/chartSeries'
import { cartSeries, hasAny, messageSeries, ordersSeries } from '../../lib/series'
import { periodOption, usePeriod } from '../../lib/period'
import { useBiDataset } from '../../lib/queries'
import { Activity, Gauge, MessageSquareText, ShieldCheck, ShoppingBag, Webhook } from 'lucide-react'
import { MetabaseEmbed } from '../../components/data/MetabaseEmbed'
import { Notice } from '../../components/feedback/Notice'
import { StageFunnel } from '../../components/viz/StageFunnel'
import { formatDateTime, formatMoney } from '../../lib/labels'
import {
  formatPct,
  messageSemantics,
  ordersByPaymentStatus,
  pct,
  sumCart,
  sumOrdersConsent,
  templateSemantics,
  type CartDailyRow,
  type MessageDailyRow,
  type OrdersConsentRow,
  type OrdersDailyRow,
  type TemplateDailyRow,
} from '../../lib/biMetrics'

const TABS = [
  { key: 'executive', label: 'Visão Executiva', icon: Gauge },
  { key: 'recovery', label: 'Recovery', icon: Activity },
  { key: 'messages', label: 'Mensagens', icon: MessageSquareText },
  { key: 'consents', label: 'Consentimentos', icon: ShieldCheck },
  { key: 'orders', label: 'Pedidos', icon: ShoppingBag },
  { key: 'integrations', label: 'Integrações', icon: Webhook },
]

interface Pulse {
  last_order_at: string | null
  last_webhook_nuvemshop_at: string | null
  last_webhook_meta_at: string | null
  pending_messages: number
  processing_messages: number
  delivery_unknown_messages: number
}

interface WebhookRow {
  provider: string
  topic: string | null
  events: number
  processed: number
  invalid_hmac: number
  errors: number
  last_day: string
}

const useDataset = useBiDataset

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="t-section mb-3">{title}</h2>
      {children}
    </section>
  )
}

const n = (v: number) => v.toLocaleString('pt-BR')

export function BiPage() {
  const [tab, setTab] = useState('executive')
  const { period } = usePeriod()
  const days = periodOption(period).days
  return (
    <div>
      <PageHeader
        title="BI & Inteligência"
        subtitle="Analytics nativo sobre as views bi_* (somente leitura). Metabase fica como análise aprofundada, só com painéis semanticamente aprovados."
        actions={<PeriodFilter />}
      />
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === 'executive' && <ExecutiveTab days={days} />}
      {tab === 'recovery' && <RecoveryTab days={days} />}
      {tab === 'messages' && <MessagesTab days={days} />}
      {tab === 'consents' && <ConsentsTab days={days} />}
      {tab === 'orders' && <OrdersTab days={days} />}
      {tab === 'integrations' && <IntegrationsTab days={days} />}
      <p className="mt-6 text-xs text-ink-faint">
        DATA_QUALITY_WARNING: as views agrupam por dia convertendo colunas sem fuso com <code>AT TIME ZONE &apos;America/Sao_Paulo&apos;</code>; eventos entre 21h e 24h (horário de Brasília) podem cair no dia seguinte. Totais do período não são afetados nas bordas internas.
      </p>
    </div>
  )
}

function MessageCards({ rows }: { rows: { status: string; count: number }[] }) {
  const m = messageSemantics(rows)
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatCard label="Avaliadas" value={n(m.evaluated)} hint="Todos os registros de mensagem do período" />
      <StatCard label="Bloqueadas" value={n(m.blocked)} hint="Não disparadas por regra (skipped)" />
      <StatCard label="Disparadas" value={n(m.dispatched)} />
      <StatCard label="Aguardando entrega" value={n(m.awaitingDelivery)} />
      <StatCard label="Entregues" value={n(m.delivered)} hint={`${formatPct(pct(m.delivered, m.dispatched))} das disparadas`} />
      <StatCard label="Lidas" value={n(m.read)} hint={`${formatPct(pct(m.read, m.dispatched))} das disparadas`} />
      <StatCard label="Falhas" value={n(m.failed)} />
      <StatCard label="Na fila / desconhecidas" value={`${n(m.queued)} / ${n(m.unknown)}`} />
    </div>
  )
}

function ExecutiveTab({ days }: { days: number }) {
  const pulse = useDataset<Pulse>('systemPulse', days)
  const messages = useDataset<MessageDailyRow>('messageDaily', days)
  return (
    <>
      <Section title="Pulso do sistema (agora)">
        <QueryView query={pulse} emptyTitle="" fallbackError="Falha ao ler bi_system_pulse.">
          {(d) => {
            const p = d.data[0]
            if (!p) return <Notice>Sem dados de pulso.</Notice>
            return (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <StatCard label="Último pedido" value={formatDateTime(p.last_order_at)} />
                <StatCard label="Último webhook Nuvemshop" value={formatDateTime(p.last_webhook_nuvemshop_at)} />
                <StatCard label="Último webhook Meta" value={formatDateTime(p.last_webhook_meta_at)} />
                <StatCard label="Na fila" value={n(p.pending_messages)} />
                <StatCard label="Em processamento" value={n(p.processing_messages)} />
                <StatCard label="Entrega desconhecida" value={n(p.delivery_unknown_messages)} />
              </div>
            )
          }}
        </QueryView>
      </Section>
      <Section title={`Mensagens — ${periodLabel(days)}`}>
        <QueryView query={messages} emptyTitle="" fallbackError="Falha ao ler bi_message_daily_stats.">
          {(d) => <MessageCards rows={d.data} />}
        </QueryView>
      </Section>
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MessageTrend days={days} />
        <OrdersTrend days={days} />
      </div>
      <Section title="Painel Metabase — Visão Executiva (análise aprofundada)">
        <MetabaseEmbed module="executive" title="Visão Executiva" />
      </Section>
    </>
  )
}

function RecoveryTab({ days }: { days: number }) {
  const cart = useDataset<CartDailyRow>('abandonedCartDaily', days)
  return (
    <>
      <QueryView query={cart} isEmpty={(d) => d.data.length === 0} emptyTitle="Sem carrinhos no período." fallbackError="Falha ao ler bi_abandoned_cart_funnel_daily.">
        {(d) => {
          const c = sumCart(d.data)
          return (
            <>
              <Section title={`Elegibilidade (estado atual) — carrinhos dos ${periodLabel(days)}`}>
                <StageFunnel
                  stages={[
                    { label: 'Avaliados', value: c.evaluated },
                    { label: 'Com telefone', value: c.withPhone },
                    { label: 'Com consentimento marketing', value: c.withConsent },
                    { label: 'Elegíveis', value: c.eligible },
                  ]}
                  caption="Elegibilidade calculada pela view com o consentimento/supressão de HOJE, não no momento do contato."
                />
              </Section>
              <Section title="Contato">
                <StageFunnel
                  stages={[
                    { label: 'Disparados', value: c.dispatched },
                    { label: 'Entregues', value: c.delivered },
                    { label: 'Lidos', value: c.read },
                  ]}
                  caption="Percentuais sobre Disparados. Disparos não são subconjunto dos elegíveis de hoje, por isso ficam em grupo separado."
                />
              </Section>
              <Section title="Pedido vinculado (não é atribuição)">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                  <StatCard label="Carrinhos com pedido vinculado" value={n(c.withLinkedOrder)} />
                  <Notice>
                    DATA_QUALITY_WARNING: a coluna da view se chama <code>purchased_after_contact</code>, mas a definição conta apenas <code>convertedOrderId IS NOT NULL</code> — não exige contato nem ordem temporal. Por isso é mostrada apenas como vínculo de pedido, sem atribuir resultado ao contato.
                  </Notice>
                </div>
              </Section>
            </>
          )
        }}
      </QueryView>
      <CartTrend days={days} />
      <Section title="Painel Metabase — Carrinho abandonado">
        <MetabaseEmbed module="recovery" title="Carrinho abandonado" />
      </Section>
    </>
  )
}

function MessagesTab({ days }: { days: number }) {
  const messages = useDataset<MessageDailyRow>('messageDaily', days)
  const templates = useDataset<TemplateDailyRow>('templateDaily', days)
  type T = ReturnType<typeof templateSemantics>[number]
  const columns: DataTableColumn<T>[] = [
    { key: 'name', label: 'Template', render: (t) => t.name },
    { key: 'evaluated', label: 'Avaliadas', render: (t) => n(t.m.evaluated), hideOnMobile: true },
    { key: 'blocked', label: 'Bloqueadas', render: (t) => n(t.m.blocked), hideOnMobile: true },
    { key: 'dispatched', label: 'Disparadas', render: (t) => n(t.m.dispatched) },
    { key: 'delivered', label: 'Entregues', render: (t) => `${n(t.m.delivered)} (${formatPct(pct(t.m.delivered, t.m.dispatched))})` },
    { key: 'read', label: 'Lidas', render: (t) => `${n(t.m.read)} (${formatPct(pct(t.m.read, t.m.dispatched))})`, hideOnMobile: true },
    { key: 'failed', label: 'Falhas', render: (t) => n(t.m.failed), hideOnMobile: true },
  ]
  return (
    <>
      <Section title={`Mensagens — ${periodLabel(days)}`}>
        <QueryView query={messages} emptyTitle="" fallbackError="Falha ao ler bi_message_daily_stats.">
          {(d) => <MessageCards rows={d.data} />}
        </QueryView>
      </Section>
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MessageTrend days={days} />
        <TemplateBars days={days} />
      </div>
      <Section title="Por template">
        <QueryView query={templates} isEmpty={(d) => d.data.length === 0} emptyTitle="Sem mensagens no período." fallbackError="Falha ao ler bi_template_daily_stats.">
          {(d) => <DataTable columns={columns} rows={templateSemantics(d.data)} rowKey={(t) => t.name} />}
        </QueryView>
      </Section>
      <Section title="Painel Metabase — Envios">
        <MetabaseEmbed module="messages" title="Envios" />
      </Section>
    </>
  )
}

function ConsentsTab({ days }: { days: number }) {
  const current = useDataset<{ scope: string; status: string; count: number }>('consentCurrent', days)
  const orders = useDataset<OrdersConsentRow>('ordersConsentDaily', days)
  return (
    <>
      <Section title="Estado atual por escopo">
        <QueryView query={current} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhum consentimento registrado." fallbackError="Falha ao ler bi_consent_current_state.">
          {(d) => (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {d.data.map((r) => (
                <StatCard key={`${r.scope}-${r.status}`} label={`${r.scope} · ${r.status}`} value={n(r.count)} hint="telefones" />
              ))}
            </div>
          )}
        </QueryView>
      </Section>
      <Section title={`Pedidos dos ${periodLabel(days)} × consentimento`}>
        <QueryView query={orders} emptyTitle="" fallbackError="Falha ao ler bi_orders_consent_funnel_daily.">
          {(d) => {
            const o = sumOrdersConsent(d.data)
            return (
              <>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <StatCard label="Pedidos" value={n(o.orders)} />
                  <StatCard label="Com consentimento transacional" value={n(o.transactional)} hint={`${formatPct(pct(o.transactional, o.orders))} dos pedidos`} />
                  <StatCard label="Com consentimento marketing" value={n(o.marketing)} hint={`${formatPct(pct(o.marketing, o.orders))} dos pedidos`} />
                  <StatCard label="Elegíveis p/ marketing" value={n(o.eligible)} hint="marketing sem supressão/opt-out" />
                </div>
                <p className="mt-2 text-xs text-ink-muted">Transacional e marketing são escopos paralelos e independentes — ambos medidos sobre o total de pedidos, não em sequência.</p>
                <ChartCard className="mt-4" title="Cobertura de consentimento sobre os pedidos" question="Escopos lado a lado (paralelos), cada um sobre o total de pedidos.">
                  <HorizontalBarChart
                    ariaLabel="Pedidos e consentimentos em paralelo"
                    data={[
                      { label: 'Pedidos no período', value: o.orders, color: 'var(--chart-6)' },
                      { label: 'Transacional concedido', value: o.transactional, color: 'var(--chart-1)', hint: formatPct(pct(o.transactional, o.orders)) },
                      { label: 'Marketing concedido', value: o.marketing, color: 'var(--chart-2)', hint: formatPct(pct(o.marketing, o.orders)) },
                      { label: 'Aptos p/ marketing (sem supressão)', value: o.eligible, color: 'var(--chart-3)', hint: formatPct(pct(o.eligible, o.orders)) },
                    ]}
                  />
                </ChartCard>
              </>
            )
          }}
        </QueryView>
      </Section>
      <Section title="Painel Metabase — Consentimentos">
        <MetabaseEmbed module="consents" title="Consentimentos" />
      </Section>
    </>
  )
}

function OrdersTab({ days }: { days: number }) {
  const orders = useDataset<OrdersDailyRow>('ordersDaily', days)
  type R = ReturnType<typeof ordersByPaymentStatus>[number]
  const columns: DataTableColumn<R>[] = [
    { key: 'status', label: 'Status de pagamento', render: (r) => r.status },
    { key: 'count', label: 'Pedidos', render: (r) => n(r.count) },
    { key: 'amount', label: 'Valor', render: (r) => formatMoney(r.amount) },
    { key: 'ticket', label: 'Ticket médio', render: (r) => formatMoney(r.count ? r.amount / r.count : null), hideOnMobile: true },
  ]
  return (
    <>
      <QueryView query={orders} isEmpty={(d) => d.data.length === 0} emptyTitle="Sem pedidos no período." fallbackError="Falha ao ler bi_orders_daily_summary.">
        {(d) => {
          const rows = ordersByPaymentStatus(d.data)
          const total = rows.reduce((a, r) => ({ count: a.count + r.count, amount: a.amount + r.amount }), { count: 0, amount: 0 })
          return (
            <Section title={`Pedidos — ${periodLabel(days)}`}>
              <div className="mb-4 grid grid-cols-2 gap-4">
                <StatCard label="Pedidos (todos os status)" value={n(total.count)} />
                <StatCard label="Valor (todos os status)" value={formatMoney(total.amount)} hint="Inclui pendentes/cancelados — ver tabela por status" />
              </div>
              <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <OrdersTrend days={days} />
                </div>
                <ChartCard title="Pedidos por status de pagamento" question="Participação de cada status na quantidade de pedidos.">
                  <DonutChart ariaLabel="Pedidos por status de pagamento" centerValue={n(total.count)} centerLabel="pedidos" data={rows.slice(0, 6).map((r, i) => ({ label: r.status, value: r.count, color: ['var(--chart-3)', 'var(--chart-4)', 'var(--chart-1)', 'var(--chart-5)', 'var(--chart-2)', 'var(--chart-6)'][i] }))} />
                  <ChartLegend items={rows.slice(0, 6).map((r, i) => ({ label: r.status, color: ['var(--chart-3)', 'var(--chart-4)', 'var(--chart-1)', 'var(--chart-5)', 'var(--chart-2)', 'var(--chart-6)'][i], value: n(r.count) }))} />
                </ChartCard>
              </div>
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.status} />
            </Section>
          )
        }}
      </QueryView>
      <Section title="Painel Metabase — Pedidos">
        <MetabaseEmbed module="orders" title="Pedidos" />
      </Section>
    </>
  )
}

function IntegrationsTab({ days }: { days: number }) {
  const hooks = useDataset<WebhookRow>('webhookDaily', days)
  const columns: DataTableColumn<WebhookRow>[] = [
    { key: 'provider', label: 'Provider', render: (r) => r.provider },
    { key: 'topic', label: 'Tópico', render: (r) => r.topic ?? '—' },
    { key: 'events', label: 'Eventos', render: (r) => n(r.events) },
    { key: 'processed', label: 'Processados', render: (r) => n(r.processed), hideOnMobile: true },
    { key: 'errors', label: 'Erros', render: (r) => n(r.errors) },
    { key: 'rate', label: 'Taxa de erro', render: (r) => formatPct(pct(r.errors, r.events)), hideOnMobile: true },
    { key: 'hmac', label: 'HMAC inválido', render: (r) => n(r.invalid_hmac), hideOnMobile: true },
    { key: 'last', label: 'Último dia', render: (r) => r.last_day, hideOnMobile: true },
  ]
  return (
    <>
      <Section title={`Webhooks — todos os eventos dos ${periodLabel(days)}`}>
        <QueryView query={hooks} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhum webhook no período." fallbackError="Falha ao ler bi_webhook_daily_summary.">
          {(d) => (
            <>
              <ChartCard className="mb-4" title="Eventos por integração" question="Volume do período por provider/tópico; vermelho = com erro.">
                <HorizontalBarChart
                  ariaLabel="Eventos de webhook por provider e tópico"
                  data={[...d.data].sort((a, b) => b.events - a.events).map((r) => ({ label: `${r.provider} · ${r.topic ?? 'sem tópico'}`, value: r.events, color: r.errors > 0 ? 'var(--chart-danger)' : 'var(--chart-1)', hint: r.errors > 0 ? `${n(r.errors)} erros` : undefined }))}
                />
              </ChartCard>
              <DataTable columns={columns} rows={d.data} rowKey={(r) => `${r.provider}|${r.topic}`} />
            </>
          )}
        </QueryView>
      </Section>
      <Section title="Painel Metabase — Webhooks e Saúde">
        <MetabaseEmbed module="integrations" title="Webhooks e Saúde" />
      </Section>
    </>
  )
}

function periodLabel(days: number): string {
  return days === 1 ? 'hoje' : `últimos ${days} dias`
}

// Gráficos diários: "hoje" usa janela de 7 dias para haver tendência.
function MessageTrend({ days }: { days: number }) {
  const d = Math.max(days, 7)
  const q = useDataset<MessageDailyRow>('messageDaily', d)
  const points = q.data ? messageSeries(q.data.data, d) : []
  return (
    <ChartCard title={`Mensagens por dia${days < d ? ' · 7 dias' : ''}`} question="Partição exclusiva por status; taxas sempre sobre disparadas.">
      {q.isPending ? <div className="skeleton h-56" aria-hidden="true" /> : q.isError ? <ChartEmptyState title="Falha ao ler bi_message_daily_stats" /> : hasAny(points, ['read', 'delivered', 'awaiting', 'queued', 'blocked', 'failed']) ? (
        <>
          <StackedBarChart data={points} series={MESSAGE_SERIES} height={230} ariaLabel="Mensagens por dia e status" />
          <ChartLegend items={MESSAGE_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
        </>
      ) : <ChartEmptyState />}
    </ChartCard>
  )
}

function OrdersTrend({ days }: { days: number }) {
  const d = Math.max(days, 7)
  const q = useDataset<OrdersDailyRow>('ordersDaily', d)
  const points = q.data ? ordersSeries(q.data.data, d) : []
  return (
    <ChartCard title={`Pedidos por dia${days < d ? ' · 7 dias' : ''}`} question="Quantidade por status de pagamento — não é faturamento.">
      {q.isPending ? <div className="skeleton h-56" aria-hidden="true" /> : q.isError ? <ChartEmptyState title="Falha ao ler bi_orders_daily_summary" /> : hasAny(points, ['paid', 'pending', 'other']) ? (
        <>
          <StackedBarChart data={points} series={ORDER_SERIES} height={230} ariaLabel="Pedidos por dia e status de pagamento" />
          <ChartLegend items={ORDER_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
        </>
      ) : <ChartEmptyState />}
    </ChartCard>
  )
}

function CartTrend({ days }: { days: number }) {
  const d = Math.max(days, 7)
  const q = useDataset<CartDailyRow>('abandonedCartDaily', d)
  const points = q.data ? cartSeries(q.data.data, d) : []
  return (
    <ChartCard className="mb-6" title={`Carrinhos por dia${days < d ? ' · 7 dias' : ''}`} question="Abandono, elegibilidade atual e disparos, dia a dia." footer="Elegibilidade = estado de hoje. Pedido vinculado não entra no gráfico (não é resultado do contato).">
      {q.isPending ? <div className="skeleton h-56" aria-hidden="true" /> : q.isError ? <ChartEmptyState title="Falha ao ler bi_abandoned_cart_funnel_daily" /> : hasAny(points, ['abandoned', 'eligible', 'dispatched']) ? (
        <>
          <TrendAreaChart data={points} series={CART_SERIES} height={230} ariaLabel="Carrinhos, elegíveis e disparos por dia" />
          <ChartLegend items={CART_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
        </>
      ) : <ChartEmptyState />}
    </ChartCard>
  )
}

function TemplateBars({ days }: { days: number }) {
  const q = useDataset<TemplateDailyRow>('templateDaily', days)
  const rows = q.data ? templateSemantics(q.data.data).filter((t) => t.m.dispatched > 0).slice(0, 8) : []
  return (
    <ChartCard title="Disparadas por template" question="Quais templates mais saíram e quanto foi entregue (sobre disparadas).">
      {q.isPending ? <div className="skeleton h-56" aria-hidden="true" /> : q.isError ? <ChartEmptyState title="Falha ao ler bi_template_daily_stats" /> : rows.length ? (
        <HorizontalBarChart ariaLabel="Mensagens disparadas por template" data={rows.map((t) => ({ label: t.name, value: t.m.dispatched, color: 'var(--chart-1)', hint: `${formatPct(pct(t.m.delivered, t.m.dispatched))} entregues` }))} />
      ) : <ChartEmptyState title="Nenhum disparo no período" />}
    </ChartCard>
  )
}