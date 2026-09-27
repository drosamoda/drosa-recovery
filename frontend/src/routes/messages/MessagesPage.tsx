import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { Tabs } from '../../components/overlay/Tabs'
import { Drawer } from '../../components/overlay/Drawer'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { Pagination } from '../../components/data/Pagination'
import { FilterBar, SelectFilter } from '../../components/data/FilterBar'
import { QueryView } from '../../components/data/QueryView'
import { CodeBadge } from '../../components/data/CodeBadge'
import { Field } from '../../components/data/Field'
import { apiGet } from '../../lib/api'
import { MESSAGE_STATUS, FAILURE_CATEGORY, formatDateTime } from '../../lib/labels'
import type { ListResponse, MessageListItem, MessageDetail, TemplateItem } from '../../lib/types'

const PAGE_SIZE = 25
const STATUS_OPTIONS = Object.entries(MESSAGE_STATUS).map(([value, l]) => ({ value, label: l.label }))

export function MessagesPage() {
  const [tab, setTab] = useState('messages')
  return (
    <div>
      <PageHeader title="Mensagens" subtitle="Histórico de disparos WhatsApp e templates. Somente leitura." />
      <Tabs items={[{ key: 'messages', label: 'Mensagens' }, { key: 'templates', label: 'Templates' }]} active={tab} onChange={setTab} />
      {tab === 'messages' ? <MessageList /> : <TemplateList />}
    </div>
  )
}

function MessageList() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['messages', search, status, page],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search) qs.set('search', search)
      if (status) qs.set('status', status)
      return apiGet<ListResponse<MessageListItem>>(`messages?${qs}`, signal)
    },
    placeholderData: keepPreviousData,
  })

  const columns: DataTableColumn<MessageListItem>[] = [
    { key: 'createdAt', label: 'Criada em', render: (r) => formatDateTime(r.createdAt), hideOnMobile: true },
    { key: 'customer', label: 'Cliente', render: (r) => r.customer ?? r.phone ?? '—' },
    { key: 'template', label: 'Template', render: (r) => r.template ?? '—', hideOnMobile: true },
    { key: 'status', label: 'Status', render: (r) => <CodeBadge code={r.status} map={MESSAGE_STATUS} /> },
    { key: 'reason', label: 'Motivo', render: (r) => <CodeBadge code={r.failureCategory} map={FAILURE_CATEGORY} />, hideOnMobile: true },
    { key: 'attempts', label: 'Tentativas', render: (r) => r.attempts, hideOnMobile: true },
  ]

  return (
    <>
      <FilterBar
        placeholder="Buscar por cliente, telefone ou template"
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
      >
        <SelectFilter
          label="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
        />
      </FilterBar>
      <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhuma mensagem encontrada." fallbackError="Falha de rede ao consultar /crm-api/messages.">
        {(d) => (
          <>
            <DataTable columns={columns} rows={d.data} rowKey={(r) => r.id} onRowClick={(r) => setSelected(r.id)} />
            <Pagination pagination={d.pagination} onPage={setPage} noun="mensagens" />
          </>
        )}
      </QueryView>
      <Drawer open={selected !== null} title="Detalhe da mensagem" onClose={() => setSelected(null)}>
        {selected && <MessageDetailView id={selected} />}
      </Drawer>
    </>
  )
}

function MessageDetailView({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['message', id], queryFn: ({ signal }) => apiGet<MessageDetail>(`messages/${id}`, signal) })
  return (
    <QueryView query={query} emptyTitle="" fallbackError="Falha ao carregar a mensagem.">
      {(m) => (
        <dl>
          <Field label="Cliente">{m.customer?.name ?? m.phone ?? '—'}</Field>
          <Field label="Template">{m.templateName ?? '—'}</Field>
          <Field label="Status">
            <CodeBadge code={m.status} map={MESSAGE_STATUS} />
          </Field>
          <Field label="Motivo">
            <CodeBadge code={m.failureCategory} map={FAILURE_CATEGORY} />
          </Field>
          <Field label="Motivo técnico">
            {m.reason ?? '—'}
            {m.errorCode ? ` · ${m.errorCode}` : ''}
          </Field>
          <Field label="Origem">
            {m.source ?? '—'} · {m.entityType}
          </Field>
          <Field label="Tentativas">{m.retryCount + 1}</Field>
          <h3 className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-ink-faint">Linha do tempo</h3>
          {m.timeline.map((t) => (
            <Field key={t.stage} label={t.stage}>
              {formatDateTime(t.at)}
            </Field>
          ))}
        </dl>
      )}
    </QueryView>
  )
}

function TemplateList() {
  const query = useQuery({ queryKey: ['templates'], queryFn: ({ signal }) => apiGet<{ data: TemplateItem[] }>('templates', signal) })
  const columns: DataTableColumn<TemplateItem>[] = [
    { key: 'name', label: 'Template', render: (t) => <span title={t.metaTemplateName}>{t.name}</span> },
    { key: 'event', label: 'Evento', render: (t) => t.eventType, hideOnMobile: true },
    { key: 'active', label: 'Status no CRM', render: (t) => (t.active ? 'Ativo' : 'Inativo') },
    { key: 'usage', label: 'Volume histórico', render: (t) => t.usageCount.toLocaleString('pt-BR') },
    { key: 'last', label: 'Último uso', render: (t) => formatDateTime(t.lastUsedAt), hideOnMobile: true },
    // A API nao consulta a Meta: nunca inferir aprovacao.
    {
      key: 'meta',
      label: 'Status Meta',
      render: (t) => (
        <span title={t.metaStatus} className="text-ink-faint">
          {t.metaStatus === 'NOT_AVAILABLE' ? 'Não disponível pela API' : t.metaStatus}
        </span>
      ),
      hideOnMobile: true,
    },
  ]
  return (
    <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhum template cadastrado." fallbackError="Falha de rede ao consultar /crm-api/templates.">
      {(d) => <DataTable columns={columns} rows={d.data} rowKey={(t) => t.id} />}
    </QueryView>
  )
}
