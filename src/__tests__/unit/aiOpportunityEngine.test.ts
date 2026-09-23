import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  remarketingPreview: vi.fn(),
  orderFindMany: vi.fn(),
  suppressionFindMany: vi.fn(),
  customerFindMany: vi.fn(),
  consentFindMany: vi.fn(),
}))

vi.mock('../../config/env', () => ({
  env: {
    VIP_MIN_ORDERS: 3,
    VIP_MIN_SPEND: 500,
    REMARKETING_RECENT_CUSTOMER_DAYS: 30,
    REMARKETING_INACTIVE_DAYS: 90,
    MARKETING_SEND_HOUR_START: 9,
    MARKETING_SEND_HOUR_END: 20,
  },
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    order: { findMany: mocks.orderFindMany },
    suppression: { findMany: mocks.suppressionFindMany },
    customer: { findMany: mocks.customerFindMany },
    whatsappConsent: { findMany: mocks.consentFindMany },
  },
}))

vi.mock('../../services/remarketingService', () => ({
  remarketingPreview: mocks.remarketingPreview,
  segmentContracts: {
    abandoned_cart: { template: 'carrinho_abandonado_drosa_v2' },
    pix_pending: { template: '_pix_pendente' },
    boleto_pending: { template: 'pedido_boleto_drosa_01' },
    recent_customer: { template: 'cliente_recente_drosa_v1' },
    vip_customer: { template: 'cliente_vip_drosa_v1' },
    inactive_customer: { template: 'cliente_inativo_drosa_v1' },
    engaged_no_purchase: { template: 'atendimento_retomada_drosa_v1' },
  },
}))

import { generateOpportunities } from '../../services/aiOpportunityEngine'

const emptyDataQuality = { historyTruncated: false, consentSourceConfigured: true, metaTemplatesVerified: true }

describe('aiOpportunityEngine — nunca inventa oportunidade sem dado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.orderFindMany.mockResolvedValue([])
    mocks.suppressionFindMany.mockResolvedValue([])
    mocks.customerFindMany.mockResolvedValue([])
    mocks.consentFindMany.mockResolvedValue([])
  })

  it('não gera nenhuma oportunidade quando todos os segmentos estão vazios (found=0)', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        abandoned_cart: { found: 0, eligible: 0 },
        pix_pending: { found: 0, eligible: 0 },
        boleto_pending: { found: 0, eligible: 0 },
        recent_customer: { found: 0, eligible: 0 },
        vip_customer: { found: 0, eligible: 0 },
        inactive_customer: { found: 0, eligible: 0 },
        engaged_no_purchase: { found: 0, eligible: 0 },
      },
      dataQuality: emptyDataQuality,
    })
    const opportunities = await generateOpportunities()
    expect(opportunities).toHaveLength(0)
  })

  it('gera VIP só com o critério documentado real (VIP_MIN_ORDERS/VIP_MIN_SPEND) refletido no reason', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        abandoned_cart: { found: 0, eligible: 0 }, pix_pending: { found: 0, eligible: 0 }, boleto_pending: { found: 0, eligible: 0 },
        recent_customer: { found: 0, eligible: 0 },
        vip_customer: { found: 12, eligible: 9, data: [{ reasons: [] }] },
        inactive_customer: { found: 0, eligible: 0 }, engaged_no_purchase: { found: 0, eligible: 0 },
      },
      dataQuality: emptyDataQuality,
    })
    const opportunities = await generateOpportunities()
    const vip = opportunities.find(o => o.type === 'VIP')
    expect(vip).toBeDefined()
    expect(vip!.reason).toContain('3+ pedidos')
    expect(vip!.reason).toContain('500')
    expect(vip!.audienceCount).toBe(12)
    expect(vip!.eligibleCount).toBe(9)
    expect(vip!.recommendedProduct).toBeNull()
  })

  it('rebaixa confidence para "low" quando o histórico está truncado (dado incompleto)', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        abandoned_cart: { found: 0, eligible: 0 }, pix_pending: { found: 0, eligible: 0 }, boleto_pending: { found: 0, eligible: 0 },
        recent_customer: { found: 50, eligible: 40, data: [{ reasons: [] }] },
        vip_customer: { found: 0, eligible: 0 }, inactive_customer: { found: 0, eligible: 0 }, engaged_no_purchase: { found: 0, eligible: 0 },
      },
      dataQuality: { historyTruncated: true, consentSourceConfigured: true, metaTemplatesVerified: true },
    })
    const opportunities = await generateOpportunities()
    const recent = opportunities.find(o => o.type === 'RECENT_CUSTOMER')
    expect(recent!.confidence).toBe('low')
  })

  it('REPEAT_PURCHASE usa a janela real entre RECENT_CUSTOMER_DAYS e INACTIVE_DAYS (30–90 dias), não um limiar inventado', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        abandoned_cart: { found: 0, eligible: 0 }, pix_pending: { found: 0, eligible: 0 }, boleto_pending: { found: 0, eligible: 0 },
        recent_customer: { found: 0, eligible: 0 }, vip_customer: { found: 0, eligible: 0 },
        inactive_customer: { found: 0, eligible: 0 }, engaged_no_purchase: { found: 0, eligible: 0 },
      },
      dataQuality: emptyDataQuality,
    })
    const now = Date.now()
    const day = 86400000
    mocks.orderFindMany.mockResolvedValue([
      { id: 'o1', normalizedPhone: '5531900000001', sourceCreatedAt: new Date(now - 45 * day) }, // dentro da janela (recompra)
      { id: 'o2', normalizedPhone: '5531900000002', sourceCreatedAt: new Date(now - 10 * day) }, // recente demais
      { id: 'o3', normalizedPhone: '5531900000003', sourceCreatedAt: new Date(now - 120 * day) }, // inativo demais
    ])
    mocks.consentFindMany.mockResolvedValue([{ normalizedPhone: '5531900000001' }])
    const opportunities = await generateOpportunities()
    const repeat = opportunities.find(o => o.type === 'REPEAT_PURCHASE')
    expect(repeat).toBeDefined()
    expect(repeat!.audienceCount).toBe(1)
    expect(repeat!.eligibleCount).toBe(1)
    expect(repeat!.reason).toContain('30')
    expect(repeat!.reason).toContain('90')
  })

  it('REPEAT_PURCHASE fail-closed: suppression bloqueia elegibilidade mesmo dentro da janela certa', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        abandoned_cart: { found: 0, eligible: 0 }, pix_pending: { found: 0, eligible: 0 }, boleto_pending: { found: 0, eligible: 0 },
        recent_customer: { found: 0, eligible: 0 }, vip_customer: { found: 0, eligible: 0 },
        inactive_customer: { found: 0, eligible: 0 }, engaged_no_purchase: { found: 0, eligible: 0 },
      },
      dataQuality: emptyDataQuality,
    })
    const now = Date.now()
    const day = 86400000
    mocks.orderFindMany.mockResolvedValue([{ id: 'o1', normalizedPhone: '5531900000009', sourceCreatedAt: new Date(now - 45 * day) }])
    mocks.suppressionFindMany.mockResolvedValue([{ normalizedPhone: '5531900000009' }])
    mocks.consentFindMany.mockResolvedValue([{ normalizedPhone: '5531900000009' }])
    const opportunities = await generateOpportunities()
    const repeat = opportunities.find(o => o.type === 'REPEAT_PURCHASE')
    expect(repeat!.audienceCount).toBe(1)
    expect(repeat!.eligibleCount).toBe(0)
    expect(repeat!.blockedCount).toBe(1)
  })

  it('REPEAT_PURCHASE filtra pedidos no banco pela janela de INACTIVE_DAYS, em vez de buscar todo o histórico — reproduzido ao vivo como um hang de 20s+ no Preview (connection_limit=2) antes desta correção', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        abandoned_cart: { found: 0, eligible: 0 }, pix_pending: { found: 0, eligible: 0 }, boleto_pending: { found: 0, eligible: 0 },
        recent_customer: { found: 0, eligible: 0 }, vip_customer: { found: 0, eligible: 0 },
        inactive_customer: { found: 0, eligible: 0 }, engaged_no_purchase: { found: 0, eligible: 0 },
      },
      dataQuality: emptyDataQuality,
    })
    mocks.orderFindMany.mockResolvedValue([])
    await generateOpportunities()
    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sourceCreatedAt: expect.objectContaining({ gte: expect.any(Date) }) }),
    }))
    const call = mocks.orderFindMany.mock.calls[0][0]
    const ageDays = (Date.now() - call.where.sourceCreatedAt.gte.getTime()) / 86400000
    expect(ageDays).toBeCloseTo(90, 0)
  })
})
