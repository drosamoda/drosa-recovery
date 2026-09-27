import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { HealthPage } from '../HealthPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { AuditEvent, AuditResponse, HealthResponse } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})
const mockedApiGet = vi.mocked(apiGet)

const health: HealthResponse = {
  meta: { configured: true, latestEvidence: { createdAt: '2026-09-27T12:57:00Z', processed: true, hmacValid: true, error: null } },
  nuvemshop: { configured: true, latestEvidence: { createdAt: '2026-09-27T13:00:00Z', processed: false, hmacValid: true, error: 'order not found' } },
  recoveryEngine: { pending: 0, processing: 0, failed: 3, unknown: 0, oldestPending: null },
  inboxMirror: { failed: 0, latestSuccess: null },
  runtime: { cron: false, automationSend: true, remarketing: undefined },
}
function ev(over: Partial<AuditEvent>): AuditEvent {
  return { id: Math.random().toString(36), provider: 'nuvemshop', topic: 'order/paid', externalId: null, hmacValid: true, processed: true, processedAt: null, error: null, createdAt: '2026-09-27T10:00:00Z', ...over }
}
const audit: AuditResponse = {
  data: [ev({}), ev({ error: 'boom', processed: false, createdAt: '2026-09-27T11:00:00Z' }), ev({ provider: 'meta', topic: null })],
  pagination: { page: 1, pageSize: 100, total: 3343, pages: 34 },
  fullAuditLog: { status: 'NOT_AVAILABLE', missing: ['actor', 'before', 'after', 'reason'] },
}

describe('HealthPage', () => {
  it('flags semânticas: cron false = "Cron desabilitado", ausente = estado desconhecido, nunca vermelho automático', async () => {
    mockedApiGet.mockResolvedValue(health)
    renderWithProviders(<HealthPage />)
    expect(await screen.findByText('Cron desabilitado')).toBeInTheDocument()
    expect(screen.getByText('Envio automático habilitado')).toBeInTheDocument()
    expect(screen.getByText('Remarketing: estado desconhecido')).toBeInTheDocument()
    expect(screen.getByText('Cron desabilitado').className).toContain('status-neutral')
  })

  it('card por integração com estado, evidência, problema, impacto e ação', async () => {
    mockedApiGet.mockResolvedValue(health)
    renderWithProviders(<HealthPage />)
    const nuvem = (await screen.findByText('Nuvemshop')).closest('article') as HTMLElement
    expect(within(nuvem).getByText('Com problema registrado')).toBeInTheDocument()
    expect(within(nuvem).getByText('order not found')).toBeInTheDocument()
    expect(within(nuvem).getByText(/Investigar o último evento/)).toBeInTheDocument()
    const meta = screen.getByText('Meta (WhatsApp)').closest('article') as HTMLElement
    expect(within(meta).getByText('Recebendo eventos')).toBeInTheDocument()
    expect(within(meta).getByText('Nenhum registrado')).toBeInTheDocument()
    expect(screen.getByText('3 falhas')).toBeInTheDocument()
  })

  it('webhooks: agrega a amostra por provider/tópico com taxa, rotulada como amostra', async () => {
    mockedApiGet.mockImplementation(((path: string) => Promise.resolve(path.startsWith('audit') ? audit : health)) as never)
    renderWithProviders(<HealthPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Webhooks' }))
    expect(await screen.findByText(/Amostra dos 3 eventos mais recentes de 3.343/)).toBeInTheDocument()
    const row = screen.getByText('order/paid').closest('tr') as HTMLElement
    expect(within(row).getByText('50.0%')).toBeInTheDocument()
  })

  it('auditoria: eventos paginados e aviso do log completo ausente', async () => {
    mockedApiGet.mockImplementation(((path: string) => Promise.resolve(path.startsWith('audit') ? audit : health)) as never)
    renderWithProviders(<HealthPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Auditoria' }))
    expect(await screen.findByText(/faltam: actor, before, after, reason/)).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('erro 401', async () => {
    mockedApiGet.mockRejectedValue(new ApiError('Segredo de leitura invalido ou ausente.', 401))
    renderWithProviders(<HealthPage />)
    expect(await screen.findByText('Segredo de leitura invalido ou ausente.')).toBeInTheDocument()
  })
})
