import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  suppressionFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  messageLogFindMany: vi.fn(),
  consentFindMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  recipientCreate: vi.fn(),
  recipientUpdate: vi.fn(),
  verifyMeta: vi.fn(),
  existsBlockingLog: vi.fn(),
  createPendingMessage: vi.fn(),
  abandonedPreview: vi.fn(),
}))

const testEnv = vi.hoisted(() => ({
  NODE_ENV: 'production',
  ABANDONED_CART_TEMPLATE: 'carrinho_abandonado_drosa_v2',
  REMARKETING_GLOBAL_COOLDOWN_HOURS: 24,
  REMARKETING_RECENT_CUSTOMER_DAYS: 30,
  REMARKETING_INACTIVE_DAYS: 90,
  VIP_MIN_ORDERS: 3,
  VIP_MIN_SPEND: 500,
  REMARKETING_MAX_SENDS_PER_RUN: 1,
  AUTOMATION_SEND_ENABLED: true,
  REMARKETING_ENABLED: true,
  WHATSAPP_DRY_RUN: false,
}))

vi.mock('../../config/env', () => ({ env: testEnv }))

vi.mock('../../config/prisma', () => ({
  prisma: {
    order: { findMany: mocks.orderFindMany },
    conversation: { findMany: mocks.conversationFindMany },
    suppression: { findMany: mocks.suppressionFindMany },
    customer: { findMany: mocks.customerFindMany },
    messageLog: { findMany: mocks.messageLogFindMany },
    whatsappConsent: { findMany: mocks.consentFindMany },
    remarketingRun: { create: mocks.runCreate, update: mocks.runUpdate },
    remarketingRecipient: { create: mocks.recipientCreate, update: mocks.recipientUpdate },
  },
}))

vi.mock('../../services/templateContracts', () => ({
  verifyMetaTemplateContract: mocks.verifyMeta,
}))

vi.mock('../../services/messageService', () => ({
  messageService: {
    existsBlockingLog: mocks.existsBlockingLog,
    createPendingMessageIfNotExists: mocks.createPendingMessage,
  },
}))

vi.mock('../../jobs/previewAbandonedCheckouts', () => ({
  runAbandonedCheckoutsPreview: mocks.abandonedPreview,
}))

import { remarketingPreview, remarketingSend } from '../../services/remarketingService'

const phone = '5531998021418'
const paidOrder = {
  id: 'order-1',
  customerId: 'customer-1',
  normalizedPhone: phone,
  paymentStatus: 'paid',
  paymentMethod: 'credit_card',
  status: 'open',
  sourceCreatedAt: new Date(Date.now() - 10 * 86_400_000),
  total: 300,
  orderUrl: 'https://www.drosamoda.com.br/pedido/1',
}

describe('remarketingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testEnv.AUTOMATION_SEND_ENABLED = true
    testEnv.REMARKETING_ENABLED = true
    testEnv.WHATSAPP_DRY_RUN = false
    testEnv.REMARKETING_MAX_SENDS_PER_RUN = 1

    mocks.orderFindMany.mockResolvedValue([paidOrder])
    mocks.conversationFindMany.mockResolvedValue([])
    mocks.suppressionFindMany.mockResolvedValue([])
    mocks.customerFindMany.mockResolvedValue([])
    mocks.messageLogFindMany.mockResolvedValue([])
    mocks.consentFindMany.mockResolvedValue([{ normalizedPhone: phone }])
    mocks.verifyMeta.mockResolvedValue(null)
    mocks.abandonedPreview.mockResolvedValue({ found: 0, eligible: 0, skipped: 0, reasons: {} })
    mocks.runCreate.mockResolvedValue({ id: 'run-1' })
    mocks.runUpdate.mockResolvedValue({ id: 'run-1' })
    mocks.recipientCreate.mockResolvedValue({ id: 'recipient-1' })
    mocks.recipientUpdate.mockResolvedValue({ id: 'recipient-1' })
    mocks.existsBlockingLog.mockResolvedValue(false)
    mocks.createPendingMessage.mockResolvedValue({ id: 'msg-1', status: 'pending' })
  })

  it('preview recent_customer fica elegivel somente com consentimento e template Meta verificado', async () => {
    const result = await remarketingPreview('recent_customer')
    expect(result).toMatchObject({ found: 1, eligible: 1, skipped: 0, sent: 0 })
  })

  it('sem consentimento marketing o candidato fica fail-closed', async () => {
    mocks.consentFindMany.mockResolvedValue([])
    const result = await remarketingPreview('recent_customer')
    expect(result.eligible).toBe(0)
    expect(result.reasons.consent_unproven).toBe(1)
  })

  it('exige segmento explicito para qualquer fila real', async () => {
    const result = await remarketingSend('all')
    expect(result.status).toBe(400)
    expect(result.result.queued).toBe(0)
    expect(mocks.runCreate).not.toHaveBeenCalled()
    expect(mocks.createPendingMessage).not.toHaveBeenCalled()
  })

  it('gates fechados impedem a criacao da fila', async () => {
    testEnv.WHATSAPP_DRY_RUN = true
    const result = await remarketingSend('recent_customer')
    expect(result.status).toBe(423)
    expect(mocks.runCreate).not.toHaveBeenCalled()
    expect(mocks.createPendingMessage).not.toHaveBeenCalled()
  })

  it('enfileira no maximo um candidato e nunca envia WhatsApp diretamente', async () => {
    const result = await remarketingSend('recent_customer')

    expect(result.status).toBe(202)
    expect(result.result).toMatchObject({ claimed: 1, queued: 1, sent: 0, runId: 'run-1' })
    expect(mocks.createPendingMessage).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'order',
      entityId: 'order-1',
      customerId: 'customer-1',
      normalizedPhone: phone,
      templateName: 'cliente_recente_drosa_v1',
      source: 'remarketing:recent_customer',
    }))
    expect(mocks.runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1' },
      data: expect.objectContaining({ status: 'completed', failedCount: 0 }),
    }))
  })
})
