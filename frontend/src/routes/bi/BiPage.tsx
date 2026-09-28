import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { Tabs } from '../../components/overlay/Tabs'
import { StatCard } from '../../components/data/StatCard'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { QueryView } from '../../components/data/QueryView'
import { SelectFilter } from '../../components/data/FilterBar'
import { MetabaseEmbed } from '../../components/data/MetabaseEmbed'
import { Notice } from '../../components/feedback/Notice'
import { StageFunnel } from '../../components/viz/StageFunnel'
import { apiGet } from '../../lib/api'
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
  { key: 'executive', label: 'Visão Executiva' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'messages', label: 'Mensagens' },
  { key: 'consents', label: 'Consentimentos' },
  { key: 'orders', label: 'Pedidos' },
  { key: 'integrations', label: 'Integrações' },
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

function useDataset<T>(dataset: string, days: number) {
  return useQuery({
    queryKey: ['bi', dataset, days],
    queryFn: ({ signal }) => apiGet<{ data: T[]; days: number }>(`bi/data/${dataset}?days=${days}`, signal),
    staleTime: 60_000,
  })
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

const n = (v: number) => v.toLocaleString('pt-BR')

export function BiPage() {
  const [tab, setTab] = useState('executive')
  const [days, setDays] = useState(30)
  return (
    <div>
      <PageHeader title="BI & Inteligência" subtitle="Tendência e histórico a partir das views bi_* (somente leitura) + painéis Metabase." />
      <Tabs items={TABS} active={tab} onChange={setTab} />
      <div className="mb-4">
        <SelectFilter
          label="Período"
          includeAll={false}
          value={String(days)}
          options={[
            { value: '7', label: 'Últimos 7 dias' },
            { value: '30', label: 'Últimos 30 dias' },
            { value: '90', label: 'Últimos 90 dias' },
          ]}
          onChange={(v) => setDays(Number(v) || 30)}
        />
      </div>
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
      <Section title={`Mensagens — últimos ${days} dias`}>
        <QueryView query={messages} emptyTitle="" fallbackError="Falha ao ler bi_message_daily_stats.">
          {(d) => <MessageCards rows={d.data} />}
        </QueryView>
      </Section>
      <Section title="Painel Metabase — Visão Executiva">
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
              <Section title={`Elegibilidade (estado atual) — carrinhos dos últimos ${days} dias`}>
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
                <div className="grid gap-4 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
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
      <Section title={`Mensagens — últimos ${days} dias`}>
        <QueryView query={messages} emptyTitle="" fallbackError="Falha ao ler bi_message_daily_stats.">
          {(d) => <MessageCards rows={d.data} />}
        </QueryView>
      </Section>
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
      <Section title={`Pedidos dos últimos ${days} dias × consentimento`}>
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
            <Section title={`Pedidos — últimos ${days} dias`}>
              <div className="mb-4 grid grid-cols-2 gap-4">
                <StatCard label="Pedidos (todos os status)" value={n(total.count)} />
                <StatCard label="Valor (todos os status)" value={formatMoney(total.amount)} hint="Inclui pendentes/cancelados — ver tabela por status" />
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
      <Section title={`Webhooks — todos os eventos dos últimos ${days} dias`}>
        <QueryView query={hooks} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhum webhook no período." fallbackError="Falha ao ler bi_webhook_daily_summary.">
          {(d) => <DataTable columns={columns} rows={d.data} rowKey={(r) => `${r.provider}|${r.topic}`} />}
        </QueryView>
      </Section>
      <Section title="Painel Metabase — Webhooks e Saúde">
        <MetabaseEmbed module="integrations" title="Webhooks e Saúde" />
      </Section>
    </>
  )
}
