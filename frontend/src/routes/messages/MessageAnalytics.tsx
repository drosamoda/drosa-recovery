import { useSearchParams } from 'react-router-dom'
import { Ban, CheckCheck, CircleAlert, Eye, Hourglass, Send } from 'lucide-react'
import { KpiCard } from '../../components/data/KpiCard'
import { ChartCard, ChartEmptyState, ChartLegend } from '../../components/charts/ChartCard'
import { DonutChart, StackedBarChart } from '../../components/charts/charts'
import { ChartSkeleton, KpiSkeleton } from '../../components/feedback/Skeleton'
import { formatPct, messageSemantics, pct, type MessageDailyRow } from '../../lib/biMetrics'
import { periodOption, usePeriod } from '../../lib/period'
import { useBiDataset } from '../../lib/queries'
import { hasAny, messageSeries } from '../../lib/series'
import { MESSAGE_SERIES, SERIES_TO_STATUS } from '../../lib/chartSeries'

const nf = (v: number) => v.toLocaleString('pt-BR')

// Visão analítica de Mensagens (bi_message_daily_stats). Mesma semântica do BI:
// "sent" = disparada aguardando entrega; taxas sempre sobre DISPARADAS.
export function MessageAnalytics() {
  const [, setParams] = useSearchParams()
  const { period } = usePeriod()
  const opt = periodOption(period)
  const chartDays = Math.max(opt.days, 7)
  const kpi = useBiDataset<MessageDailyRow>('messageDaily', opt.days)
  const trend = useBiDataset<MessageDailyRow>('messageDaily', chartDays)
  const filter = (status: string) => setParams({ status }, { replace: true })

  if (kpi.isPending || trend.isPending) {
    return (
      <div className="mb-6 space-y-4">
        <KpiSkeleton count={6} />
        <ChartSkeleton />
      </div>
    )
  }
  if (kpi.isError || trend.isError || !kpi.data || !trend.data) {
    return <ChartEmptyState title="Analytics de mensagens indisponível" description="As views bi_* não responderam; a lista abaixo continua usando /crm-api/messages." />
  }

  const m = messageSemantics(kpi.data.data)
  const points = messageSeries(trend.data.data, chartDays)
  const distribution = [
    { label: 'Lidas', value: m.read, color: 'var(--chart-3)' },
    { label: 'Entregues (não lidas)', value: m.delivered - m.read, color: 'var(--chart-1)' },
    { label: 'Aguardando entrega', value: m.awaitingDelivery, color: 'var(--chart-5)' },
    { label: 'Na fila', value: m.queued, color: 'var(--chart-6)' },
    { label: 'Bloqueadas', value: m.blocked, color: 'var(--chart-4)' },
    { label: 'Falhas', value: m.failed, color: 'var(--chart-danger)' },
  ]

  return (
    <div className="mb-6 space-y-4">
      <section aria-label={`Mensagens — ${opt.label}`} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Disparadas" value={nf(m.dispatched)} icon={Send} tone="data" context={`de ${nf(m.evaluated)} avaliadas`} spark={points.map((p) => p.read + p.delivered + p.awaiting)} />
        <KpiCard label="Aguardando entrega" value={nf(m.awaitingDelivery)} icon={Hourglass} context="status sent" tooltip="Disparada, sem confirmação de entrega" to="/messages?status=sent" />
        <KpiCard label="Entregues" value={nf(m.delivered)} icon={CheckCheck} tone="success" context={`${formatPct(pct(m.delivered, m.dispatched))} das disparadas`} spark={points.map((p) => p.delivered + p.read)} />
        <KpiCard label="Lidas" value={nf(m.read)} icon={Eye} tone="success" context={`${formatPct(pct(m.read, m.dispatched))} das disparadas`} spark={points.map((p) => p.read)} />
        <KpiCard label="Bloqueadas" value={nf(m.blocked)} icon={Ban} tone="warning" context="não disparadas por regra" to="/messages?status=skipped" />
        <KpiCard label="Falhas" value={nf(m.failed)} icon={CircleAlert} tone={m.failed > 0 ? 'danger' : 'default'} context={m.unknown ? `${nf(m.unknown)} em estado desconhecido` : undefined} to="/messages?status=failed" />
      </section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title={`Volume por dia${opt.days < chartDays ? ' · tendência 7 dias' : ''}`} question="Clique numa série para filtrar a tabela abaixo por esse status.">
          {hasAny(points, ['read', 'delivered', 'awaiting', 'queued', 'blocked', 'failed']) ? (
            <>
              <StackedBarChart data={points} series={MESSAGE_SERIES} height={240} ariaLabel="Mensagens por dia e status" onBarClick={(k) => filter(SERIES_TO_STATUS[k])} />
              <ChartLegend items={MESSAGE_SERIES.map((s) => ({ label: s.label, color: s.color }))} />
            </>
          ) : (
            <ChartEmptyState />
          )}
        </ChartCard>
        <ChartCard title="Distribuição por status" question={`Estado atual das mensagens de ${opt.label.toLowerCase()}.`}>
          <DonutChart data={distribution} ariaLabel="Distribuição de mensagens por status" centerValue={nf(m.evaluated)} centerLabel="avaliadas" />
          <ChartLegend items={distribution.map((d) => ({ label: d.label, color: d.color ?? '', value: nf(d.value) }))} />
        </ChartCard>
      </div>
    </div>
  )
}
