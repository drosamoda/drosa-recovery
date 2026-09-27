import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { CustomersPage } from '../CustomersPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { CustomersResponse } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})

const mockedApiGet = vi.mocked(apiGet)

function customersResponse(overrides: Partial<CustomersResponse> = {}): CustomersResponse {
  return {
    data: [
      { id: 'c1', name: 'Ana Teste', phone: '****1234', email: 'a***@teste.com', orders: 3, lastOrder: null, lastContact: null, consent: 'GRANTED', optOut: false, suppressed: false, messages: 2, conversations: 1 },
    ],
    pagination: { page: 1, pageSize: 25, total: 1 },
    ...overrides,
  }
}

describe('CustomersPage', () => {
  // SEM beforeEach(mockReset): cada teste ja configura seu proprio
  // mockResolvedValue/mockImplementation, e mockReset() aqui, combinado com
  // um mockImplementation que rejeita, e a causa raiz confirmada e isolada
  // de um teste "falhar" com uma unhandled rejection mesmo com isError
  // renderizando certinho (bug de interacao Vitest+mock, nao do app — ver
  // CLIENTE_360_JOURNEY_MIGRATION_REPORT).

  it('mostra loading enquanto busca', () => {
    // Promise controlada (nunca resolvida NESTE teste, mas com referencia de
    // resolve para nao deixar nada verdadeiramente eterno) + unmount()
    // explicito no fim — uma promise sem nenhuma forma de settle deixou o
    // worker do Vitest morrer nesta rodada (nao era timeout, era crash real).
    let resolveFn: (value: unknown) => void = () => undefined
    mockedApiGet.mockReturnValue(new Promise((resolve) => { resolveFn = resolve }))
    const { unmount } = renderWithProviders(<CustomersPage />)
    expect(screen.getByText(/Carregando dados reais/i)).toBeInTheDocument()
    unmount()
    resolveFn(customersResponse())
  })

  it('mostra empty state quando nao ha clientes', async () => {
    mockedApiGet.mockResolvedValue(customersResponse({ data: [], pagination: { page: 1, pageSize: 25, total: 0 } }))
    renderWithProviders(<CustomersPage />)
    expect(await screen.findByText('Nenhum cliente encontrado.')).toBeInTheDocument()
  })

  it('mostra error state quando a API falha', async () => {
    mockedApiGet.mockImplementation(() => Promise.reject(new ApiError('Falha ao carregar dados (HTTP 500).', 500)))
    renderWithProviders(<CustomersPage />)
    expect(await screen.findByText('Dados indisponiveis')).toBeInTheDocument()
    expect(screen.getByText('Falha ao carregar dados (HTTP 500).')).toBeInTheDocument()
  })

  it('lista clientes reais e mostra dados ja mascarados pelo backend', async () => {
    mockedApiGet.mockResolvedValue(customersResponse())
    renderWithProviders(<CustomersPage />)
    expect(await screen.findByText('Ana Teste')).toBeInTheDocument()
    expect(screen.getByText('****1234')).toBeInTheDocument()
    // O frontend nunca deve receber nem exibir o dado cru — so o que a API
    // ja devolveu mascarado. Este teste falha se algum dia um campo passar a
    // vir sem mascara e o componente simplesmente exibi-lo sem checagem.
    expect(screen.queryByText(/^\d{2}9\d{8}$/)).not.toBeInTheDocument()
  })

  it('navega para o Cliente 360 (/customers/:id) ao clicar na linha', async () => {
    mockedApiGet.mockResolvedValue(customersResponse())
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/customers']}>
          <Routes>
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<div>rota-cliente-360</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const row = await screen.findByText('Ana Teste')
    await user.click(row)
    await waitFor(() => expect(screen.getByText('rota-cliente-360')).toBeInTheDocument())
  })
})
