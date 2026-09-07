import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AbandonedCheckoutStatus } from '@prisma/client'

// -----------------------------------------------------------------------
// Mocks — declarados antes de qualquer import do módulo testado
// -----------------------------------------------------------------------

vi.mock('../../config/prisma', () => ({
  prisma: {
    automationRule: { findFirst: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
    order: { findFirst: vi.fn(), findMany: vi.fn() },
    suppression: { findUnique: vi.fn() },
    messageLog: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    customer: { findUnique: vi.fn(), findFirst: vi.fn() },
    abandonedCheckout: { update: vi.fn() },
  },
}))

vi.mock('../../services/customerService', () => ({
  customerService: {
    isOptOut: vi.fn(),
  },
}))

// -----------------------------------------------------------------------
// Dados de teste
// -----------------------------------------------------------------------

const TEMPLATE_NAME = 'carrinho_abandonado_drosa_01'
const DELAY_MINUTES = 30
const CHECKOUT_ID = 'checkout-001'
const CUSTOMER_ID = 'cust-001'

const checkout = {
  id: CHECKOUT_ID,
  nuvemshopCheckoutId: 'ns-001',
  token: null,
  customerId: CUSTOMER_ID,
  customerName: 'Maria Silva',
  customerEmail: 'maria@teste.com',
  customerPhone: '31998021418',
  normalizedPhone: '5531998021418',
  total: null,
  currency: 'BRL',
  productsSummary: 'Conjunto Bela',
  abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/abc123',
  status: AbandonedCheckoutStatus.abandoned,
  rawPayload: {},
  sourceCreatedAt: new Date(Date.now() - 3600000),
  sourceUpdatedAt: new Date(Date.now() - 3600000),
  abandonedAt: null,
  firstSeenAt: new Date('2026-04-29T10:00:00Z'),
  lastSeenAt: new Date('2026-04-29T10:30:00Z'),
  convertedAt: null,
  source: 'test',
  createdAt: new Date('2026-04-29T10:00:00Z'),
  updatedAt: new Date('2026-04-29T10:00:00Z'),
} as never // cast necessário para Decimal? do Prisma

const activeRule = {
  id: 'rule-001',
  templateName: TEMPLATE_NAME,
  eventType: 'abandoned_checkout',
  active: true,
  delayMinutes: DELAY_MINUTES,
}

const activeTemplate = {
  id: 'tpl-001',
  metaTemplateName: TEMPLATE_NAME,
  active: true,
  languageCode: 'pt_BR',
  messagePreview: 'Oi, [nome_cliente]! Continue: [link_checkout]',
}

const customer = {
  id: CUSTOMER_ID,
  name: 'Maria Silva',
  optOut: false,
}

// -----------------------------------------------------------------------
// Testes
// -----------------------------------------------------------------------

describe('abandonedCheckoutService.scheduleAbandonedCheckoutMessage', () => {
  // Importações ficam no escopo do describe para reusar após vi.mock
  let abandonedCheckoutService: typeof import('../../services/abandonedCheckoutService').abandonedCheckoutService
  let customerService: typeof import('../../services/customerService').customerService
  let prisma: typeof import('../../config/prisma').prisma

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ abandonedCheckoutService } = await import('../../services/abandonedCheckoutService'))
    ;({ customerService } = await import('../../services/customerService'))
    ;({ prisma } = await import('../../config/prisma'))

    // Cenário base: tudo válido
    vi.mocked(customerService.isOptOut).mockResolvedValue(false)
    vi.mocked(prisma.suppression.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(customer as never)
    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.order.findMany).mockResolvedValue([])
    vi.mocked(prisma.automationRule.findFirst).mockResolvedValue(activeRule as never)
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue(activeTemplate as never)
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null)          // sem pedido posterior
    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue(null)    // sem log anterior
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(customer as never)
    vi.mocked(prisma.messageLog.create).mockResolvedValue({
      id: 'log-001',
      idempotencyKey: `abandoned_checkout:${CHECKOUT_ID}:${TEMPLATE_NAME}`,
      entityType: 'abandoned_checkout',
      entityId: CHECKOUT_ID,
      customerId: CUSTOMER_ID,
      normalizedPhone: '5531998021418',
      templateName: TEMPLATE_NAME,
      status: 'pending',
    } as never)
  })

  // -----------------------------------------------------------------------
  // Cenário principal — cria message_log correto
  // -----------------------------------------------------------------------

  it('cria message_log status=pending para checkout válido', async () => {
    const result = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    expect(result).toBe(true)
    expect(prisma.messageLog.create).toHaveBeenCalledTimes(1)
  })

  it('message_log tem templateName=carrinho_abandonado_drosa_01', async () => {
    await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    const createCall = vi.mocked(prisma.messageLog.create).mock.calls[0][0]
    expect(createCall.data.templateName).toBe(TEMPLATE_NAME)
  })

  it('message_log tem status=pending', async () => {
    await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    const createCall = vi.mocked(prisma.messageLog.create).mock.calls[0][0]
    expect(createCall.data.status).toBe('pending')
  })

  it('idempotency_key correta: abandoned_checkout:checkout-001:carrinho_abandonado_drosa_01', async () => {
    await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    const createCall = vi.mocked(prisma.messageLog.create).mock.calls[0][0]
    expect(createCall.data.idempotencyKey).toBe(
      `abandoned_checkout:${CHECKOUT_ID}:${TEMPLATE_NAME}`
    )
  })

  it('scheduledAt preserva a referencia temporal da origem para checkout ja elegivel', async () => {
    const before = Date.now()
    await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)
    const after = Date.now()

    const createCall = vi.mocked(prisma.messageLog.create).mock.calls[0][0]
    const scheduledAt = createCall.data.scheduledAt as Date

    const expectedMin = before - 3700000
    const expectedMax = after

    expect(scheduledAt.getTime()).toBeGreaterThanOrEqual(expectedMin)
    expect(scheduledAt.getTime()).toBeLessThanOrEqual(expectedMax)
  })

  it('normalizedPhone e entityId corretos no message_log', async () => {
    await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    const createCall = vi.mocked(prisma.messageLog.create).mock.calls[0][0]
    expect(createCall.data.normalizedPhone).toBe('5531998021418')
    expect(createCall.data.entityId).toBe(CHECKOUT_ID)
    expect(createCall.data.entityType).toBe('abandoned_checkout')
  })

  // -----------------------------------------------------------------------
  // Cenários que devem retornar false sem criar message_log
  // -----------------------------------------------------------------------

  it('retorna false e não cria log quando telefone está vazio', async () => {
    const checkoutSemFone = { ...checkout, normalizedPhone: '' }
    const result = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkoutSemFone as never)

    expect(result).toBe(false)
    expect(prisma.messageLog.create).not.toHaveBeenCalled()
  })

  it('retorna false e não cria log quando cliente está em opt-out', async () => {
    vi.mocked(customerService.isOptOut).mockResolvedValue(true)
    vi.mocked(prisma.suppression.findUnique).mockResolvedValue({ id: 'suppression' } as never)

    const result = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    expect(result).toBe(false)
    expect(prisma.messageLog.create).not.toHaveBeenCalled()
  })

  it('retorna false e não cria log quando não há regra ativa', async () => {
    vi.mocked(prisma.automationRule.findFirst).mockResolvedValue(null)

    const result = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    expect(result).toBe(false)
    expect(prisma.messageLog.create).not.toHaveBeenCalled()
  })

  it('retorna false e não cria log quando template está inativo', async () => {
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue(null)

    const result = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    expect(result).toBe(false)
    expect(prisma.messageLog.create).not.toHaveBeenCalled()
  })

  it('retorna false e não cria log quando existe pedido posterior ao checkout', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({ id: 'order-posterior' } as never)
    vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: 'order-posterior', sourceCreatedAt: new Date() }] as never)

    const result = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    expect(result).toBe(false)
    expect(prisma.messageLog.create).not.toHaveBeenCalled()
  })

  it('retorna false e não cria log quando já existe message_log com mesmo idempotency_key', async () => {
    // findUnique retorna log existente com status pending (blocking)
    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue({
      id: 'log-existente',
      idempotencyKey: `abandoned_checkout:${CHECKOUT_ID}:${TEMPLATE_NAME}`,
      status: 'pending',
    } as never)

    const result = await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    expect(result).toBe(false)
    expect(prisma.messageLog.create).not.toHaveBeenCalled()
  })

  it('nao altera checkout durante a avaliacao quando pedido posterior e detectado', async () => {
    vi.mocked(prisma.order.findFirst).mockResolvedValue({ id: 'order-posterior' } as never)
    vi.mocked(prisma.order.findMany).mockResolvedValue([{ id: 'order-posterior', sourceCreatedAt: new Date() }] as never)

    await abandonedCheckoutService.scheduleAbandonedCheckoutMessage(checkout)

    expect(prisma.abandonedCheckout.update).not.toHaveBeenCalled()
  })
})
