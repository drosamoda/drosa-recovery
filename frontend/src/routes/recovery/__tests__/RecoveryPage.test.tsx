import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { RecoveryPage } from '../RecoveryPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { CheckoutItem, ListResponse, PaymentItem, RemarketingResponse } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})
const mockedApiGet = vi.mocked(apiGet)

function co(over: Partial<CheckoutItem>): CheckoutItem {
  return { id: Math.random().toString(36), checkout: '1', customer: 'Ana', phone: '****1', products: null, total: '199.90', currency: 'BRL', date: '2026-09-26T10:00:00Z', status: 'abandoned', eligible: false, blockers: ['consent_unproven'], message: null, convertedAt: null, convertedOrderId: null, ...over }
}
function page<T>(data: T[], total = data.length): ListResponse<T> {
  return { data, pagination: { page: 1, pageSize: 50, total, pages: 1 } }
}

const checkouts = page(
  [
    co({ eligible: true, blockers: [], message: { id: 'm1', template: 't', status: 'read' }, convertedOrderId: 'o1' }),
    co({ eligible: true, blockers: [], message: { id: 'm2', template: 't', status: 'sent' } }),
    co({ blockers: ['consent_unproven', 'order_after_checkout'] }),
    co({ blockers: ['consent_unproven'] }),
  ],
  400,
)

describe('RecoveryPage', () => {
  it('funil subordinado sobre a amostra, compra posterior separada e motivos agregados', async () => {
    mockedApiGet.mockResolvedValue(checkouts)
    renderWithProviders(<RecoveryPage />)
    expect(await screen.findByText(/Amostra da página atual — 4 registros \(de 400/)).toBeInTheDocument()
    const funnel = screen.getByText('Avaliados').closest('ol') as HTMLElement
    const stage = (label: string) => within(funnel).getByText(label).parentElement as HTMLElement
    expect(within(stage('Avaliados')).getByText('4')).toBeInTheDocument()
    expect(within(stage('Elegíveis')).getByText('2')).toBeInTheDocument()
    expect(within(stage('Disparados')).getByText('2')).toBeInTheDocument()
    expect(within(stage('Entregues')).getByText('1')).toBeInTheDocument()
    expect(within(stage('Lidos')).getByText('1')).toBeInTheDocument()
    // compra posterior NAO e etapa do funil
    expect(within(funnel).queryByText(/Pedido|Compra|Convers/)).not.toBeInTheDocument()
    expect(screen.getByText('Pedidos com contato registrado')).toBeInTheDocument()
    expect(screen.queryByText(/após contato/)).not.toBeInTheDocument()
    expect(screen.queryByText(/recuperad|ROI|convers[aã]o/i)).not.toBeInTheDocument()
    // motivo agregado com rotulo amigavel e contagem real (2x consent_unproven)
    const reason = screen.getAllByTitle('consent_unproven')[0]
    expect(reason).toHaveTextContent('Consentimento não comprovado')
    expect(reason.parentElement).toHaveTextContent('2')
  })

  it('dado fora de ordem aparece como veio (disparado sem elegível), sem ajuste', async () => {
    // dado fora de ordem proposital: mais disparados do que elegíveis
    mockedApiGet.mockResolvedValue(page([co({ eligible: false, message: { id: 'x', template: 't', status: 'delivered' } })]))
    renderWithProviders(<RecoveryPage />)
    await screen.findByText(/Amostra da página atual/)
    expect(screen.getAllByText('100.0% de avaliados').length).toBeGreaterThan(0)
  })

  it('aba PIX mostra status de pagamento e motivo do backend', async () => {
    const pix: PaymentItem = { id: 'p1', order: '1001', customer: 'Bia', phone: null, total: '50', date: null, paymentStatus: 'pending', orderStatus: 'open', template: 'pix', messageStatus: 'skipped', error: { category: 'CONSENT_BLOCK', reason: 'consent_unproven', errorCode: null, retries: 0 } }
    mockedApiGet.mockImplementation((path: string) => Promise.resolve(path.startsWith('payments/pix') ? page([pix]) : checkouts) as never)
    renderWithProviders(<RecoveryPage />)
    await userEvent.click(screen.getByRole('button', { name: 'PIX' }))
    expect(await screen.findByText('1001')).toBeInTheDocument()
    expect(screen.getByText('Não disparada · bloqueada')).toBeInTheDocument()
    expect(screen.getByTitle('CONSENT_BLOCK')).toHaveTextContent('Sem consentimento')
  })

  it('remarketing: flags semânticas (false não vira erro) e destinatários com motivo', async () => {
    const rm: RemarketingResponse = {
      data: [{ id: 'r1', segment: 'winback', mode: 'dry_run', status: 'completed', candidateCount: 10, eligibleCount: 3, sentCount: 0, skippedCount: 7, failedCount: 0, startedAt: '2026-09-20T10:00:00Z', completedAt: null, recipients: [{ id: 'x', entityType: 'customer', templateName: 'volta', status: 'suppressed', reason: null, eligibilitySnapshot: { reasons: ['outside_window'] }, createdAt: '2026-09-20T10:00:00Z' }] }],
      pagination: { page: 1, pageSize: 20, total: 1, pages: 1 },
      runtime: { enabled: false, automationSendEnabled: false, dryRun: true },
    }
    mockedApiGet.mockImplementation((path: string) => Promise.resolve(path.startsWith('remarketing') ? rm : checkouts) as never)
    renderWithProviders(<RecoveryPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Remarketing' }))
    expect(await screen.findByText('Remarketing desabilitado')).toBeInTheDocument()
    expect(screen.getByText('Dry-run WhatsApp habilitado')).toBeInTheDocument()
    expect(document.querySelector('.text-status-danger')).toBeNull()
    await userEvent.click(screen.getByText('winback'))
    expect(await screen.findByText('Fora da janela')).toBeInTheDocument()
    expect(screen.getByText('Não disparado · bloqueado')).toBeInTheDocument()
  })

  it('erro e vazio', async () => {
    mockedApiGet.mockRejectedValue(new ApiError('Falha X', 500))
    const { unmount } = renderWithProviders(<RecoveryPage />)
    expect(await screen.findByText('Falha X')).toBeInTheDocument()
    unmount()
    mockedApiGet.mockResolvedValue(page([]))
    renderWithProviders(<RecoveryPage />)
    expect(await screen.findByText('Nenhum carrinho encontrado.')).toBeInTheDocument()
  })
})
