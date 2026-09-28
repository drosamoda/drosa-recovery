import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, MinusCircle, TriangleAlert, XCircle, LayoutGrid, Webhook, ScrollText } from 'lucide-react'
import { ChartCard, ChartEmptyState } from '../../components/charts/ChartCard'
import { HorizontalBarChart } from '../../components/charts/charts'
import { useBiDataset, useHealth, type WebhookSummaryRow } from '../../lib/queries'
import { periodOption, usePeriod } from '../../lib/period'
import { PeriodFilter } from '../../components/navigation/PeriodFilter'
import { PageHeader } from '../../components/shell/PageHeader'
import { Tabs } from '../../components/overlay/Tabs'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { Pagination } from '../../components/data/Pagination'
import { QueryView } from '../../components/data/QueryView'
import { FlagBadge } from '../../components/data/FlagBadge'
import { HealthCard, type HealthCardProps } from '../../components/data/HealthCard'
import { Notice } from '../../components/feedback/Notice'
import { apiGet } from '../../lib/api'
import { formatDateTime } from '../../lib/labels'
import type { AuditEvent, AuditResponse, HealthResponse, WebhookEvidence } from '../../lib/types'

const TABS = [
  { key: 'overview', label: 'Visão geral', icon: LayoutGrid },
  { key: 'webhooks', label: 'Webhooks', icon: Webhook },
  { key: 'audit', label: 'Auditoria', icon: ScrollText },
]

// Nome da flag no backend -> rotulo. Semantica neutra (FlagBadge).
const RUNTIME_LABELS: Record<string, string> = {
  cron: 'Cron',
  automationSend: 'Envio automático',
  abandonedCart: 'Fluxo de carrinho',
  remarketing: 'Remarketing',
  whatsappDryRun: 'Dry-run WhatsApp',
  inboxDryRun: 'Dry-run inbox',
}

export function HealthPage() {
  const [tab, setTab] = useState('overview')
  return (
    <div>
      <PageHeader title="Saúde" subtitle="Painel técnico: integrações, webhooks, filas, flags e auditoria. Somente leitura." actions={tab === 'webhooks' ? <PeriodFilter /> : undefined} />
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

function webhookCard(title: string, configured: boolean, ev: WebhookEvidence | null, impact: string): HealthCardProps {
  const problem = !ev ? null : ev.error ? ev.error : !ev.hmacValid ? 'Último evento com HMAC inválido' : !ev.processed ? 'Último evento ainda não processado' : null
  const state = !configured
    ? { label: 'Não configurado', tone: 'warning' as const }
    : !ev
      ? { label: 'Sem evidência recente', tone: 'neutral' as const }
      : problem
        ? { label: 'Com problema registrado', tone: 'danger' as const }
        : { label: 'Recebendo eventos', tone: 'success' as const }
  return {
    title,
    state,
    evidence: ev ? formatDateTime(ev.createdAt) : 'Nenhum evento registrado',
    problem,
    impact,
    action: problem ? 'Investigar o último evento na aba Auditoria.' : 'Nenhuma.',
  }
}

type Cell = { tone: 'ok' | 'warn' | 'bad' | 'na'; text: string }

const CELL: Record<Cell['tone'], string> = {
  ok: 'text-status-success',
  warn: 'text-status-warning',
  bad: 'text-status-danger',
  na: 'text-ink-faint',
}
const CELL_ICON: Record<Cell['tone'], typeof CheckCircle2> = { ok: CheckCircle2, warn: TriangleAlert, bad: XCircle, na: MinusCircle }

function hookRow(configured: boolean, ev: WebhookEvidence | null): Cell[] {
  return [
    configured ? { tone: 'ok', text: 'Sim' } : { tone: 'warn', text: 'Não' },
    ev ? { tone: 'ok', text: formatDateTime(ev.createdAt) } : { tone: 'na', text: 'Sem evento' },
    !ev ? { tone: 'na', text: '—' } : ev.hmacValid ? { tone: 'ok', text: 'Válido' } : { tone: 'bad', text: 'Inválido' },
    !ev ? { tone: 'na', text: '—' } : ev.processed ? { tone: 'ok', text: 'Sim' } : { tone: 'warn', text: 'Não' },
    !ev ? { tone: 'na', text: '—' } : ev.error ? { tone: 'bad', text: ev.error } : { tone: 'ok', text: 'Nenhum' },
  ]
}

// Matriz de status: cada célula vem de um campo real de /crm-api/health.
// Ícone + texto em toda célula (cor nunca é o único significado).
function StatusMatrix({ h }: { h: HealthResponse }) {
  const rows: { name: string; cells: Cell[] }[] = [
    { name: 'Webhook Meta', cells: hookRow(h.meta.configured, h.meta.latestEvidence) },
    { name: 'Webhook Nuvemshop', cells: hookRow(h.nuvemshop.configured, h.nuvemshop.latestEvidence) },
  ]
  const cols = ['Configurado', 'Último evento', 'HMAC', 'Processado', 'Erro']
  return (
    <section className="panel enter overflow-hidden" aria-label="Matriz de status das integrações">
      <header className="border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <h2 className="text-sm font-semibold text-ink">Status matrix · webhooks</h2>
        <p className="mt-0.5 text-xs text-ink-faint">Último evento recebido de cada integração e o que aconteceu com ele.</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr>
              <th scope="col" className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Integração</th>
              {cols.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <th scope="row" className="whitespace-nowrap px-4 py-3 text-left font-medium text-ink">{r.name}</th>
                {r.cells.map((cell, i) => {
                  const Icon = CELL_ICON[cell.tone]
                  return (
                    <td key={cols[i]} className="px-3 py-3">
                      <span className={`inline-flex max-w-[16rem] items-center gap-1.5 text-xs ${CELL[cell.tone]}`}>
                        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate" title={cell.text}>{cell.text}</span>
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function OverviewTab() {
  const navigate = useNavigate()
  const query = useHealth()
  return (
    <QueryView query={query} emptyTitle="" fallbackError="Falha de rede ao consultar /crm-api/health.">
      {(h) => {
        const engineProblem = [h.recoveryEngine.failed && `${h.recoveryEngine.failed} falhas`, h.recoveryEngine.unknown && `${h.recoveryEngine.unknown} em estado desconhecido`].filter(Boolean).join(', ')
        const cards: HealthCardProps[] = [
          webhookCard('Meta (WhatsApp)', h.meta.configured, h.meta.latestEvidence, 'Status de entrega/leitura e mensagens recebidas podem atrasar.'),
          webhookCard('Nuvemshop', h.nuvemshop.configured, h.nuvemshop.latestEvidence, 'Pedidos e carrinhos novos podem não entrar no Recovery.'),
          {
            title: 'Motor de Recovery',
            state: engineProblem ? { label: 'Com pendências', tone: 'warning' } : { label: 'Sem falhas registradas', tone: 'success' },
            evidence: `${h.recoveryEngine.pending} na fila · ${h.recoveryEngine.processing} em processamento${h.recoveryEngine.oldestPending ? ` · mais antiga ${formatDateTime(h.recoveryEngine.oldestPending)}` : ''}`,
            problem: engineProblem || null,
            impact: 'Mensagens com falha/desconhecidas não têm entrega confirmada.',
            action: engineProblem ? 'Ver motivos em Mensagens (filtro Falhou / Estado desconhecido).' : 'Nenhuma.',
          },
          {
            title: 'Espelho do inbox',
            state: h.inboxMirror.failed ? { label: 'Com falhas de espelhamento', tone: 'warning' } : { label: 'Sem falhas registradas', tone: 'success' },
            evidence: h.inboxMirror.latestSuccess ? `Último sucesso ${formatDateTime(h.inboxMirror.latestSuccess)}` : 'Nenhum espelhamento registrado',
            problem: h.inboxMirror.failed ? `${h.inboxMirror.failed} mensagens não espelhadas` : null,
            impact: 'Conversas podem não mostrar mensagens disparadas pelo Recovery.',
            action: h.inboxMirror.failed ? 'Conferir mensagens com espelhamento falho.' : 'Nenhuma.',
          },
        ]
        const e = h.recoveryEngine
        return (
          <>
            <div className="mb-4 grid gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <StatusMatrix h={h} />
              </div>
              <ChartCard title="Motor de mensagens · agora" question="Onde estão as mensagens que ainda não têm desfecho?">
                <HorizontalBarChart
                  ariaLabel="Estado atual da fila de mensagens"
                  data={[
                    { label: 'Na fila', value: e.pending, color: 'var(--chart-6)' },
                    { label: 'Em processamento', value: e.processing, color: 'var(--chart-1)' },
                    { label: 'Estado desconhecido', value: e.unknown, color: 'var(--chart-4)' },
                    { label: 'Falhas', value: e.failed, color: 'var(--chart-danger)' },
                    { label: 'Não espelhadas no inbox', value: h.inboxMirror.failed, color: 'var(--chart-5)' },
                  ]}
                  onSelect={(d) => navigate(d.label === 'Falhas' ? '/messages?status=failed' : d.label === 'Na fila' ? '/messages?status=pending' : d.label === 'Estado desconhecido' ? '/messages?status=unknown' : '/messages')}
                />
                {e.oldestPending && <p className="mt-3 text-xs text-ink-faint">Mais antiga na fila: {formatDateTime(e.oldestPending)}</p>}
              </ChartCard>
            </div>
            <h2 className="t-section mb-2">Flags de runtime</h2>
            <div className="mb-5 flex flex-wrap gap-2">
              {Object.entries(h.runtime).map(([key, value]) => (
                <FlagBadge key={key} name={key} label={RUNTIME_LABELS[key] ?? key} value={value} />
              ))}
            </div>
            <h2 className="t-section mb-2">Integrações e componentes</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {cards.map((c) => (
                <HealthCard key={c.title} {...c} />
              ))}
            </div>
          </>
        )
      }}
    </QueryView>
  )
}

interface WebhookAggregate {
  key: string
  provider: string
  topic: string
  total: number
  processed: number
  errors: number
  last: string
}

// A API nao tem agregado por provider/topic: agrega-se a AMOSTRA dos eventos
// mais recentes (pageSize maximo = 100), rotulada como tal.
function aggregate(events: AuditEvent[]): WebhookAggregate[] {
  const map = new Map<string, WebhookAggregate>()
  for (const e of events) {
    const key = `${e.provider}|${e.topic ?? '—'}`
    const row = map.get(key) ?? { key, provider: e.provider, topic: e.topic ?? '—', total: 0, processed: 0, errors: 0, last: e.createdAt }
    row.total += 1
    if (e.processed) row.processed += 1
    if (e.error) row.errors += 1
    if (e.createdAt > row.last) row.last = e.createdAt
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

function WebhooksTab() {
  const query = useQuery({ queryKey: ['audit', 'sample'], queryFn: ({ signal }) => apiGet<AuditResponse>('audit?page=1&pageSize=100', signal) })
  const columns: DataTableColumn<WebhookAggregate>[] = [
    { key: 'provider', label: 'Provider', render: (r) => r.provider },
    { key: 'topic', label: 'Tópico', render: (r) => r.topic },
    { key: 'total', label: 'Total', render: (r) => r.total },
    { key: 'processed', label: 'Processados', render: (r) => r.processed, hideOnMobile: true },
    { key: 'errors', label: 'Erros', render: (r) => r.errors },
    { key: 'rate', label: 'Taxa de erro (janela)', render: (r) => `${((r.errors / r.total) * 100).toFixed(1)}%`, hideOnMobile: true },
    { key: 'last', label: 'Última ocorrência', render: (r) => formatDateTime(r.last), hideOnMobile: true },
  ]
  return (
    <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhum evento de webhook registrado." fallbackError="Falha de rede ao consultar /crm-api/audit.">
      {(d) => (
        <>
          <Notice>
            <strong>Últimos {d.data.length} eventos</strong> (de {d.pagination.total.toLocaleString('pt-BR')} registrados). Contagens e taxa de erro valem só para esta janela, não são histórico global. Agregado completo por provider/tópico e período: <strong>BI &amp; Inteligência › Integrações</strong> (view bi_webhook_daily_summary); erros históricos seguem em investigação separada. Esta tela não altera o processamento de webhooks.
          </Notice>
          <WebhookPeriodChart />
          <DataTable columns={columns} rows={aggregate(d.data)} rowKey={(r) => r.key} />
        </>
      )}
    </QueryView>
  )
}

function AuditTab() {
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['audit', page],
    queryFn: ({ signal }) => apiGet<AuditResponse>(`audit?page=${page}&pageSize=50`, signal),
    placeholderData: keepPreviousData,
  })
  const columns: DataTableColumn<AuditEvent>[] = [
    { key: 'createdAt', label: 'Recebido em', render: (e) => formatDateTime(e.createdAt) },
    { key: 'provider', label: 'Provider', render: (e) => e.provider },
    { key: 'topic', label: 'Tópico', render: (e) => e.topic ?? '—', hideOnMobile: true },
    { key: 'hmac', label: 'HMAC', render: (e) => (e.hmacValid ? 'Válido' : 'Inválido'), hideOnMobile: true },
    { key: 'processed', label: 'Processado', render: (e) => (e.processed ? 'Sim' : 'Não') },
    { key: 'error', label: 'Erro', render: (e) => <span className="break-all">{e.error ?? '—'}</span>, hideOnMobile: true },
  ]
  return (
    <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhum evento registrado." fallbackError="Falha de rede ao consultar /crm-api/audit.">
      {(d) => (
        <>
          {d.fullAuditLog.status === 'NOT_AVAILABLE' && (
            <Notice>
              Log de auditoria completo (ações de operador) ainda não existe; faltam: {d.fullAuditLog.missing.join(', ')}. Abaixo, eventos de webhook recebidos.
            </Notice>
          )}
          <DataTable columns={columns} rows={d.data} rowKey={(e) => e.id} />
          <Pagination pagination={d.pagination} onPage={setPage} noun="eventos" />
        </>
      )}
    </QueryView>
  )
}

// Agregado COMPLETO do período (bi_webhook_daily_summary), separado da amostra acima.
function WebhookPeriodChart() {
  const { period } = usePeriod()
  const opt = periodOption(period)
  const q = useBiDataset<WebhookSummaryRow>('webhookDaily', opt.days)
  const rows = q.data && Array.isArray(q.data.data) ? q.data.data : null
  return (
    <ChartCard className="mb-4" title={`Eventos por integração · ${opt.label.toLowerCase()}`} question="Volume total do período por provider/tópico; vermelho = com erro registrado.">
      {q.isPending ? (
        <div className="skeleton h-40" aria-hidden="true" />
      ) : !rows ? (
        <ChartEmptyState title="BI indisponível" />
      ) : rows.length === 0 ? (
        <ChartEmptyState title="Nenhum webhook no período" />
      ) : (
        <HorizontalBarChart
          ariaLabel="Eventos de webhook no período por provider e tópico"
          data={[...rows].sort((a, b) => b.events - a.events).map((r) => ({ label: `${r.provider} · ${r.topic ?? 'sem tópico'}`, value: r.events, color: r.errors > 0 ? 'var(--chart-danger)' : 'var(--chart-1)', hint: r.errors > 0 ? `${r.errors.toLocaleString('pt-BR')} erros · ${r.invalid_hmac} HMAC inválido` : undefined }))}
        />
      )}
    </ChartCard>
  )
}