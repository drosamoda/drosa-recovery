import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  suppressionFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  whatsappConsentFindMany: vi.fn(),
  whatsappTemplateFindFirst: vi.fn(),
  messageLogFindMany: vi.fn(),
  orderFindMany: vi.fn(),
  renderTemplatePreview: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    suppression: { findMany: mocks.suppressionFindMany },
    customer: { findMany: mocks.customerFindMany },
    whatsappConsent: { findMany: mocks.whatsappConsentFindMany },
    whatsappTemplate: { findFirst: mocks.whatsappTemplateFindFirst },
    messageLog: { findMany: mocks.messageLogFindMany },
    order: { findMany: mocks.orderFindMany },
  },
}))

vi.mock('../../config/env', () => ({
  env: {
    CHECKOUT_BASE_URL: 'https://www.drosamoda.com.br/checkout/',
    ABANDONED_CART_TEMPLATE: 'carrinho_abandonado_drosa_v2',
    ABANDONED_CART_DELAY_MINUTES: 30,
    ABANDONED_CART_MAX_AGE_HOURS: 168,
    ABANDONED_CART_COOLDOWN_HOURS: 24,
    REMARKETING_GLOBAL_COOLDOWN_HOURS: 24,
  },
}))

vi.mock('../../helpers/inboxTemplatePreview', () => ({
  renderTemplatePreview: mocks.renderTemplatePreview,
}))

import { evaluateAbandonedCheckoutEligibilityBatch } from '../../services/abandonedCheckoutEligibilityService'

function makeCheckout(overrides: Record<string, unknown>) {
  return {
    id: overrides.id,
    nuvemshopCheckoutId: `ns-${overrides.id}`,
    customerId: null,
    customerName: 'Cliente Teste',
    customerEmail: null,
    customerPhone: null,
    abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/test-token',
    status: 'abandoned',
    sourceCreatedAt: new Date('2026-09-10T22:51:16Z'),
    sourceUpdatedAt: new Date('2026-09-11T00:50:14Z'),
    abandonedAt: null,
    ...overrides,
  } as never
}

const NOW = new Date('2026-09-11T13:00:00Z')

describe('evaluateAbandonedCheckoutEligibilityBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.whatsappTemplateFindFirst.mockResolvedValue({
      metaTemplateName: 'carrinho_abandonado_drosa_v2',
      languageCode: 'pt_BR',
      messagePreview: 'Oi, {{1}}! Continue em {{2}}',
      variables: {},
    })
    mocks.renderTemplatePreview.mockReturnValue({ renderedPreview: 'Oi, Cliente! Continue em https://www.drosamoda.com.br/checkout/test-token' })
  })

  it('busca o template exatamente uma vez, independente do número de carrinhos na página (prova do fix de N+1)', async () => {
    mocks.suppressionFindMany.mockResolvedValue([])
    mocks.customerFindMany.mockResolvedValue([])
    mocks.whatsappConsentFindMany.mockResolvedValue([{ normalizedPhone: '5531900000001', consented: true, revokedAt: null, consentedAt: new Date() }, { normalizedPhone: '5531900000002', consented: true, revokedAt: null, consentedAt: new Date() }])
    mocks.messageLogFindMany.mockResolvedValue([])
    mocks.orderFindMany.mockResolvedValue([])

    const checkouts = [
      makeCheckout({ id: 'c1', normalizedPhone: '5531900000001' }),
      makeCheckout({ id: 'c2', normalizedPhone: '5531900000002' }),
    ]

    await evaluateAbandonedCheckoutEligibilityBatch(checkouts, NOW)

    expect(mocks.whatsappTemplateFindFirst).toHaveBeenCalledTimes(1)
    expect(mocks.suppressionFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.customerFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.whatsappConsentFindMany).toHaveBeenCalledTimes(1)
  })

  it('não deixa o bloqueio (suppression/opt-out/cooldown) de um telefone vazar para outro carrinho na mesma página', async () => {
    mocks.suppressionFindMany.mockResolvedValue([{ normalizedPhone: '5531900000001' }])
    mocks.customerFindMany.mockResolvedValue([])
    mocks.whatsappConsentFindMany.mockResolvedValue([
      { normalizedPhone: '5531900000001', consented: true, revokedAt: null, consentedAt: new Date() },
      { normalizedPhone: '5531900000002', consented: true, revokedAt: null, consentedAt: new Date() },
    ])
    mocks.messageLogFindMany.mockResolvedValue([])
    mocks.orderFindMany.mockResolvedValue([])

    const checkouts = [
      makeCheckout({ id: 'c1', normalizedPhone: '5531900000001' }), // suprimido
      makeCheckout({ id: 'c2', normalizedPhone: '5531900000002' }), // limpo
    ]

    const [r1, r2] = await evaluateAbandonedCheckoutEligibilityBatch(checkouts, NOW)

    expect(r1?.reasons).toContain('opt_out')
    expect(r2?.reasons).not.toContain('opt_out')
  })

  it('produz o mesmo resultado do caminho por-linha para o cenário de legacy order (paridade)', async () => {
    mocks.suppressionFindMany.mockResolvedValue([])
    mocks.customerFindMany.mockResolvedValue([{ normalizedPhone: '5531987654321', optOut: false }])
    mocks.whatsappConsentFindMany.mockResolvedValue([{ normalizedPhone: '5531987654321', consented: true, revokedAt: null, consentedAt: new Date() }])
    mocks.messageLogFindMany.mockResolvedValue([])
    mocks.orderFindMany.mockResolvedValue([{ normalizedPhone: '5531987654321', customerEmail: null, sourceCreatedAt: null, createdAt: new Date('2026-05-05T22:37:02Z') }])

    const checkout = makeCheckout({ id: 'checkout-db-1', normalizedPhone: '5531987654321', customerEmail: 'cliente@example.com' })
    const [result] = await evaluateAbandonedCheckoutEligibilityBatch([checkout], NOW)

    expect(result?.reasons).not.toContain('order_timing_uncertain')
    expect(result?.reasons).not.toContain('order_after_checkout')
    expect(result?.eligible).toBe(true)
  })
})
