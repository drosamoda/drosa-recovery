import { describe, expect, it, vi } from 'vitest'
import {
  addEmailComplianceFooter,
  processEmailCampaignDraft,
  renderEmailCampaignMessage,
  runEmailCampaignExecutor,
  type EmailCampaignExecutorDeps,
  type ExecutableEmailCampaignDraft,
} from '../../services/emailCampaignExecutor'
import type { EmailRecipientGateResult } from '../../services/emailSendGate'
import type { EmailStrategy } from '../../services/ai/aiProvider'

const draft: ExecutableEmailCampaignDraft = {
  id: 'draft_123',
  status: 'SCHEDULED',
  channel: 'EMAIL',
  audienceSnapshot: {
    channel: 'email',
    segmentKey: 'LAPSED_61_90D',
    campaignKey: 'WINBACK_61_90',
  },
  selectedStrategy: 0,
  strategies: [{
    direction: 'A',
    name: 'Reconexão',
    angle: 'Voltar a conversar',
    audience: 'Clientes',
    productId: null,
    subject: 'Sentimos sua falta',
    preheader: 'Passe quando quiser',
    headline: 'Estamos por aqui',
    body: 'Quando quiser conferir o catálogo, estamos por aqui.',
    cta: 'Ver catálogo',
    creativeBrief: 'Simples',
    warnings: [],
  }],
}

function deps(overrides: Partial<EmailCampaignExecutorDeps> = {}): EmailCampaignExecutorDeps {
  return {
    resolveRecipients: vi.fn().mockResolvedValue([
      { email: 'ana@example.com', recentAbandonedCart: false },
      { email: 'bia@example.com', recentAbandonedCart: false },
    ]),
    refreshRecipientConsent: vi.fn().mockResolvedValue(true),
    evaluateRecipient: vi.fn(async (email: string): Promise<EmailRecipientGateResult> =>
      email.startsWith('ana')
        ? { allowed: true, blocks: [], consentState: 'CONFIRMED_OPT_IN' }
        : { allowed: false, blocks: ['EMAIL_SUPPRESSED'], consentState: 'CONFIRMED_OPT_IN' }),
    hashRecipient: vi.fn((email: string) => email.startsWith('ana') ? 'a'.repeat(64) : 'b'.repeat(64)),
    reserveSend: vi.fn().mockResolvedValue({ sendId: 'send_1', sendKey: 'x', status: 'QUEUED', created: true }),
    dispatch: vi.fn().mockResolvedValue({ providerMessageId: 'provider_1' }),
    issueHeaders: vi.fn().mockReturnValue({
      'List-Unsubscribe': '<https://example.com/unsubscribe?t=x>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }),
    resolveCtaUrl: vi.fn().mockResolvedValue('https://www.drosamoda.com.br/'),
    updateDraft: vi.fn().mockResolvedValue(undefined),
    countCampaignSends: vi.fn().mockResolvedValue(0),
    ...overrides,
  }
}

describe('emailCampaignExecutor', () => {
  it('executor operacional permanece desligado por default e não toca banco/provider', async () => {
    const result = await runEmailCampaignExecutor()
    expect(result).toEqual({
      enabled: false,
      processedDrafts: 0,
      results: [],
      blockedBy: ['EMAIL_CAMPAIGN_EXECUTOR_DISABLED'],
    })
  })

  it('envia somente destinatário elegível e persiste apenas agregados', async () => {
    const d = deps()
    const result = await processEmailCampaignDraft(draft, d, { batchSize: 20, maxTotalSends: 20 })

    expect(result.sent).toBe(1)
    expect(result.blocked).toBe(1)
    expect(d.dispatch).toHaveBeenCalledTimes(1)
    expect(d.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ana@example.com',
      tracking: { sendId: 'send_1', campaignKey: 'draft_draft_123' },
    }))
    expect(d.updateDraft).toHaveBeenCalledWith('draft_123', expect.objectContaining({
      status: 'COMPLETED',
      results: expect.objectContaining({ sent: 1, blocked: 1 }),
    }))
    expect(JSON.stringify(vi.mocked(d.updateDraft).mock.calls)).not.toMatch(/ana@example\.com|bia@example\.com/)
  })

  it('bloqueia antes do gate local quando a preferência viva da Nuvemshop não pode ser confirmada', async () => {
    const d = deps({ refreshRecipientConsent: vi.fn().mockResolvedValue(false) })
    const result = await processEmailCampaignDraft(draft, d, { batchSize: 20, maxTotalSends: 20 })

    expect(result.sent).toBe(0)
    expect(result.blocked).toBe(2)
    expect(d.evaluateRecipient).not.toHaveBeenCalled()
    expect(d.reserveSend).not.toHaveBeenCalled()
    expect(d.dispatch).not.toHaveBeenCalled()
  })

  it('respeita cap total de piloto e não envia além do limite', async () => {
    const d = deps({ countCampaignSends: vi.fn().mockResolvedValue(20) })
    const result = await processEmailCampaignDraft(draft, d, { batchSize: 20, maxTotalSends: 20 })

    expect(result.pilotCapReached).toBe(true)
    expect(d.dispatch).not.toHaveBeenCalled()
    expect(d.updateDraft).toHaveBeenCalledWith('draft_123', expect.objectContaining({ status: 'RUNNING' }))
  })

  it('mantém RUNNING quando o lote termina antes de percorrer toda a audiência', async () => {
    const d = deps({
      evaluateRecipient: vi.fn().mockResolvedValue({ allowed: true, blocks: [], consentState: 'CONFIRMED_OPT_IN' } satisfies EmailRecipientGateResult),
      reserveSend: vi.fn()
        .mockResolvedValueOnce({ sendId: 's1', sendKey: '1', status: 'QUEUED', created: true })
        .mockResolvedValueOnce({ sendId: 's2', sendKey: '2', status: 'QUEUED', created: true }),
    })
    const result = await processEmailCampaignDraft(draft, d, { batchSize: 1, maxTotalSends: 20 })
    expect(result.sent).toBe(1)
    expect(result.hasMore).toBe(true)
    expect(d.updateDraft).toHaveBeenCalledWith('draft_123', expect.objectContaining({ status: 'RUNNING' }))
  })

  it('renderiza subject, preheader, headline, body e CTA sem executar HTML arbitrário', () => {
    const rendered = renderEmailCampaignMessage((draft.strategies as EmailStrategy[])[0], 'https://www.drosamoda.com.br/')
    expect(rendered.subject).toBe('Sentimos sua falta')
    expect(rendered.html).toContain('Estamos por aqui')
    expect(rendered.html).toContain('Ver catálogo')
    expect(rendered.html).toContain('https://www.drosamoda.com.br/')
  })

  it('inclui descadastro visível e aviso de privacidade no HTML e no texto', () => {
    const base = renderEmailCampaignMessage((draft.strategies as EmailStrategy[])[0], 'https://www.drosamoda.com.br/')
    const rendered = addEmailComplianceFooter(
      base,
      'https://crm.example.com/unsubscribe/email?t=abc',
      'https://crm.example.com/privacy/email-marketing',
    )
    expect(rendered.html).toContain('Cancelar recebimento de e-mails promocionais')
    expect(rendered.html).toContain('Privacidade e uso de e-mail')
    expect(rendered.text).toContain('Cancelar recebimento: https://crm.example.com/unsubscribe/email?t=abc')
    expect(rendered.text).toContain('Privacidade e uso de e-mail: https://crm.example.com/privacy/email-marketing')
  })
})
