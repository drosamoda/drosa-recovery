import { describe, expect, it, vi } from 'vitest'
import {
  processEmailCampaignDraft,
  type EmailCampaignExecutorDeps,
  type ExecutableEmailCampaignDraft,
} from '../../services/emailCampaignExecutor'
import { EmailProviderSendError } from '../../services/emailProviderAdapter'
import type { EmailRecipientGateResult } from '../../services/emailSendGate'
import type { EmailSendReservation } from '../../services/emailTrackingService'

const draft: ExecutableEmailCampaignDraft = {
  id: 'draft_cap',
  status: 'RUNNING',
  channel: 'EMAIL',
  audienceSnapshot: { channel: 'email', segmentKey: 'LAPSED_61_90D', campaignKey: 'WINBACK_61_90' },
  selectedStrategy: 0,
  strategies: [{
    direction: 'A', name: 'x', angle: 'x', audience: 'x', productId: null,
    subject: 'Assunto', preheader: 'Pre', headline: 'Titulo', body: 'Corpo', cta: 'Ver', creativeBrief: 'x', warnings: [],
  }],
}

const allowed: EmailRecipientGateResult = { allowed: true, blocks: [], consentState: 'CONFIRMED_OPT_IN' }

function audience(n: number): Array<{ email: string; recentAbandonedCart: boolean }> {
  return Array.from({ length: n }, (_, i) => ({ email: `user${i}@example.com`, recentAbandonedCart: false }))
}

// Fake com estado: reservas persistem entre execuções (como emailSend no banco).
function statefulDeps(opts: { recipients: number; failEvery?: number; gate?: (email: string) => EmailRecipientGateResult }) {
  const reservations = new Set<string>()
  let dispatched = 0
  const deps: EmailCampaignExecutorDeps = {
    resolveRecipients: vi.fn().mockResolvedValue(audience(opts.recipients)),
    refreshRecipientConsent: vi.fn().mockResolvedValue(true),
    evaluateRecipient: vi.fn(async (email: string) => opts.gate?.(email) ?? allowed),
    hashRecipient: vi.fn((email: string) => email),
    reserveSend: vi.fn(async ({ emailHash }: { emailHash: string }, maxTotal: number): Promise<EmailSendReservation | null> => {
      if (reservations.has(emailHash)) return { sendId: `s_${emailHash}`, sendKey: emailHash, status: 'SENT', created: false }
      if (reservations.size >= maxTotal) return null
      reservations.add(emailHash)
      return { sendId: `s_${emailHash}`, sendKey: emailHash, status: 'QUEUED', created: true }
    }),
    dispatch: vi.fn(async () => {
      dispatched++
      if (opts.failEvery && dispatched % opts.failEvery === 0) throw new EmailProviderSendError('provider_error', true)
      return { providerMessageId: `p${dispatched}` }
    }),
    issueHeaders: vi.fn().mockReturnValue({ 'List-Unsubscribe': '<https://example.com/u?t=x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }),
    resolveCtaUrl: vi.fn().mockResolvedValue('https://www.drosamoda.com.br/'),
    updateDraft: vi.fn().mockResolvedValue(undefined),
    countCampaignSends: vi.fn(async () => reservations.size),
  }
  return { deps, reservations, dispatchedCount: () => dispatched }
}

describe('email executor — cap do piloto', () => {
  it('cap 50 em execuções de lote 20: envia 20, 20, 10 e depois 0', async () => {
    const { deps, reservations } = statefulDeps({ recipients: 200 })
    const sentPerRun: number[] = []
    for (let run = 0; run < 4; run++) {
      const r = await processEmailCampaignDraft(draft, deps, { batchSize: 20, maxTotalSends: 50 })
      sentPerRun.push(r.sent)
    }
    expect(sentPerRun).toEqual([20, 20, 10, 0])
    expect(reservations.size).toBe(50)
  })

  it('reservas que FALHAM no provedor também contam para o cap (nunca passa de 50 no total)', async () => {
    const { deps, reservations } = statefulDeps({ recipients: 200, failEvery: 3 })
    for (let run = 0; run < 6; run++) {
      await processEmailCampaignDraft(draft, deps, { batchSize: 20, maxTotalSends: 50 })
    }
    expect(reservations.size).toBeLessThanOrEqual(50)
  })

  it('dentro de UMA execução, falhas contam: com cap 10 e falha em todas, no máximo 10 tentativas', async () => {
    const { deps, dispatchedCount } = statefulDeps({ recipients: 100, failEvery: 1 })
    await processEmailCampaignDraft(draft, deps, { batchSize: 50, maxTotalSends: 10 })
    expect(dispatchedCount()).toBeLessThanOrEqual(10)
  })
})

describe('email executor — 0 chamadas ao provedor para quem não pode receber', () => {
  const cases: Array<[string, EmailRecipientGateResult]> = [
    ['opt-out confirmado', { allowed: false, blocks: ['EMAIL_CONSENT_NOT_OPT_IN'], consentState: 'CONFIRMED_OPT_OUT' }],
    ['consentimento UNKNOWN', { allowed: false, blocks: ['EMAIL_CONSENT_NOT_OPT_IN'], consentState: 'UNKNOWN' }],
    ['sem consentimento coletado', { allowed: false, blocks: ['EMAIL_CONSENT_NOT_OPT_IN'], consentState: 'NOT_COLLECTED' }],
    ['suprimido (descadastro/complaint/hard bounce)', { allowed: false, blocks: ['EMAIL_SUPPRESSED'], consentState: 'CONFIRMED_OPT_IN' }],
  ]
  for (const [label, gate] of cases) {
    it(`${label} → nenhuma reserva e nenhum envio`, async () => {
      const { deps } = statefulDeps({ recipients: 5, gate: () => gate })
      const r = await processEmailCampaignDraft(draft, deps, { batchSize: 20, maxTotalSends: 50 })
      expect(r.sent).toBe(0)
      expect(r.blocked).toBe(5)
      expect(deps.reserveSend).not.toHaveBeenCalled()
      expect(deps.dispatch).not.toHaveBeenCalled()
    })
  }

  it('idempotência: reexecutar o mesmo draft não reenvia para quem já tem envio reservado', async () => {
    const { deps, dispatchedCount } = statefulDeps({ recipients: 5 })
    await processEmailCampaignDraft(draft, deps, { batchSize: 20, maxTotalSends: 50 })
    const again = await processEmailCampaignDraft(draft, deps, { batchSize: 20, maxTotalSends: 50 })
    expect(dispatchedCount()).toBe(5)
    expect(again.sent).toBe(0)
    expect(again.alreadyProcessed).toBe(5)
  })
})
