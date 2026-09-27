import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { Tabs } from '../../components/overlay/Tabs'
import { Drawer } from '../../components/overlay/Drawer'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { Pagination } from '../../components/data/Pagination'
import { SelectFilter } from '../../components/data/FilterBar'
import { QueryView } from '../../components/data/QueryView'
import { CodeBadge } from '../../components/data/CodeBadge'
import { FlagBadge } from '../../components/data/FlagBadge'
import { StatCard } from '../../components/data/StatCard'
import { Notice } from '../../components/feedback/Notice'
import { StageFunnel } from '../../components/viz/StageFunnel'
import { apiGet } from '../../lib/api'
import { MESSAGE_STATUS, RECIPIENT_STATUS, FAILURE_CATEGORY, ELIGIBILITY_REASON, formatMoney, formatDateTime, lookup } from '../../lib/labels'
import type { CheckoutItem, ListResponse, PaymentItem, RemarketingResponse, RemarketingRun } from '../../lib/types'

const PAGE_SIZE = 50
const DISPATCHED = new Set(['sent', 'delivered', 'read'])
const DELIVERED = new Set(['delivered', 'read'])

const TABS = [
  { key: 'checkouts', label: 'Carrinho abandonado' },
  { key: 'pix', label: 'PIX' },
  { key: 'boleto', label: 'Boleto' },
  { key: 'remarketing', label: 'Remarketing' },
]

export function RecoveryPage() {
  const [tab, setTab] = useState('checkouts')
  return (
    <div>
      <PageHeader title="Recovery" subtitle="Elegibilidade, bloqueios e histórico de contato. Somente leitura — regras vêm do backend." />
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === 'checkouts' && <CheckoutsTab />}
      {tab === 'pix' && <PaymentsTab method="pix" />}
      {tab === 'boleto' && <PaymentsTab method="boleto" />}
      {tab === 'remarketing' && <RemarketingTab />}
    </div>
  )
}

function ReasonList({ codes }: { codes: string[] }) {
  if (codes.length === 0) return <span className="text-ink-faint">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {codes.map((c) => (
        <CodeBadge key={c} code={c} map={ELIGIBILITY_REASON} />
      ))}
    </span>
  )
}

// Agrega os motivos QUE O BACKEND DEVOLVEU na pagina carregada — contagem,
// nao reavaliacao de elegibilidade.
function countReasons(lists: string[][]): { code: string; count: number }[] {
  const counts = new Map<string, number>()
  lists.flat().forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1))
  return [...counts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)
}

function CheckoutsTab() {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['checkouts', status, page],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (status) qs.set('status', status)
      return apiGet<ListResponse<CheckoutItem>>(`checkouts?${qs}`, signal)
    },
    placeholderData: keepPreviousData,
  })

  const columns: DataTableColumn<CheckoutItem>[] = [
    { key: 'date', label: 'Data', render: (r) => formatDateTime(r.date), hideOnMobile: true },
    { key: 'customer', label: 'Cliente', render: (r) => r.customer ?? r.phone ?? '—' },
    { key: 'total', label: 'Valor', render: (r) => formatMoney(r.total), hideOnMobile: true },
    { key: 'eligible', label: 'Elegível', render: (r) => (r.eligible === true ? 'Sim' : r.eligible === false ? 'Não' : 'Não avaliado') },
    { key: 'blockers', label: 'Motivos', render: (r) => <ReasonList codes={r.eligible ? [] : r.blockers} /> },
    { key: 'message', label: 'Mensagem', render: (r) => (r.message ? <CodeBadge code={r.message.status} map={MESSAGE_STATUS} /> : <span className="text-ink-faint">Sem contato</span>), hideOnMobile: true },
  ]

  return (
    <>
      <div className="mb-4 flex gap-2">
        <SelectFilter
          label="Status do carrinho"
          value={status}
          options={[
            { value: 'abandoned', label: 'Abandonado' },
            { value: 'converted', label: 'Convertido' },
          ]}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        />
      </div>
      <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhum carrinho encontrado." fallbackError="Falha de rede ao consultar /crm-api/checkouts.">
        {(d) => {
          const rows = d.data
          const withMessage = rows.filter((r) => r.message)
          const reasons = countReasons(rows.filter((r) => r.eligible !== true).map((r) => r.blockers))
          const observedOrders = withMessage.filter((r) => r.convertedOrderId).length
          return (
            <>
              <StageFunnel
                stages={[
                  { label: 'Avaliados', value: rows.length },
                  { label: 'Elegíveis', value: rows.filter((r) => r.eligible === true).length },
                  { label: 'Disparados', value: withMessage.filter((r) => DISPATCHED.has(r.message?.status ?? '')).length },
                  { label: 'Entregues', value: withMessage.filter((r) => DELIVERED.has(r.message?.status ?? '')).length },
                  { label: 'Lidos', value: withMessage.filter((r) => r.message?.status === 'read').length },
                ]}
                caption={`Amostra da página atual — ${rows.length} registros (de ${d.pagination.total.toLocaleString('pt-BR')} no total). Percentuais valem só para esta amostra, não para o período.`}
              />
              <div className="my-4 grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                {/* Evento observado, NAO etapa do funil nem atribuicao de conversao. */}
                <StatCard label="Pedidos com contato registrado" value={observedOrders} hint="Carrinho com mensagem registrada e pedido vinculado. A API não traz horário do contato vs. pedido: não indica ordem nem atribuição." />
                <div className="rounded-card border border-ink-faint/15 bg-surface-raised p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">Motivos de bloqueio — amostra da página atual</p>
                  {reasons.length === 0 ? (
                    <p className="text-sm text-ink-muted">Nenhum bloqueio nesta página.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {reasons.map((r) => (
                        <li key={r.code} className="flex justify-between gap-2">
                          <span title={r.code}>{lookup(ELIGIBILITY_REASON, r.code)?.label}</span>
                          <span className="tabular-nums text-ink-muted">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
              <Pagination pagination={d.pagination} onPage={setPage} noun="carrinhos" />
            </>
          )
        }}
      </QueryView>
    </>
  )
}

function PaymentsTab({ method }: { method: 'pix' | 'boleto' }) {
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['payments', method, page],
    queryFn: ({ signal }) => apiGet<ListResponse<PaymentItem>>(`payments/${method}?page=${page}&pageSize=${PAGE_SIZE}`, signal),
    placeholderData: keepPreviousData,
  })
  const columns: DataTableColumn<PaymentItem>[] = [
    { key: 'order', label: 'Pedido', render: (r) => r.order },
    { key: 'customer', label: 'Cliente', render: (r) => r.customer ?? r.phone ?? '—', hideOnMobile: true },
    { key: 'total', label: 'Valor', render: (r) => formatMoney(r.total), hideOnMobile: true },
    { key: 'payment', label: 'Pagamento', render: (r) => <span title={r.orderStatus}>{r.paymentStatus}</span> },
    { key: 'message', label: 'Mensagem', render: (r) => (r.messageStatus ? <CodeBadge code={r.messageStatus} map={MESSAGE_STATUS} /> : <span className="text-ink-faint">Sem contato</span>) },
    { key: 'reason', label: 'Motivo', render: (r) => <CodeBadge code={r.error?.category} map={FAILURE_CATEGORY} />, hideOnMobile: true },
    { key: 'date', label: 'Data', render: (r) => formatDateTime(r.date), hideOnMobile: true },
  ]
  return (
    <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle={`Nenhum pedido ${method.toUpperCase()} encontrado.`} fallbackError={`Falha de rede ao consultar /crm-api/payments/${method}.`}>
      {(d) => (
        <>
          <DataTable columns={columns} rows={d.data} rowKey={(r) => r.id} />
          <Pagination pagination={d.pagination} onPage={setPage} noun="pedidos" />
        </>
      )}
    </QueryView>
  )
}

function RemarketingTab() {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<RemarketingRun | null>(null)
  const query = useQuery({
    queryKey: ['remarketing', page],
    queryFn: ({ signal }) => apiGet<RemarketingResponse>(`remarketing?page=${page}&pageSize=20`, signal),
    placeholderData: keepPreviousData,
  })
  const columns: DataTableColumn<RemarketingRun>[] = [
    { key: 'startedAt', label: 'Início', render: (r) => formatDateTime(r.startedAt) },
    { key: 'segment', label: 'Segmento', render: (r) => r.segment },
    { key: 'mode', label: 'Modo', render: (r) => r.mode, hideOnMobile: true },
    { key: 'candidates', label: 'Avaliados', render: (r) => r.candidateCount, hideOnMobile: true },
    { key: 'eligible', label: 'Elegíveis', render: (r) => r.eligibleCount },
    { key: 'sent', label: 'Disparados', render: (r) => r.sentCount },
    { key: 'skipped', label: 'Não disparados', render: (r) => r.skippedCount, hideOnMobile: true },
    { key: 'failed', label: 'Falhas', render: (r) => r.failedCount, hideOnMobile: true },
  ]
  return (
    <QueryView query={query} emptyTitle="" fallbackError="Falha de rede ao consultar /crm-api/remarketing.">
      {(d) => (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <FlagBadge name="REMARKETING_ENABLED" label="Remarketing" value={d.runtime.enabled} />
            <FlagBadge name="AUTOMATION_SEND_ENABLED" label="Envio automático" value={d.runtime.automationSendEnabled} />
            <FlagBadge name="WHATSAPP_DRY_RUN" label="Dry-run WhatsApp" value={d.runtime.dryRun} />
          </div>
          {d.data.length === 0 ? (
            <Notice>Nenhuma execução de remarketing registrada.</Notice>
          ) : (
            <>
              <DataTable columns={columns} rows={d.data} rowKey={(r) => r.id} onRowClick={setSelected} />
              <Pagination pagination={d.pagination} onPage={setPage} noun="execuções" />
            </>
          )}
          <Drawer open={selected !== null} title="Destinatários da execução" onClose={() => setSelected(null)}>
            {selected && (
              <>
                <p className="mb-3 text-xs text-ink-muted">Últimos {selected.recipients.length} destinatários retornados pela API.</p>
                <ul className="space-y-3">
                  {selected.recipients.map((r) => (
                    <li key={r.id} className="border-b border-ink-faint/10 pb-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-ink">{r.templateName}</span>
                        <CodeBadge code={r.status} map={RECIPIENT_STATUS} />
                      </div>
                      <div className="mt-1">
                        <ReasonList codes={r.eligibilitySnapshot?.reasons ?? (r.reason ? [r.reason] : [])} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Drawer>
        </>
      )}
    </QueryView>
  )
}
