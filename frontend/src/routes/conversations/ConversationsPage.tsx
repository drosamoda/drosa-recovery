import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { Pagination } from '../../components/data/Pagination'
import { FilterBar } from '../../components/data/FilterBar'
import { QueryView } from '../../components/data/QueryView'
import { Notice } from '../../components/feedback/Notice'
import { apiGet } from '../../lib/api'
import { formatDateTime } from '../../lib/labels'
import type { ListResponse, ConversationListItem, ConversationDetail } from '../../lib/types'

const PAGE_SIZE = 25

// Somente leitura: nao existe caixa de envio nesta tela. Telefone ja chega
// mascarado do backend.
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
      <PageHeader title="Conversas" subtitle="Conversas WhatsApp espelhadas. Somente leitura." />
      <Notice>Visualização somente leitura — respostas não são enviadas por esta tela.</Notice>
      <FilterBar
        placeholder="Buscar por contato ou telefone"
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className={selected ? 'hidden lg:block' : ''}>
          <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhuma conversa encontrada." fallbackError="Falha de rede ao consultar /crm-api/conversations.">
            {(d) => (
              <>
                <ul className="divide-y divide-ink-faint/10 rounded-card border border-ink-faint/15 bg-surface-raised">
                  {d.data.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(c.id)}
                        className={`w-full px-4 py-3 text-left hover:bg-surface-sunken ${selected === c.id ? 'bg-surface-sunken' : ''}`}
                      >
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="font-medium text-ink">{c.contact ?? c.phone ?? 'Contato sem nome'}</span>
                          <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(c.lastMessageAt)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">{c.preview ?? '—'}</p>
                      </button>
                    </li>
                  ))}
                </ul>
                <Pagination pagination={d.pagination} onPage={setPage} noun="conversas" />
              </>
            )}
          </QueryView>
        </div>
        {selected && (
          <div>
            <button type="button" onClick={() => setSelected(null)} className="mb-2 text-sm text-bordo lg:hidden">
              ← Voltar à lista
            </button>
            <ConversationThread id={selected} />
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
      {(c) => (
        <div className="rounded-card border border-ink-faint/15 bg-surface-raised p-4">
          <p className="mb-3 text-sm font-medium text-ink">
            {c.contact.name ?? 'Contato sem nome'} <span className="text-ink-faint">· {c.contact.phone ?? '—'}</span>
          </p>
          <ol className="space-y-2" aria-label="Mensagens da conversa">
            {c.messages.map((m) => {
              const inbound = m.direction === 'inbound'
              return (
                <li key={m.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${inbound ? 'bg-surface-sunken' : 'bg-bordo/10'} text-ink`}>
                    <p className="text-[11px] text-ink-faint">
                      {inbound ? 'Cliente' : 'Loja'} · {formatDateTime(m.timestamp ?? m.createdAt)}
                      {m.status ? ` · ${m.status}` : ''}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{m.body ?? `[${m.type}]`}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </QueryView>
  )
}
