import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { HealthPage } from '../HealthPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { AuditEvent, AuditResponse, HealthResponse, JobFreshnessEntry } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})
const mockedApiGet = vi.mocked(apiGet)

const freshJobs: JobFreshnessEntry[] = [
  { jobKey: 'process_messages', timing: 'fresh', lastResult: 'completed', healthy: true, lastStartedAt: '2026-09-28T11:59:00Z', ageMinutes: 1, thresholdMinutes: 3, errorCategory: null },
  { jobKey: 'sync_abandoned_checkouts', timing: 'fresh', lastResult: 'completed', healthy: true, lastStartedAt: '2026-09-28T11:40:00Z', ageMinutes: 20, thresholdMinutes: 45, errorCategory: null },
  { jobKey: 'sync_boleto_expiring', timing: 'fresh', lastResult: 'completed', healthy: true, lastStartedAt: '2026-09-28T11:00:00Z', ageMinutes: 60, thresholdMinutes: 120, errorCategory: null },
]

const health: HealthResponse = {
  meta: { configured: true, latestEvidence: { createdAt: '2026-09-27T12:57:00Z', processed: true, hmacValid: true, error: null } },
  nuvemshop: { configured: true, latestEvidence: { createdAt: '2026-09-27T13:00:00Z', processed: false, hmacValid: true, error: 'order not found' } },
  recoveryEngine: { pending: 0, processing: 0, failed: 3, unknown: 0, oldestPending: null },
  inboxMirror: { failed: 0, latestSuccess: null },
  jobFreshness: freshJobs,
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

  it('jobs: em dia quando fresh, mesmo com cron interno desligado (não é incidente sozinho)', async () => {
    mockedApiGet.mockResolvedValue(health)
    renderWithProviders(<HealthPage />)
    const card = (await screen.findByText('Jobs automáticos')).closest('article') as HTMLElement
    expect(within(card).getByText('Em dia')).toBeInTheDocument()
    expect(within(card).queryByText(/nunca rodou|atrasado/)).not.toBeInTheDocument()
  })

  it('jobs: um job atrasado ou que nunca rodou acende atenção, independente do cron interno', async () => {
    const stale: HealthResponse = {
      ...health,
      jobFreshness: [
        { jobKey: 'process_messages', timing: 'stale', lastResult: 'completed', healthy: false, lastStartedAt: '2026-09-23T02:57:00Z', ageMinutes: 7500, thresholdMinutes: 3, errorCategory: null },
        { jobKey: 'sync_abandoned_checkouts', timing: 'never_run', lastResult: null, healthy: false, lastStartedAt: null, ageMinutes: null, thresholdMinutes: 45, errorCategory: null },
        { jobKey: 'sync_boleto_expiring', timing: 'fresh', lastResult: 'completed', healthy: true, lastStartedAt: '2026-09-28T11:00:00Z', ageMinutes: 60, thresholdMinutes: 120, errorCategory: null },
      ],
    }
    mockedApiGet.mockResolvedValue(stale)
    renderWithProviders(<HealthPage />)
    const card = (await screen.findByText('Jobs automáticos')).closest('article') as HTMLElement
    expect(within(card).getByText('Com pendência')).toBeInTheDocument()
    expect(within(card).getByText(/Envio de mensagens atrasado/)).toBeInTheDocument()
    expect(within(card).getByText(/Carrinho abandonado nunca rodou/)).toBeInTheDocument()
  })

  it('jobs: fresh porém última execução falhou NÃO é "Em dia" e mostra só a categoria fechada', async () => {
    const failed: HealthResponse = {
      ...health,
      jobFreshness: [
        { jobKey: 'process_messages', timing: 'fresh', lastResult: 'failed', healthy: false, lastStartedAt: '2026-09-28T11:59:00Z', ageMinutes: 1, thresholdMinutes: 3, errorCategory: 'database_unreachable' },
        { jobKey: 'sync_abandoned_checkouts', timing: 'fresh', lastResult: 'completed', healthy: true, lastStartedAt: '2026-09-28T11:40:00Z', ageMinutes: 20, thresholdMinutes: 45, errorCategory: null },
        { jobKey: 'sync_boleto_expiring', timing: 'fresh', lastResult: 'completed', healthy: true, lastStartedAt: '2026-09-28T11:00:00Z', ageMinutes: 60, thresholdMinutes: 120, errorCategory: null },
      ],
    }
    mockedApiGet.mockResolvedValue(failed)
    renderWithProviders(<HealthPage />)
    const card = (await screen.findByText('Jobs automáticos')).closest('article') as HTMLElement
    expect(within(card).queryByText('Em dia')).not.toBeInTheDocument()
    expect(within(card).getByText('Com pendência')).toBeInTheDocument()
    expect(within(card).getByText(/Envio de mensagens última execução falhou \(banco inacessível\)/)).toBeInTheDocument()
  })

  it('jobs: telemetria indisponível (null) nunca é apresentada como "Em dia"', async () => {
    mockedApiGet.mockResolvedValue({ ...health, jobFreshness: null })
    renderWithProviders(<HealthPage />)
    const card = (await screen.findByText('Jobs automáticos')).closest('article') as HTMLElement
    expect(within(card).getByText('Telemetria indisponível')).toBeInTheDocument()
    expect(within(card).queryByText('Em dia')).not.toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('tab', { name: 'Webhooks' }))
    expect(await screen.findByText('Últimos 3 eventos')).toBeInTheDocument()
    expect(screen.getByText(/não são histórico global/)).toBeInTheDocument()
    const row = screen.getByText('order/paid').closest('tr') as HTMLElement
    expect(within(row).getByText('50.0%')).toBeInTheDocument()
  })

  it('auditoria: eventos paginados e aviso do log completo ausente', async () => {
    mockedApiGet.mockImplementation(((path: string) => Promise.resolve(path.startsWith('audit') ? audit : health)) as never)
    renderWithProviders(<HealthPage />)
    await userEvent.click(screen.getByRole('tab', { name: 'Auditoria' }))
    expect(await screen.findByText(/faltam: actor, before, after, reason/)).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('erro 401', async () => {
    mockedApiGet.mockRejectedValue(new ApiError('Segredo de leitura invalido ou ausente.', 401))
    renderWithProviders(<HealthPage />)
    expect(await screen.findByText('Segredo de leitura invalido ou ausente.')).toBeInTheDocument()
  })
})
