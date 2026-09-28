import { useQuery } from '@tanstack/react-query'
import { CheckCheck, Eye, Link2, Send, ShoppingCart, ShieldCheck } from 'lucide-react'
import { KpiCard } from '../../components/data/KpiCard'
import { ChartCard, ChartEmptyState, ChartLegend } from '../../components/charts/ChartCard'
import { DonutChart, StackedBarChart, TrendAreaChart, type Series } from '../../components/charts/charts'
import { ChartSkeleton, KpiSkeleton } from '../../components/feedback/Skeleton'
import { apiGet } from '../../lib/api'
import { formatPct, pct, sumCart, type CartDailyRow } from '../../lib/biMetrics'
import { CART_SERIES } from '../../lib/chartSeries'
import { MESSAGE_STATUS } from '../../lib/labels'
import { periodOption, usePeriod } from '../../lib/period'
import { useBiDataset, useDashboard } from '../../lib/queries'
import { cartSeries, hasAny } from '../../lib/series'
import type { ListResponse, PaymentItem, RemarketingRun } from '../../lib/types'

const nf = (v: number) => (Number.isFinite(v) ? v.toLocaleString('pt-BR') : '—')

// Carrinho abandonado — período via bi_abandoned_cart_funnel_daily. Dois
// grupos independentes: elegibilidade (estado atual) e contato (disparos).
// Pedido vinculado é mostrado como vínculo, nunca como resultado do contato.
export function CartAnalytics() {
  const { period } = usePeriod()
  const opt = periodOption(period)
  const chartDays = Math.max(opt.days, 7)
  const kpi = useBiDataset<CartDailyRow>('abandonedCartDaily', opt.days)
  const trend = useBiDataset<CartDailyRow>('abandonedCartDaily', chartDays)
  if (kpi.isPending || trend.isPending) {
    return (
      <div className="mb-6 space-y-4">
        <KpiSkeleton count={6} />
        <ChartSkeleton />
      </div>
    )
  }
  if (!kpi.data || !trend.data || !Array.isArray(kpi.data.data)) {
    return (
      <div className="mb-6">
        <ChartEmptyState title="Analytics do período indisponível" description="As views bi_* não responderam; a lista abaixo usa /crm-api/checkouts." />
      </div>
    )
  }
  const c = sumCart(kpi.data.data)
  const points = cartSeries(trend.data.data, chartDays)
  return (
    <div className="mb-6 space-y-4">
      <section aria-label={`Carrinhos — ${opt.label}`} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Carrinhos no período" value={nf(c.evaluated)} icon={ShoppingCart} tone="accent" spark={points.map((p) => p.abandoned)} />
        <KpiCard label="Elegíveis hoje" value={nf(c.eligible)} icon={ShieldCheck} tone="warning" context={`${formatPct(pct(c.eligible, c.evaluated))} dos carrinhos`} tooltip="Com consentimento/supressão de hoje" />
        <KpiCard label="Com disparo" value={nf(c.dispatched)} icon={Send} tone="data" spark={points.map((p) => p.dispatched)} />
        <KpiCard label="Entregues" value={nf(c.delivered)} icon={CheckCheck} tone="success" context={`${formatPct(pct(c.delivered, c.dispatched))} dos disparos`} />
        <KpiCard label="Lidos" value={nf(c.read)} icon={Eye} tone="success" context={`${formatPct(pct(c.read, c.dispatched))} dos disparos`} />
        <KpiCard label="Com pedido vinculado" value={nf(c.withLinkedOrder)} icon={Link2} context="vínculo, não atribuição" tooltip="convertedOrderId preenchido; não exige contato nem ordem temporal" />
      </section>
      <ChartCard
        title={`Volume por dia${opt.days < chartDays ? ' · tendência 7 dias' : ''}`}
        question="Abandono × elegibilidade × disparos, dia a dia."
        footer="Elegibilidade é o estado de HOJE (consentimento/supressão atuais), não o do momento do contato."
      >
        {hasAny(points, ['abandoned', 'eligible', 'dispatched']) ? (
          <>
            <TrendAreaChart data={points} series={CART_SERIES} height={220} ariaLabel="Carrinhos, elegíveis e disparos por dia" />
            <ChartLegend items={CART_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
          </>
        ) : (
          <ChartEmptyState />
        )}
      </ChartCard>
    </div>
  )
}

// PIX/Boleto: total pendente do período (dashboard) + estado de contato da
// página carregada (mesma query key da tabela, sem request extra).
export function PaymentsAnalytics({ method }: { method: 'pix' | 'boleto' }) {
  const { period } = usePeriod()
  const opt = periodOption(period)
  const dashboard = useDashboard(period)
  const page = useQuery({
    queryKey: ['payments', method, 1],
    queryFn: ({ signal }) => apiGet<ListResponse<PaymentItem>>(`payments/${method}?page=1&pageSize=50`, signal),
  })
  const pending = dashboard.data ? (method === 'pix' ? dashboard.data.pixPending : dashboard.data.boletoPending) : null
  const rows = page.data && Array.isArray(page.data.data) ? page.data.data : []
  const byStatus = new Map<string, number>()
  for (const r of rows) byStatus.set(r.messageStatus ?? 'none', (byStatus.get(r.messageStatus ?? 'none') ?? 0) + 1)
  const COLORS: Record<string, string> = { read: 'var(--chart-3)', delivered: 'var(--chart-1)', sent: 'var(--chart-5)', skipped: 'var(--chart-4)', failed: 'var(--chart-danger)', none: 'var(--chart-6)' }
  const donut = [...byStatus.entries()].map(([k, v]) => ({ label: k === 'none' ? 'Sem contato' : (MESSAGE_STATUS[k]?.label ?? k), value: v, color: COLORS[k] ?? 'var(--chart-6)' }))
  const name = method === 'pix' ? 'PIX' : 'Boleto'
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-3">
      <KpiCard label={`${name} pendentes · ${opt.label.toLowerCase()}`} value={pending === null ? '—' : nf(pending)} tone={pending ? 'warning' : 'default'} context="pedidos sem pagamento confirmado" tooltip="Fonte: /crm-api/dashboard" size="lg" />
      <ChartCard className="lg:col-span-2" title="Contato por pedido" question={`Situação da mensagem nos ${rows.length} pedidos mais recentes carregados (amostra da página, não o período).`}>
        {rows.length ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <DonutChart data={donut} ariaLabel={`Situação do contato em pedidos ${name}`} centerValue={nf(rows.length)} centerLabel="pedidos" size={148} />
            <ChartLegend items={donut.map((d) => ({ label: d.label, color: d.color, value: nf(d.value) }))} />
          </div>
        ) : (
          <ChartEmptyState title="Sem pedidos carregados" />
        )}
      </ChartCard>
    </div>
  )
}

const RUN_SERIES: Series[] = [
  { key: 'sent', label: 'Disparados', color: 'var(--chart-1)' },
  { key: 'skipped', label: 'Não disparados', color: 'var(--chart-4)' },
  { key: 'failed', label: 'Falhas', color: 'var(--chart-danger)' },
]

export function RemarketingChart({ runs }: { runs: RemarketingRun[] }) {
  const data = [...runs].reverse().map((r) => ({ day: r.startedAt.slice(0, 10), sent: r.sentCount, skipped: r.skippedCount, failed: r.failedCount }))
  if (!data.length) return null
  return (
    <ChartCard className="mb-4" title="Execuções de remarketing" question="Resultado de cada execução carregada (disparos × bloqueios × falhas).">
      <StackedBarChart data={data} series={RUN_SERIES} height={200} ariaLabel="Resultado por execução de remarketing" />
      <ChartLegend items={RUN_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
    </ChartCard>
  )
}
