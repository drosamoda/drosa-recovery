import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { ConversationsPage } from '../ConversationsPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { ConversationDetail, ConversationListItem, ListResponse } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})
const mockedApiGet = vi.mocked(apiGet)

const listResponse: ListResponse<ConversationListItem> = {
  data: [{ id: 'cv1', contact: 'Ana Teste', phone: '****1234', status: 'open', lastMessageAt: '2026-09-26T12:00:00Z', lastInboundAt: null, preview: 'Oi, tudo bem?' }],
  pagination: { page: 1, pageSize: 25, total: 1, pages: 1 },
}
const detail: ConversationDetail = {
  id: 'cv1', status: 'open', lastMessageAt: null, lastInboundAt: null,
  contact: { id: 'k1', phone: '****1234', name: 'Ana Teste' },
  messages: [
    { id: 'a', direction: 'inbound', type: 'text', body: 'Quero o vestido', status: null, timestamp: '2026-09-26T12:00:00Z', createdAt: '2026-09-26T12:00:00Z' },
    { id: 'b', direction: 'outbound', type: 'template', body: null, status: 'delivered', timestamp: null, createdAt: '2026-09-26T12:05:00Z' },
  ],
}

describe('ConversationsPage', () => {
  it('lista conversas e abre a thread somente leitura', async () => {
    mockedApiGet.mockImplementation((path: string) => Promise.resolve(path.startsWith('conversations/') ? detail : listResponse) as never)
    renderWithProviders(<ConversationsPage />)
    await userEvent.click(await screen.findByText('Oi, tudo bem?'))
    expect(await screen.findByText('Quero o vestido')).toBeInTheDocument()
    expect(screen.getByText('[template]')).toBeInTheDocument()
    expect(screen.getByText(/Cliente ·/)).toBeInTheDocument()
    expect(screen.getByText(/Loja ·.*delivered/)).toBeInTheDocument()
    // nenhuma caixa de envio
    expect(screen.queryByRole('textbox', { name: /mensagem/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enviar/i })).not.toBeInTheDocument()
  })

  it('mostra vazio', async () => {
    mockedApiGet.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, pages: 0 } })
    renderWithProviders(<ConversationsPage />)
    expect(await screen.findByText('Nenhuma conversa encontrada.')).toBeInTheDocument()
  })

  it('mostra erro 403', async () => {
    mockedApiGet.mockRejectedValue(new ApiError('Acesso negado.', 403))
    renderWithProviders(<ConversationsPage />)
    expect(await screen.findByText('Acesso negado.')).toBeInTheDocument()
  })
})
