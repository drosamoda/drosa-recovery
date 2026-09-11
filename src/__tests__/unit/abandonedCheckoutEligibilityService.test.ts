import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  suppressionFindUnique: vi.fn(),
  customerFindFirst: vi.fn(),
  whatsappTemplateFindFirst: vi.fn(),
  messageLogFindFirst: vi.fn(),
  orderFindMany: vi.fn(),
  hasActiveWhatsappConsent: vi.fn(),
  renderTemplatePreview: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    suppression: { findUnique: mocks.suppressionFindUnique },
    customer: { findFirst: mocks.customerFindFirst },
    whatsappTemplate: { findFirst: mocks.whatsappTemplateFindFirst },
    messageLog: { findFirst: mocks.messageLogFindFirst },
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

vi.mock('../../services/whatsappConsentService', () => ({
  hasActiveWhatsappConsent: mocks.hasActiveWhatsappConsent,
}))

vi.mock('../../helpers/inboxTemplatePreview', () => ({
  renderTemplatePreview: mocks.renderTemplatePreview,
}))

import { evaluateAbandonedCheckoutEligibility } from '../../services/abandonedCheckoutEligibilityService'

const checkout = {
  id: 'checkout-db-1',
  nuvemshopCheckoutId: '2067348677',
  customerId: 'customer-1',
  customerName: 'Cliente Teste',
  customerEmail: 'cliente@example.com',
  customerPhone: '31987654321',
  normalizedPhone: '5531987654321',
  abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/test-token',
  status: 'abandoned',
  sourceCreatedAt: new Date('2026-09-10T22:51:16Z'),
  sourceUpdatedAt: new Date('2026-09-11T00:50:14Z'),
  abandonedAt: null,
} as never

describe('evaluateAbandonedCheckoutEligibility legacy order timing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.suppressionFindUnique.mockResolvedValue(null)
    mocks.customerFindFirst.mockResolvedValue({ optOut: false })
    mocks.hasActiveWhatsappConsent.mockResolvedValue(true)
    mocks.whatsappTemplateFindFirst.mockResolvedValue({
      metaTemplateName: 'carrinho_abandonado_drosa_v2',
      languageCode: 'pt_BR',
      messagePreview: 'Oi, {{1}}! Continue em {{2}}',
      variables: {},
    })
    mocks.messageLogFindFirst.mockResolvedValue(null)
    mocks.renderTemplatePreview.mockReturnValue({ renderedPreview: 'Oi, Cliente! Continue em https://www.drosamoda.com.br/checkout/test-token' })
  })

  it('does not block when a legacy order lacks sourceCreatedAt but was ingested before the checkout', async () => {
    mocks.orderFindMany.mockResolvedValue([
      {
        id: 'legacy-order',
        sourceCreatedAt: null,
        createdAt: new Date('2026-05-05T22:37:02Z'),
      },
    ])

    const result = await evaluateAbandonedCheckoutEligibility(
      checkout,
      new Date('2026-09-11T13:00:00Z')
    )

    expect(result.reasons).not.toContain('order_timing_uncertain')
    expect(result.reasons).not.toContain('order_after_checkout')
    expect(result.eligible).toBe(true)
  })

  it('fails closed when a legacy order lacks sourceCreatedAt and was ingested after the checkout', async () => {
    mocks.orderFindMany.mockResolvedValue([
      {
        id: 'uncertain-order',
        sourceCreatedAt: null,
        createdAt: new Date('2026-09-11T01:00:00Z'),
      },
    ])

    const result = await evaluateAbandonedCheckoutEligibility(
      checkout,
      new Date('2026-09-11T13:00:00Z')
    )

    expect(result.reasons).toContain('order_timing_uncertain')
    expect(result.eligible).toBe(false)
  })
})
