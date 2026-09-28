import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ArrowLeft, Clock, Lock, MessageSquareDashed, UserRound } from 'lucide-react'
import { PageHeader } from '../../components/shell/PageHeader'
import { Pagination } from '../../components/data/Pagination'
import { FilterBar } from '../../components/data/FilterBar'
import { QueryView } from '../../components/data/QueryView'
import { Field } from '../../components/data/Field'
import { EmptyState } from '../../components/feedback/EmptyState'
import { StatusBadge, type StatusTone } from '../../components/feedback/StatusBadge'
import { apiGet } from '../../lib/api'
import { formatDateTime } from '../../lib/labels'
import type { ListResponse, ConversationListItem, ConversationDetail } from '../../lib/types'

const PAGE_SIZE = 25

const CONVERSATION_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: 'Aberta', tone: 'info' },
  pending: { label: 'Pendente', tone: 'warning' },
  closed: { label: 'Encerrada', tone: 'neutral' },
  resolved: { label: 'Resolvida', tone: 'success' },
}
const statusOf = (s: string) => CONVERSATION_STATUS[s] ?? { label: s, tone: 'neutral' as const }

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

// Inbox operacional somente leitura: não existe caixa de envio nesta tela.
// Telefone já chega mascarado do backend.
export function ConversationsPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['conversations', search, page],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search) qs.set('search', search)
      return apiGet<ListResponse<ConversationListItem>>(`conversations?${qs}`, signal)
    },
    placeholderData: keepPreviousData,
  })

  return (
    <div>
      <PageHeader
        title="Conversas"
        subtitle="Inbox operacional das conversas WhatsApp espelhadas."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-ink-muted" style={{ borderColor: 'var(--border-default)' }}>
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Somente leitura — respostas não são enviadas por esta tela.
          </span>
        }
      />
      <FilterBar
        placeholder="Buscar por contato ou telefone"
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className={selected ? 'hidden lg:block' : ''}>
          <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhuma conversa encontrada." fallbackError="Falha de rede ao consultar /crm-api/conversations.">
            {(d) => (
              <>
                <ul className="panel enter divide-y divide-white/5 overflow-hidden lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto" aria-label="Conversas">
                  {d.data.map((c) => {
                    const active = selected === c.id
                    const st = statusOf(c.status)
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(c.id)}
                          aria-current={active ? 'true' : undefined}
                          className={`relative flex w-full gap-3 px-4 py-3 text-left transition-colors ${active ? 'bg-accent/[0.08]' : 'hover:bg-white/[0.03]'}`}
                        >
                          {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" aria-hidden="true" />}
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-ink-muted">{initials(c.contact)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2 text-sm">
                              <span className="truncate font-medium text-ink">{c.contact ?? c.phone ?? 'Contato sem nome'}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{formatDateTime(c.lastMessageAt)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-ink-muted">{c.preview ?? '—'}</span>
                            <span className="mt-1.5 block">
                              <StatusBadge label={st.label} tone={st.tone} />
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <Pagination pagination={d.pagination} onPage={setPage} noun="conversas" />
              </>
            )}
          </QueryView>
        </div>
        {selected ? (
          <div className="min-w-0">
            <button type="button" onClick={() => setSelected(null)} className="btn mb-3 lg:hidden">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Voltar à lista
            </button>
            <ConversationThread id={selected} />
          </div>
        ) : (
          <div className="hidden lg:block">
            <EmptyState icon={MessageSquareDashed} title="Selecione uma conversa" description="O histórico, o status e o contexto da conversa aparecem aqui." />
          </div>
        )}
      </div>
    </div>
  )
}

function ConversationThread({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['conversation', id], queryFn: ({ signal }) => apiGet<ConversationDetail>(`conversations/${id}`, signal) })
  return (
    <QueryView query={query} isEmpty={(d) => d.messages.length === 0} emptyTitle="Conversa sem mensagens." fallbackError="Falha ao carregar a conversa.">
      {(c) => {
        const st = statusOf(c.status)
        const inbound = c.messages.filter((m) => m.direction === 'inbound').length
        return (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
            <section className="panel enter flex min-w-0 flex-col overflow-hidden" aria-label="Histórico da conversa">
              <header className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{c.contact.name ?? 'Contato sem nome'}</p>
                  <p className="text-xs text-ink-faint">{c.contact.phone ?? '—'}</p>
                </div>
                <StatusBadge label={st.label} tone={st.tone} />
              </header>
              <ol className="space-y-2.5 overflow-y-auto px-4 py-4 lg:max-h-[calc(100vh-20rem)]" aria-label="Mensagens da conversa">
                {c.messages.map((m) => {
                  const isInbound = m.direction === 'inbound'
                  return (
                    <li key={m.id} className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm text-ink ${isInbound ? 'rounded-bl-md bg-white/[0.05]' : 'rounded-br-md'}`}
                        style={isInbound ? undefined : { background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.22), rgb(var(--c-accent) / 0.12))' }}
                      >
                        <p className="text-[11px] text-ink-faint">
                          {isInbound ? 'Cliente' : 'Loja'} · {formatDateTime(m.timestamp ?? m.createdAt)}
                          {m.status ? ` · ${m.status}` : ''}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{m.body ?? `[${m.type}]`}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
            <aside className="panel enter h-fit p-4" aria-label="Detalhes da conversa">
              <h3 className="t-section mb-2 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Contexto
              </h3>
              <dl>
                <Field label="Status">{st.label}</Field>
                <Field label="Última mensagem">{formatDateTime(c.lastMessageAt)}</Field>
                <Field label="Última do cliente">{formatDateTime(c.lastInboundAt)}</Field>
                <Field label="Mensagens">{c.messages.length}</Field>
                <Field label="Recebidas">{inbound}</Field>
              </dl>
            </aside>
          </div>
        )
      }}
    </QueryView>
  )
}
