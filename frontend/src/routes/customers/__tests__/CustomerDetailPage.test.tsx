import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { CustomerDetailPage } from '../CustomerDetailPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { CustomerDetail, JourneyDetail } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})

const mockedApiGet = vi.mocked(apiGet)

const customer: CustomerDetail = {
  id: 'c1',
  name: 'Ana Teste',
  phone: '****1234',
  email: 'a***@teste.com',
  optOut: false,
  suppression: null,
  consents: [{ scope: 'marketing', consented: true, source: 'nuvemshop', consentedAt: '2026-01-01T00:00:00Z', revokedAt: null }],
  orders: [{ id: 'o1', orderNumber: '1001', total: 199.9, paymentStatus: 'paid', paymentMethod: 'pix', status: 'confirmed', date: '2026-01-01T00:00:00Z' }],
  checkouts: [],
  messages: [],
  conversations: [],
}

const journey: JourneyDetail = {
  id: 'customer:c1',
  name: 'Ana Teste',
  phone: '****1234',
  email: 'a***@teste.com',
  lastAction: 'ORDER_CREATED',
  lastActionAt: '2026-01-01T00:00:00Z',
  actionSource: 'nuvemshop',
  related: '1001',
  lastMessage: null,
  lastInboundAt: null,
  consent: 'GRANTED',
  optOut: false,
  suppressed: false,
  messageCount: 0,
  orderCount: 1,
  checkoutCount: 0,
  flow: null,
  responded: false,
  timeline: [{ type: 'ORDER_CREATED', at: '2026-01-01T00:00:00Z', source: 'nuvemshop', reference: '1001', status: 'confirmed' }],
  messages: [],
}

describe('CustomerDetailPage', () => {
  // SEM beforeEach(mockReset) — ver nota em CustomersPage.test.tsx.

  it('carrega e mostra o resumo do Cliente 360', async () => {
    mockedApiGet.mockResolvedValue(customer)
    renderWithProviders(<CustomerDetailPage />, { route: '/customers/c1', path: '/customers/:id' })
    expect(await screen.findByText('Ana Teste')).toBeInTheDocument()
    expect(mockedApiGet).toHaveBeenCalledWith('customers/c1', expect.anything())
  })

  it('mostra error state quando o backend rejeita com 401', async () => {
    // mockImplementation (lazy), nao mockRejectedValue — ver nota em
    // CustomersPage.test.tsx (evita unhandled rejection que derrubou o
    // worker do Vitest nesta rodada).
    mockedApiGet.mockImplementation(() => Promise.reject(new ApiError('Segredo de leitura invalido ou ausente.', 401)))
    renderWithProviders(<CustomerDetailPage />, { route: '/customers/c1', path: '/customers/:id' })
    expect(await screen.findByText('Segredo de leitura invalido ou ausente.')).toBeInTheDocument()
  })

  it('aba Pedidos mostra o pedido real, aba Jornada busca /crm-api/journey/customer:<id>', async () => {
    mockedApiGet.mockImplementation((path: string) => (path.startsWith('journey/') ? Promise.resolve(journey) : Promise.resolve(customer)))
    const user = userEvent.setup()
    renderWithProviders(<CustomerDetailPage />, { route: '/customers/c1', path: '/customers/:id' })
    await screen.findByText('Ana Teste')

    await user.click(screen.getByRole('tab', { name: 'Pedidos' }))
    expect(await screen.findByText('Pedido 1001')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Jornada' }))
    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledWith(expect.stringContaining('journey/customer:c1'), expect.anything()))
    expect(await screen.findByText('Pedido criado')).toBeInTheDocument()
  })

  it('aba Consentimentos preserva a semantica de escopo e suppression, sem inferir nada', async () => {
    mockedApiGet.mockResolvedValue(customer)
    const user = userEvent.setup()
    renderWithProviders(<CustomerDetailPage />, { route: '/customers/c1', path: '/customers/:id' })
    await screen.findByText('Ana Teste')
    await user.click(screen.getByRole('tab', { name: 'Privacidade' }))
    // escopo aparece no header (consentimentos ativos) e na aba de privacidade
    expect((await screen.findAllByText('marketing')).length).toBeGreaterThan(1)
    expect(screen.getByText('Nenhuma suppression registrada para este contato.')).toBeInTheDocument()
  })
})
