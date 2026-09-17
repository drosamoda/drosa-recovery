import { beforeEach, describe, expect, it, vi } from 'vitest'

// Evidence Enrichment v1 — prova, com dados MOCADOS (nunca reais nesta sessão:
// sem acesso a banco/API ao vivo), que o mecanismo funciona nos dois sentidos:
// com evidência real comprovada, a flag vira true e o candidateProduct é
// populado (sempre via Product Truth — nunca o id bruto do payload sozinho);
// sem evidência, tudo volta ao estado NO_EVIDENCE já testado em
// strategyLab.test.ts. Nenhuma chamada de rede real acontece aqui.
const mocks = vi.hoisted(() => ({
  abandonedCheckoutFindMany: vi.fn(),
  orderFindMany: vi.fn(),
  productTruthVerify: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    abandonedCheckout: { findMany: mocks.abandonedCheckoutFindMany },
    order: { findMany: mocks.orderFindMany },
  },
}))

vi.mock('../../services/productTruthService', () => ({
  productTruthService: { verify: mocks.productTruthVerify },
}))

import { enrichOpportunityEvidence } from '../../services/campaignEvidenceService'
import { Opportunity } from '../../services/aiOpportunityEngine'
import { ProductTruth } from '../../services/productTruthService'

const dataQuality = { historyTruncated: false, consentSourceConfigured: true, metaTemplatesVerified: true }

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp_x', type: 'ABANDONED_CART', title: 'x', reason: 'x',
    audienceCount: 10, eligibleCount: 5, blockedCount: 5,
    recommendedTiming: 'x', recommendedChannel: 'whatsapp', recommendedProduct: null,
    confidence: 'medium', evidence: { topBlockers: [], dataQuality, template: 'x' },
    generatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function realProduct(overrides: Partial<ProductTruth> = {}): ProductTruth {
  return {
    productId: 'p1', name: 'Vestido Real', url: 'https://loja.test/p1', image: null,
    price: 199, compareAtPrice: null, variants: 1, colors: ['Azul'], sizes: ['M'],
    stockStatus: 'in_stock', description: 'Vestido real confirmado.', updatedAt: '2026-01-01',
    ...overrides,
  }
}

describe('campaignEvidenceService — ABANDONED_CART', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('NO_EVIDENCE: sem URL válida e sem product_id no payload armazenado (formato real hoje: só name/quantity)', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: '', rawPayload: { products: [{ name: 'Camiseta', quantity: 1 }] } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(evidence.evidenceFlags.hasRecoveryUrlEvidence).toBe(false)
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(false)
    expect(evidence.candidateProducts).toHaveLength(0)
  })

  it('REAL_EVIDENCE: URL de recuperação real e válida presente → hasRecoveryUrlEvidence=true', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/abc123', rawPayload: { products: [{ name: 'Camiseta', quantity: 1 }] } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(evidence.evidenceFlags.hasRecoveryUrlEvidence).toBe(true)
  })

  it('URL de domínio estranho (não confiável) não conta como evidência real', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: 'https://attacker.example.com/checkout/abc123', rawPayload: {} },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(evidence.evidenceFlags.hasRecoveryUrlEvidence).toBe(false)
  })

  it('REAL_EVIDENCE: product_id real no payload armazenado é confirmado via Product Truth e vira candidateProduct', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/abc123', rawPayload: { products: [{ name: 'Vestido', quantity: 1, product_id: 'p1' }] } },
    ])
    mocks.productTruthVerify.mockResolvedValue({ verified: true, product: realProduct() })

    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(true)
    expect(evidence.evidenceFlags.hasStockEvidence).toBe(true)
    expect(evidence.candidateProducts).toEqual([
      { productId: 'p1', name: 'Vestido Real', price: 199, compareAtPrice: null, stockStatus: 'in_stock', colors: ['Azul'], sizes: ['M'], url: 'https://loja.test/p1' },
    ])
    expect(mocks.productTruthVerify).toHaveBeenCalledWith('p1')
  })

  it('um product_id que a Nuvemshop não confirma (produto removido/id inválido) nunca vira candidateProduct', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/abc123', rawPayload: { products: [{ name: 'Vestido', quantity: 1, product_id: 'p-removido' }] } },
    ])
    mocks.productTruthVerify.mockResolvedValue({ verified: false, product: null })

    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(evidence.candidateProducts).toHaveLength(0)
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(false)
  })

  it('deduplica product_id repetido entre checkouts amostrados — Product Truth chamado uma vez por id único', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/a', rawPayload: { products: [{ product_id: 'p1' }] } },
      { abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/b', rawPayload: { products: [{ product_id: 'p1' }] } },
    ])
    mocks.productTruthVerify.mockResolvedValue({ verified: true, product: realProduct() })

    await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(mocks.productTruthVerify).toHaveBeenCalledTimes(1)
  })

  it('fail-closed: erro do Prisma (ex.: conexão indisponível) nunca propaga — vira evidência vazia', async () => {
    mocks.abandonedCheckoutFindMany.mockRejectedValue(new Error('connection refused'))
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(false)
    expect(evidence.evidenceFlags.hasRecoveryUrlEvidence).toBe(false)
    expect(evidence.candidateProducts).toHaveLength(0)
  })
})

describe('campaignEvidenceService — PIX_PENDING / BOLETO_PENDING', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('NO_EVIDENCE: nenhum campo de prazo/vencimento explícito no payload (formato real hoje)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { paymentMethod: 'pix', rawPayload: { payment_details: { method: 'pix' } } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(false)
  })

  it('REAL_EVIDENCE: campo explícito de expiração no payload → hasPaymentExpiryEvidence=true (Pix)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { paymentMethod: 'pix', rawPayload: { payment_details: { method: 'pix', pix_expiration_date: '2026-09-20T00:00:00Z' } } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(true)
  })

  it('REAL_EVIDENCE: campo explícito de vencimento no payload → hasPaymentExpiryEvidence=true (boleto)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { paymentMethod: 'boleto', rawPayload: { payment_details: { method: 'boleto', due_date: '2026-09-25' } } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'BOLETO_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(true)
  })

  it('não deriva prazo pela idade do pedido — sem campo explícito, mesmo um pedido muito antigo continua sem evidência', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { paymentMethod: 'boleto', rawPayload: { payment_details: { method: 'boleto' }, created_at: '2020-01-01' } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'BOLETO_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(false)
  })

  it('filtra pedidos pelo método de pagamento correto (Pix não conta boleto e vice-versa)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { paymentMethod: 'boleto', rawPayload: { due_date: '2026-09-25' } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(false)
  })
})

describe('campaignEvidenceService — RECENT_CUSTOMER / REPEAT_PURCHASE / VIP / WINBACK (histórico de compra)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it.each(['RECENT_CUSTOMER', 'REPEAT_PURCHASE', 'VIP', 'WINBACK'] as const)('%s: produto real comprado vira purchasedProducts (contexto), NUNCA hasCandidateProducts sozinho', async (type) => {
    mocks.orderFindMany.mockResolvedValue([
      { rawPayload: { products: [{ name: 'Vestido', quantity: 1, product_id: 'p1' }] } },
    ])
    mocks.productTruthVerify.mockResolvedValue({ verified: true, product: realProduct() })

    const evidence = await enrichOpportunityEvidence(opportunity({ type }))
    expect(evidence.purchasedProducts).toHaveLength(1)
    expect(evidence.purchasedProducts[0].productId).toBe('p1')
    // Contexto de compra passada não é o mesmo que "produto candidato para recomendar" —
    // não existe regra de cross-sell determinística implementada ainda (missão, seção 4).
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(false)
    expect(evidence.candidateProducts).toHaveLength(0)
  })

  it('hasCategoryEvidence permanece false mesmo com histórico real — nenhum categoryId existe na integração atual', async () => {
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'WINBACK' }))
    expect(evidence.evidenceFlags.hasCategoryEvidence).toBe(false)
  })
})

describe('campaignEvidenceService — ENGAGED_NO_PURCHASE', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('nunca tenta associar produto a partir de texto de conversa — evidência sempre vazia, mesmo com dados no Prisma', async () => {
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ENGAGED_NO_PURCHASE' }))
    expect(evidence.candidateProducts).toHaveLength(0)
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(false)
    expect(mocks.orderFindMany).not.toHaveBeenCalled()
    expect(mocks.abandonedCheckoutFindMany).not.toHaveBeenCalled()
  })
})
