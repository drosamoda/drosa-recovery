import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
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
  { key: 'overview', label: 'Visão geral' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'audit', label: 'Auditoria' },
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
      <PageHeader title="Saúde" subtitle="Integrações, filas, webhooks e auditoria. Somente leitura." />
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

function OverviewTab() {
  const query = useQuery({ queryKey: ['health'], queryFn: ({ signal }) => apiGet<HealthResponse>('health', signal) })
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
        return (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {Object.entries(h.runtime).map(([key, value]) => (
                <FlagBadge key={key} name={key} label={RUNTIME_LABELS[key] ?? key} value={value} />
              ))}
            </div>
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
            <strong>Últimos {d.data.length} eventos</strong> (de {d.pagination.total.toLocaleString('pt-BR')} registrados). Contagens e taxa de erro valem só para esta janela, não são histórico global. Agregado completo por provider/tópico não é exposto pela API atual <span className="text-ink-faint">(NOT_AVAILABLE_FROM_CURRENT_API)</span>; erros históricos seguem em investigação separada. Esta tela não altera o processamento de webhooks.
          </Notice>
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
