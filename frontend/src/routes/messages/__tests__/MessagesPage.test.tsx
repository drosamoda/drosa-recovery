import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { MessagesPage } from '../MessagesPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { ListResponse, MessageListItem, MessageDetail, TemplateItem } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})
const mockedApiGet = vi.mocked(apiGet)

function msg(over: Partial<MessageListItem> = {}): MessageListItem {
  return { id: 'm1', createdAt: '2026-09-26T12:00:00Z', customer: 'Ana Teste', phone: '****1234', source: 'recovery', entityType: 'abandoned_checkout', entityId: 'x', template: 'carrinho_v1', status: 'delivered', attempts: 1, conversion: null, failureCategory: null, ...over }
}
function list(rows: MessageListItem[], total = rows.length): ListResponse<MessageListItem> {
  return { data: rows, pagination: { page: 1, pageSize: 25, total, pages: Math.max(1, Math.ceil(total / 25)) } }
}
const detail: MessageDetail = {
  id: 'm2', customer: { id: 'c1', name: 'Bia' }, phone: '****9999', source: 'recovery', entityType: 'abandoned_checkout', entityId: 'x', templateName: 'carrinho_v1', templateLanguage: 'pt_BR', status: 'skipped', scheduledAt: null, acceptedAt: null, sentAt: null, deliveredAt: null, readAt: null, retryCount: 0, nextRetryAt: null, reason: 'consent_unproven', errorCode: null, failureCategory: 'CONSENT_BLOCK', mirrorStatus: null, timeline: [{ stage: 'created', at: '2026-09-26T12:00:00Z' }],
}

describe('MessagesPage', () => {
  it('lista mensagens com vocabulário correto de status e motivo', async () => {
    mockedApiGet.mockResolvedValue(list([msg(), msg({ id: 'm2', status: 'skipped', failureCategory: 'CONSENT_BLOCK' }), msg({ id: 'm3', status: 'sent' })]))
    renderWithProviders(<MessagesPage />)
    // os rotulos tambem existem nas <option> do filtro: afirmar dentro da tabela
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Entregue')).toBeInTheDocument()
    expect(within(table).getByText('Não disparada · bloqueada')).toBeInTheDocument()
    expect(within(table).getByText('Disparada · aguardando entrega')).toBeInTheDocument()
    // valor tecnico preservado no tooltip
    expect(within(table).getByText('Sem consentimento').closest('[title]')).toHaveAttribute('title', 'CONSENT_BLOCK')
    expect(screen.queryByText(/Enviada/)).not.toBeInTheDocument()
  })

  it('motivo desconhecido cai no valor humanizado, sem inventar rótulo', async () => {
    mockedApiGet.mockResolvedValue(list([msg({ status: 'failed', failureCategory: 'NEW_BACKEND_CODE' })]))
    renderWithProviders(<MessagesPage />)
    const table = await screen.findByRole('table')
    expect(within(table).getByText('New backend code')).toBeInTheDocument()
  })

  it('aplica filtro de status e busca na query', async () => {
    mockedApiGet.mockResolvedValue(list([msg()]))
    renderWithProviders(<MessagesPage />)
    await screen.findByRole('table')
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'skipped')
    await waitFor(() => expect(mockedApiGet).toHaveBeenLastCalledWith(expect.stringContaining('status=skipped'), expect.anything()))
    await userEvent.type(screen.getByLabelText(/Buscar por cliente/), 'ana{Enter}')
    await waitFor(() => expect(mockedApiGet).toHaveBeenLastCalledWith(expect.stringMatching(/search=ana.*|status=skipped.*search=ana/), expect.anything()))
  })

  it('pagina para a próxima página', async () => {
    mockedApiGet.mockResolvedValue(list([msg()], 60))
    renderWithProviders(<MessagesPage />)
    expect(await screen.findByText(/página 1 de 3/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() => expect(mockedApiGet).toHaveBeenLastCalledWith(expect.stringContaining('page=2'), expect.anything()))
  })

  it('abre o detalhe com motivo técnico cru', async () => {
    mockedApiGet.mockImplementation((path: string) => Promise.resolve(path.startsWith('messages/') ? detail : list([msg({ id: 'm2', customer: 'Bia' })])) as never)
    renderWithProviders(<MessagesPage />)
    await userEvent.click(await screen.findByText('Bia'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('consent_unproven')).toBeInTheDocument()
    expect(within(dialog).getByText('Sem consentimento')).toBeInTheDocument()
  })

  it('mostra estado vazio', async () => {
    mockedApiGet.mockResolvedValue(list([]))
    renderWithProviders(<MessagesPage />)
    expect(await screen.findByText('Nenhuma mensagem encontrada.')).toBeInTheDocument()
  })

  it('mostra erro 401/403 do backend', async () => {
    mockedApiGet.mockRejectedValue(new ApiError('Segredo de leitura invalido ou ausente.', 401))
    renderWithProviders(<MessagesPage />)
    expect(await screen.findByText('Segredo de leitura invalido ou ausente.')).toBeInTheDocument()
  })

  it('mostra erro de payload inválido', async () => {
    mockedApiGet.mockRejectedValue(new ApiError('Resposta invalida do servidor.', 200))
    renderWithProviders(<MessagesPage />)
    expect(await screen.findByText('Resposta invalida do servidor.')).toBeInTheDocument()
  })

  it('templates: volume, último uso e status Meta não inferido', async () => {
    const t: TemplateItem = { id: 't1', name: 'Carrinho', eventType: 'abandoned_checkout', metaTemplateName: 'carrinho_v1', languageCode: 'pt_BR', category: 'MARKETING', messagePreview: null, active: true, usageCount: 1234, lastUsedAt: '2026-09-20T10:00:00Z', metaStatus: 'NOT_AVAILABLE' }
    mockedApiGet.mockImplementation((path: string) => Promise.resolve(path === 'templates' ? { data: [t] } : list([])) as never)
    renderWithProviders(<MessagesPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Templates' }))
    expect(await screen.findByText('Carrinho')).toBeInTheDocument()
    expect(screen.getByText('1.234')).toBeInTheDocument()
    expect(screen.getByText('Não disponível pela API')).toBeInTheDocument()
    expect(screen.queryByText(/Aprovado/i)).not.toBeInTheDocument()
  })
})
