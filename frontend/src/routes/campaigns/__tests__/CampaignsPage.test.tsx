import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../lib/__tests__/test-utils'
import { CampaignsPage } from '../CampaignsPage'
import { apiGet, ApiError } from '../../../lib/api'
import type { AutomationRule, EmailAudiences, EmailLibrary, EmailRecommendations, Opportunity } from '../../../lib/types'

vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api')
  return { ...actual, apiGet: vi.fn() }
})
const mockedApiGet = vi.mocked(apiGet)

const opp: Opportunity = {
  id: 'o1', channel: 'whatsapp', type: 'PIX_PENDING', title: '9 pedidos com Pix pendente', reason: 'Pix aguardando', audienceCount: 9, eligibleCount: 0, blockedCount: 9,
  recommendedTiming: 'Horário comercial', recommendedChannel: 'whatsapp', confidence: 'medium', evidence: { topBlockers: [{ reason: 'consent_unproven', count: 9 }], template: '_pix_pendente' },
}
const library: EmailLibrary = { libraryVersion: 'v1', total: 33, ready: 19, needsData: 14, sendGate: { allowed: false, missing: ['EMAIL_SEND_DISABLED'] } }
const audiences: EmailAudiences = {
  generatedAt: '', consentSource: '', sendEligibility: '', suppression: { status: 'applied', excludedCount: 0 },
  base: { totalCustomers: 10, emailKnown: 9, emailValid: 8, emailInvalid: 1, buyers: 5 },
  segments: [{ segmentKey: 'vip', name: 'Clientes VIP', objective: '', status: '', audienceCount: 5, withValidEmailCount: 5, sendEligibleCount: null, blockedCount: 0, eligibilityStatus: 'eligible_verified', dataQuality: { level: '', notes: [] } }],
}
const recs: EmailRecommendations = { generatedAt: '', plan: [], summary: { total: 0, planned: 0, actionable: 0, needsData: 0, superseded: 0 } }
const automation: AutomationRule = { id: 'a1', name: 'Carrinho 30min', eventType: 'abandoned_checkout', templateName: 't', delayMinutes: 30, active: true, maxSendsPerEntity: 1, stopIfOrderExists: true, runtime: { cronEnabled: false, automationSendEnabled: true, flowEnabled: true, whatsappDryRun: false } }

function route(path: string): Promise<unknown> {
  if (path.startsWith('ai/opportunities')) return Promise.resolve({ data: [opp] })
  if (path === 'email/campaign-library') return Promise.resolve(library)
  if (path === 'email/audiences') return Promise.resolve(audiences)
  if (path === 'email/recommendations') return Promise.resolve(recs)
  if (path === 'automations') return Promise.resolve({ data: [automation] })
  return Promise.reject(new ApiError('AI_DATABASE_URL não configurada', 503, 'AI_DATABASE_NOT_CONFIGURED'))
}

describe('CampaignsPage', () => {
  it('oportunidade mostra população, elegíveis, bloqueados, motivos, canal, template e recomendação — sem ações', async () => {
    mockedApiGet.mockImplementation(route as never)
    renderWithProviders(<CampaignsPage />)
    expect(await screen.findByText('9 pedidos com Pix pendente')).toBeInTheDocument()
    expect(screen.getByText('_pix_pendente')).toBeInTheDocument()
    expect(screen.getByTitle('consent_unproven')).toHaveTextContent('Consentimento não comprovado')
    expect(screen.getByText(/Horário comercial · confiança medium/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /criar|aprovar|agendar|enviar/i })).not.toBeInTheDocument()
  })

  it('campanhas/aprendizados com 503 AI_DATABASE_NOT_CONFIGURED viram aviso neutro, não erro', async () => {
    mockedApiGet.mockImplementation(route as never)
    renderWithProviders(<CampaignsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Campanhas' }))
    expect(await screen.findByText('Recurso indisponível neste ambiente.')).toBeInTheDocument()
    expect(screen.queryByText('Dados indisponiveis')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aprendizados' }))
    expect(await screen.findByText(/AI_DATABASE_NOT_CONFIGURED/)).toBeInTheDocument()
  })

  it('e-mail mostra só métricas reais, gate bloqueado e gap de abertura/clique', async () => {
    mockedApiGet.mockImplementation(route as never)
    renderWithProviders(<CampaignsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'E-mail' }))
    expect(await screen.findByText('Bloqueado')).toBeInTheDocument()
    expect(screen.getByText(/Falta: EMAIL_SEND_DISABLED/)).toBeInTheDocument()
    expect(screen.getByText(/abertura, clique, bounce e descadastro não são expostas/)).toBeInTheDocument()
    expect(await screen.findByText('Clientes VIP')).toBeInTheDocument()
    expect(screen.getByTitle('eligible_verified')).toHaveTextContent('Elegibilidade verificada')
    expect(screen.queryByText(/Taxa de abertura/i)).not.toBeInTheDocument()
  })

  it('automações: cron false = "Cron desabilitado" neutro', async () => {
    mockedApiGet.mockImplementation(route as never)
    renderWithProviders(<CampaignsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Automações' }))
    expect(await screen.findByText('Cron desabilitado')).toBeInTheDocument()
    expect(screen.getByText('Carrinho 30min')).toBeInTheDocument()
    expect(document.querySelector('.text-status-danger')).toBeNull()
  })

  it('título contraditório (N elegíveis com eligibleCount=0) vira headline neutra + DATA_QUALITY_WARNING', async () => {
    const bad: Opportunity = { ...opp, id: 'o2', type: 'ABANDONED_CART', title: '100 carrinhos abandonados elegíveis', audienceCount: 100, eligibleCount: 0, blockedCount: 100 }
    mockedApiGet.mockImplementation(((path: string) => (path.startsWith('ai/opportunities') ? Promise.resolve({ data: [bad, opp] }) : route(path))) as never)
    renderWithProviders(<CampaignsPage />)
    expect(await screen.findByRole('heading', { name: 'Carrinhos abandonados' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '100 carrinhos abandonados elegíveis' })).not.toBeInTheDocument()
    expect(screen.getByText(/DATA_QUALITY_WARNING/)).toHaveTextContent('100 carrinhos abandonados elegíveis')
    // titulo coerente (sem "elegiveis") segue como veio, sem aviso
    expect(screen.getByRole('heading', { name: '9 pedidos com Pix pendente' })).toBeInTheDocument()
    expect(screen.getAllByText(/DATA_QUALITY_WARNING/)).toHaveLength(1)
  })

  it('erro real (500) em oportunidades aparece como erro', async () => {
    mockedApiGet.mockRejectedValue(new ApiError('Falha interna', 500))
    renderWithProviders(<CampaignsPage />)
    expect(await screen.findByText('Falha interna')).toBeInTheDocument()
  })
})
