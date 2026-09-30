import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'

const HOUR = 3_600_000

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  customerFindUnique: vi.fn(),
  customerFindFirst: vi.fn(),
  suppression: vi.fn(),
  template: vi.fn(),
  rule: vi.fn(),
  orderFindUnique: vi.fn(),
  orderFindFirst: vi.fn(),
  consent: vi.fn(),
  meta: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    messageLog: { findMany: mocks.findMany, count: mocks.count, updateMany: mocks.updateMany, update: mocks.update, findUnique: mocks.findUnique, findFirst: mocks.findFirst },
    customer: { findUnique: mocks.customerFindUnique, findFirst: mocks.customerFindFirst, update: vi.fn() },
    suppression: { findUnique: mocks.suppression },
    whatsappTemplate: { findFirst: mocks.template },
    automationRule: { findFirst: mocks.rule },
    order: { findUnique: mocks.orderFindUnique, findFirst: mocks.orderFindFirst },
    abandonedCheckout: { findUnique: vi.fn() },
    conversation: { findUnique: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
  },
}))
vi.mock('../../services/whatsappConsentService', () => ({ hasActiveWhatsappConsent: mocks.consent }))
vi.mock('../../services/whatsappService', () => ({ whatsappService: { sendTemplateMessage: mocks.send } }))
vi.mock('../../services/inboxService', () => ({ inboxService: { mirrorAutomationMessage: vi.fn() } }))
vi.mock('../../services/templateContracts', async () => {
  const actual = await vi.importActual<typeof import('../../services/templateContracts')>('../../services/templateContracts')
  // O processador chama verifyDispatchContract (mesmo módulo → não pega o mock de verifyMetaTemplateContract):
  // reproduzimos a composição real = parte local + verificação da Meta (mockada, sem rede).
  const verifyDispatchContract = async (...args: Parameters<typeof actual.localDispatchContractError>): Promise<string | null> =>
    actual.localDispatchContractError(...args) ?? (await mocks.meta())
  return { ...actual, verifyMetaTemplateContract: mocks.meta, verifyDispatchContract }
})

import { runProcessMessages } from '../../jobs/processMessages'
import { runProcessMessagesDryRun } from '../../jobs/processMessagesDryRun'

type Decision = 'expire' | 'txConsent' | 'payment' | 'other' | 'reach'
type Scenario = { name: string; msg: Record<string, unknown>; consentTransactional: boolean; optOut?: boolean; paid?: boolean; expect: Decision }

const base = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, entityType: 'order', entityId: `o-${id}`, customerId: `c-${id}`, normalizedPhone: '5531998021418',
  templateName: 'confirmacao_pedido_drosa', source: null, status: 'pending', retryCount: 0,
  scheduledAt: new Date(Date.now() - HOUR), nextRetryAt: null, claimOwner: null, ...over,
})

const scenarios: Scenario[] = [
  { name: 'elegível', msg: base('ok'), consentTransactional: true, expect: 'reach' },
  { name: 'expirada (>24h)', msg: base('exp', { scheduledAt: new Date(Date.now() - 30 * HOUR) }), consentTransactional: true, expect: 'expire' },
  { name: 'sem consentimento transacional', msg: base('nc'), consentTransactional: false, expect: 'txConsent' },
  { name: 'boleto já pago', msg: base('paid', { templateName: 'pedido_boleto_drosa_01' }), consentTransactional: true, paid: true, expect: 'payment' },
  { name: 'opt-out do cliente', msg: base('oo'), consentTransactional: true, optOut: true, expect: 'other' },
]

beforeEach(() => {
  vi.clearAllMocks()
  env.AUTOMATION_SEND_ENABLED = true
  env.WHATSAPP_DRY_RUN = true // o processador só chega ao estágio de envio e registra dry_run
  env.AUTOMATION_ALLOWED_TEMPLATES = ['confirmacao_pedido_drosa', 'pedido_boleto_drosa_01']
  env.AUTOMATION_MAX_MESSAGE_AGE_HOURS = 24
  env.MESSAGE_SEND_DELAY_MS = 0
  env.ABANDONED_CART_ENABLED = true
  env.REMARKETING_ENABLED = true
  mocks.count.mockResolvedValue(1)
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.update.mockResolvedValue({})
  mocks.findFirst.mockResolvedValue(null)
  mocks.suppression.mockResolvedValue(null)
  mocks.template.mockResolvedValue({ id: 't', languageCode: 'pt_BR', messagePreview: null, variables: null, metaTemplateName: 'x' })
  mocks.orderFindFirst.mockResolvedValue(null)
  mocks.meta.mockResolvedValue(null)
})

function arrange(s: Scenario): void {
  mocks.findMany.mockResolvedValue([s.msg])
  mocks.customerFindUnique.mockResolvedValue({ id: 'c', optOut: Boolean(s.optOut) })
  mocks.customerFindFirst.mockResolvedValue({ id: 'c', optOut: Boolean(s.optOut) })
  mocks.consent.mockImplementation(async (_p: string, scope: string) => scope === 'transactional' && s.consentTransactional)
  mocks.rule.mockResolvedValue(s.paid
    ? { id: 'r', eventType: 'order_created_boleto', templateName: 'pedido_boleto_drosa_01', active: true }
    : { id: 'r', eventType: 'order_created', templateName: 'confirmacao_pedido_drosa', active: true })
  mocks.orderFindUnique.mockResolvedValue({
    customerName: 'Maria Silva', orderNumber: '1001', total: '10', orderUrl: 'x', paymentStatus: s.paid ? 'paid' : 'pending',
    paymentMethod: s.paid ? 'boleto' : 'pix', status: 'open', sourceCreatedAt: new Date(),
  })
  // o processador confere o claim (status/claimOwner) no próprio log
  mocks.findUnique.mockImplementation(async () => {
    const claim = mocks.updateMany.mock.calls.find(([a]) => (a as { data?: { claimOwner?: string } }).data?.claimOwner)
    return { status: 'processing', claimOwner: (claim?.[0] as { data: { claimOwner: string } } | undefined)?.data.claimOwner }
  })
}

function processorDecision(): Decision {
  const updates = mocks.update.mock.calls.map(([a]) => (a as { data: { status?: string; reason?: string | null } }).data)
  const skipped = updates.find((u) => u.status === 'skipped')
  if (skipped) {
    if (skipped.reason === 'message_expired') return 'expire'
    if (skipped.reason === 'transactional_consent_unproven') return 'txConsent'
    if (skipped.reason === 'payment_already_completed' || skipped.reason === 'order_cancelled') return 'payment'
    return 'other'
  }
  if (updates.some((u) => u.reason === 'dry_run')) return 'reach'
  throw new Error(`decisão do processador não classificada: ${JSON.stringify(updates)}`)
}

function previewDecision(r: Awaited<ReturnType<typeof runProcessMessagesDryRun>>): Decision {
  if (r.wouldExpire) return 'expire'
  if (r.wouldSkipTransactionalConsent) return 'txConsent'
  if (r.wouldSkipPaymentCompleted) return 'payment'
  if (r.other) return 'other'
  if (r.wouldReachSendStage) return 'reach'
  throw new Error(`decisão do preview não classificada: ${JSON.stringify(r)}`)
}

describe('paridade preview x processador nos gates que o preview declara avaliar', () => {
  for (const s of scenarios) {
    it(`${s.name}: mesma decisão pré-envio`, async () => {
      arrange(s)
      const preview = previewDecision(await runProcessMessagesDryRun())
      expect(mocks.update.mock.calls.length + mocks.updateMany.mock.calls.length).toBe(0)

      await runProcessMessages()
      const real = processorDecision()

      expect(preview).toBe(s.expect)
      expect(real).toBe(preview)
      expect(mocks.send).not.toHaveBeenCalled()
    })
  }
})
