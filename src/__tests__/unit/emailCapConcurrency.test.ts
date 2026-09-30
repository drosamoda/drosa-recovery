import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', async () => {
  const { trackingDb } = await import('../fixtures/inMemoryTrackingDb')
  return { prisma: trackingDb.prisma }
})

import { trackingDb } from '../fixtures/inMemoryTrackingDb'
import { hashEmail } from '../../services/emailConsentService'
import { claimEmailSend, reserveEmailSendWithinCap } from '../../services/emailTrackingService'
import {
  processEmailCampaignDraft,
  type EmailCampaignExecutorDeps,
  type ExecutableEmailCampaignDraft,
} from '../../services/emailCampaignExecutor'
import { EmailProviderSendError } from '../../services/emailProviderAdapter'

const PEPPER = 'p'.repeat(40)
const h = (i: number): string => hashEmail(`user${i}@example.com`, PEPPER)

const draft: ExecutableEmailCampaignDraft = {
  id: 'draft_race',
  status: 'RUNNING',
  channel: 'EMAIL',
  audienceSnapshot: { channel: 'email', segmentKey: 'LAPSED_61_90D', campaignKey: 'WINBACK_61_90' },
  selectedStrategy: 0,
  strategies: [{
    direction: 'A', name: 'x', angle: 'x', audience: 'x', productId: null,
    subject: 'Assunto', preheader: 'Pre', headline: 'Titulo', body: 'Corpo', cta: 'Ver', creativeBrief: 'x', warnings: [],
  }],
}

beforeEach(() => {
  trackingDb.reset()
  providerCalls.n = 0
})

describe('reserveEmailSendWithinCap (cap atômico)', () => {
  it('100 reservas concorrentes com cap 50 → exatamente 50 criadas, 50 recusadas', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => reserveEmailSendWithinCap({ emailHash: h(i), campaignKey: 'draft_x' }, 50)),
    )
    expect(results.filter((r) => r !== null)).toHaveLength(50)
    expect(results.filter((r) => r === null)).toHaveLength(50)
    expect(trackingDb.sends).toHaveLength(50)
  })

  it('repetir a mesma reserva não consome cap de novo (idempotente)', async () => {
    const a = await reserveEmailSendWithinCap({ emailHash: h(1), campaignKey: 'draft_x' }, 1)
    const b = await reserveEmailSendWithinCap({ emailHash: h(1), campaignKey: 'draft_x' }, 1)
    expect(b).toMatchObject({ sendId: a!.sendId, created: false })
    expect(await reserveEmailSendWithinCap({ emailHash: h(2), campaignKey: 'draft_x' }, 1)).toBeNull()
  })

  it('campanhas diferentes têm caps independentes', async () => {
    await reserveEmailSendWithinCap({ emailHash: h(1), campaignKey: 'draft_a' }, 1)
    expect(await reserveEmailSendWithinCap({ emailHash: h(2), campaignKey: 'draft_b' }, 1)).not.toBeNull()
  })
})

const providerCalls = { n: 0 }

function worker(failAll: boolean): EmailCampaignExecutorDeps {
  return {
    resolveRecipients: vi.fn().mockResolvedValue(Array.from({ length: 200 }, (_, i) => ({ email: `user${i}@example.com`, recentAbandonedCart: false }))),
    refreshRecipientConsent: vi.fn().mockResolvedValue(true),
    evaluateRecipient: vi.fn().mockResolvedValue({ allowed: true, blocks: [], consentState: 'CONFIRMED_OPT_IN' }),
    hashRecipient: (email: string) => hashEmail(email, PEPPER),
    reserveSend: (input, max) => reserveEmailSendWithinCap(input, max),
    // como o dispatcher real: claim atômico QUEUED→SENDING antes de chamar o provedor
    dispatch: vi.fn(async (message: { tracking?: { sendId: string }; to: string }) => {
      await claimEmailSend(message.tracking!.sendId, hashEmail(message.to, PEPPER))
      providerCalls.n++
      if (failAll) throw new EmailProviderSendError('boom', true)
      return { providerMessageId: 'p' }
    }),
    issueHeaders: vi.fn().mockReturnValue({ 'List-Unsubscribe': '<https://example.com/u?t=x>' }),
    resolveCtaUrl: vi.fn().mockResolvedValue('https://www.drosamoda.com.br/'),
    updateDraft: vi.fn().mockResolvedValue(undefined),
    // Ambos leem 0 no início: a proteção tem de vir da reserva atômica, não desta leitura.
    countCampaignSends: vi.fn().mockResolvedValue(0),
  }
}

describe('executor com dois workers simultâneos', () => {
  for (const failAll of [false, true]) {
    it(`cap 50, lote 100, dois workers ao mesmo tempo (${failAll ? 'provedor falhando' : 'provedor ok'}) → ≤ 50 reservas`, async () => {
      const a = worker(failAll)
      const b = worker(failAll)
      await Promise.all([
        processEmailCampaignDraft(draft, a, { batchSize: 100, maxTotalSends: 50 }),
        processEmailCampaignDraft(draft, b, { batchSize: 100, maxTotalSends: 50 }),
      ])
      expect(trackingDb.sends.length).toBeLessThanOrEqual(50)
      expect(providerCalls.n).toBeLessThanOrEqual(50) // chamadas reais ao provedor
    })
  }
})
