import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { BiPage } from '../BiPage'
import { apiGet, ApiError } from '../../../lib/api'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})
const mockedApiGet = vi.mocked(apiGet)

const datasets: Record<string, unknown[]> = {
  systemPulse: [{ last_order_at: '2026-09-27 13:00:00', last_webhook_nuvemshop_at: null, last_webhook_meta_at: null, pending_messages: 0, processing_messages: 0, delivery_unknown_messages: 2 }],
  messageDaily: [
    { day: '2026-09-26', status: 'skipped', count: 900 },
    { day: '2026-09-26', status: 'sent', count: 10 },
    { day: '2026-09-26', status: 'delivered', count: 60 },
    { day: '2026-09-26', status: 'read', count: 30 },
  ],
  abandonedCartDaily: [{ day: '2026-09-26', total_abandoned: 100, with_phone: 90, with_consent: 3, eligible: 1, message_sent: 20, message_delivered: 15, message_read: 5, with_linked_order: 12 }],
  ordersConsentDaily: [{ day: '2026-09-26', total_orders: 10, transactional_granted: 7, marketing_granted: 2, eligible_for_message: 1 }],
  consentCurrent: [{ scope: 'marketing', status: 'GRANTED', count: 1 }],
  webhookDaily: [{ provider: 'nuvemshop', topic: 'order/paid', events: 200, processed: 190, invalid_hmac: 0, errors: 10, last_day: '2026-09-27' }],
}

function route(embed: 'unconfigured' | 'ok'): (path: string) => Promise<unknown> {
  return (path: string) => {
    const m = path.match(/^bi\/data\/(\w+)\?days=(\d+)$/)
    if (m) return Promise.resolve({ data: datasets[m[1]] ?? [], days: Number(m[2]) })
    if (path.startsWith('bi/embed/')) {
      return embed === 'ok' ? Promise.resolve({ url: 'https://metabase.example.test/embed/dashboard/tok#x', expiresAt: '' }) : Promise.reject(new ApiError('Metabase não configurado neste ambiente.', 503, 'METABASE_NOT_CONFIGURED'))
    }
    return Promise.reject(new ApiError('unexpected ' + path, 500))
  }
}

describe('BiPage', () => {
  it('visão executiva: vocabulário aprovado, entrega sobre Disparadas, sem "Enviadas"', async () => {
    mockedApiGet.mockImplementation(route('unconfigured') as never)
    renderWithProviders(<BiPage />)
    expect(await screen.findByText('Avaliadas')).toBeInTheDocument()
    expect(screen.getByText('Disparadas').parentElement).toHaveTextContent('100')
    expect(screen.getByText('Entregues').parentElement).toHaveTextContent('90.0% das disparadas')
    expect(screen.getByText('Bloqueadas').parentElement).toHaveTextContent('900')
    expect(screen.queryByText(/Enviadas/)).not.toBeInTheDocument()
  })

  it('Metabase não configurado vira aviso neutro e os indicadores nativos seguem na tela', async () => {
    mockedApiGet.mockImplementation(route('unconfigured') as never)
    renderWithProviders(<BiPage />)
    expect(await screen.findByText(/METABASE_NOT_CONFIGURED/)).toBeInTheDocument()
    expect(screen.queryByText('Dados indisponiveis')).not.toBeInTheDocument()
  })

  it('embed pede só o módulo da allowlist (nunca um dashboard ID) e renderiza iframe', async () => {
    mockedApiGet.mockImplementation(route('ok') as never)
    renderWithProviders(<BiPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Recovery' }))
    expect(await screen.findByTitle('Metabase — Carrinho abandonado')).toHaveAttribute('src', expect.stringContaining('/embed/dashboard/'))
    const embedCalls = mockedApiGet.mock.calls.map((c) => c[0]).filter((p) => p.startsWith('bi/embed/'))
    expect(embedCalls).toEqual(expect.arrayContaining(['bi/embed/recovery']))
    expect(embedCalls.every((p) => /^bi\/embed\/(executive|recovery|messages|consents|orders|integrations)$/.test(p))).toBe(true)
  })

  it('recovery: dois grupos subordinados + pedido vinculado com DATA_QUALITY_WARNING', async () => {
    mockedApiGet.mockImplementation(route('unconfigured') as never)
    renderWithProviders(<BiPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Recovery' }))
    expect(await screen.findByText('Com consentimento marketing')).toBeInTheDocument()
    expect(screen.getByText('Carrinhos com pedido vinculado').parentElement).toHaveTextContent('12')
    expect(screen.getByText('purchased_after_contact')).toBeInTheDocument()
    expect(screen.getByText(/não exige contato nem ordem temporal/)).toBeInTheDocument()
    expect(screen.queryByText(/recuperad|convers[aã]o de|após contato/i)).toBeNull()
    const contact = screen.getByText('Disparados').closest('ol') as HTMLElement
    expect(within(contact).getByText('75.0% de disparados')).toBeInTheDocument()
  })

  it('consentimentos: transacional e marketing em paralelo sobre o total de pedidos', async () => {
    mockedApiGet.mockImplementation(route('unconfigured') as never)
    renderWithProviders(<BiPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Consentimentos' }))
    expect((await screen.findByText('Com consentimento transacional')).parentElement).toHaveTextContent('70.0% dos pedidos')
    expect(screen.getByText('Com consentimento marketing').parentElement).toHaveTextContent('20.0% dos pedidos')
  })

  it('integrações: agregado completo do período com taxa sobre eventos', async () => {
    mockedApiGet.mockImplementation(route('unconfigured') as never)
    renderWithProviders(<BiPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Integrações' }))
    const row = (await screen.findByText('order/paid')).closest('tr') as HTMLElement
    expect(within(row).getByText('5.0%')).toBeInTheDocument()
  })

  it('período muda o parâmetro days', async () => {
    mockedApiGet.mockImplementation(route('unconfigured') as never)
    renderWithProviders(<BiPage />)
    await screen.findByText('Avaliadas')
    await userEvent.click(screen.getByRole('radio', { name: 'Últimos 90 dias' }))
    expect(await screen.findByText('Mensagens — últimos 90 dias')).toBeInTheDocument()
    expect(mockedApiGet.mock.calls.some((c) => c[0] === 'bi/data/messageDaily?days=90')).toBe(true)
  })

  it('erro de dataset aparece como erro, não como vazio', async () => {
    mockedApiGet.mockImplementation(((path: string) => (path.startsWith('bi/data/') ? Promise.reject(new ApiError('Falha ao consultar as views de BI.', 502, 'BI_QUERY_FAILED')) : route('unconfigured')(path))) as never)
    renderWithProviders(<BiPage />)
    expect((await screen.findAllByText('Falha ao consultar as views de BI.')).length).toBeGreaterThan(0)
  })
})
