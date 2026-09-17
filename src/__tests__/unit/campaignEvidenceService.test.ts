import { beforeEach, describe, expect, it, vi } from 'vitest'

// Evidence Enrichment v1 — prova, com dados MOCADOS (nunca reais nesta sessão:
// sem acesso a banco/API ao vivo), que o mecanismo funciona nos dois sentidos:
// com evidência real comprovada, a flag vira true e o candidateProduct é
// populado (sempre via Product Truth — nunca o id bruto do payload sozinho);
// sem evidência, tudo volta ao estado NO_EVIDENCE já testado em
// strategyLab.test.ts. Nenhuma chamada de rede real acontece aqui.
//
// v1.2 — Segment-Scoped Evidence: antes desta correção, os enrich* liam
// "N linhas mais recentes desse tipo, globalmente" via prisma.findMany
// diretamente. Agora eles primeiro resolvem os entityIds GENUINAMENTE
// elegíveis desta oportunidade específica (remarketingPreview()/
// runAbandonedCheckoutsPreview()/repeatPurchaseCandidates(), filtrados por
// reasons.length === 0) e só então buscam esses ids no Prisma — por isso
// esses três também são mocados aqui, e várias asserções checam o `where`
// exato passado ao findMany para provar que nenhum id de fora do segmento
// pôde entrar na amostra.
const mocks = vi.hoisted(() => ({
  abandonedCheckoutFindMany: vi.fn(),
  orderFindMany: vi.fn(),
  productTruthVerify: vi.fn(),
  runAbandonedCheckoutsPreview: vi.fn(),
  remarketingPreview: vi.fn(),
  repeatPurchaseCandidates: vi.fn(),
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

vi.mock('../../jobs/previewAbandonedCheckouts', () => ({
  runAbandonedCheckoutsPreview: mocks.runAbandonedCheckoutsPreview,
}))

vi.mock('../../services/remarketingService', () => ({
  remarketingPreview: mocks.remarketingPreview,
}))

vi.mock('../../services/aiOpportunityEngine', () => ({
  repeatPurchaseCandidates: mocks.repeatPurchaseCandidates,
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
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: um checkout elegível — testes que precisam de outra
    // configuração (amostra vazia, múltiplos ids) sobrescrevem explicitamente.
    mocks.runAbandonedCheckoutsPreview.mockResolvedValue({ data: [{ checkoutId: 'c1', eligible: true, reasons: [] }] })
  })

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
    mocks.runAbandonedCheckoutsPreview.mockResolvedValue({ data: [
      { checkoutId: 'a', eligible: true, reasons: [] },
      { checkoutId: 'b', eligible: true, reasons: [] },
    ] })
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

  // Segment-Scoped Evidence: nenhum checkout elegível PARA ESTA oportunidade
  // → evidência vazia sem sequer consultar o Prisma (nunca cai de volta para
  // uma amostra global "só para não ficar vazio").
  it('nenhum checkout elegível nesta oportunidade específica → evidência vazia, sem consultar o Prisma', async () => {
    mocks.runAbandonedCheckoutsPreview.mockResolvedValue({ data: [] })
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(mocks.abandonedCheckoutFindMany).not.toHaveBeenCalled()
    expect(evidence.candidateProducts).toHaveLength(0)
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(false)
  })

  // Correção obrigatória (Live Evidence Probe v1.1, seção 5): product_id e
  // variant_id são campos DISTINTOS no payload real confirmado por amostra —
  // nunca podem ser tratados como intercambiáveis.
  it('variant_id SEM product_id nunca é tratado como productId — não chama Product Truth, não vira candidateProduct', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/abc123', rawPayload: { products: [{ name: 'Vestido', quantity: 1, variant_id: 'v999' }] } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(mocks.productTruthVerify).not.toHaveBeenCalled()
    expect(mocks.productTruthVerify).not.toHaveBeenCalledWith('v999')
    expect(evidence.candidateProducts).toHaveLength(0)
    expect(evidence.evidenceFlags.hasCandidateProducts).toBe(false)
  })

  it('product_id E variant_id presentes juntos (formato real confirmado): só product_id é verificado, nunca o variant_id', async () => {
    mocks.abandonedCheckoutFindMany.mockResolvedValue([
      { abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/abc123', rawPayload: { products: [{ name: 'Vestido', quantity: 1, product_id: 'p1', variant_id: 'v1' }] } },
    ])
    mocks.productTruthVerify.mockResolvedValue({ verified: true, product: realProduct() })

    await enrichOpportunityEvidence(opportunity({ type: 'ABANDONED_CART' }))
    expect(mocks.productTruthVerify).toHaveBeenCalledTimes(1)
    expect(mocks.productTruthVerify).toHaveBeenCalledWith('p1')
    expect(mocks.productTruthVerify).not.toHaveBeenCalledWith('v1')
  })
})

describe('campaignEvidenceService — PIX_PENDING / BOLETO_PENDING', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        pix_pending: { data: [{ entityId: 'o1', maskedPhone: '***00', reasons: [] }] },
        boleto_pending: { data: [{ entityId: 'o1', maskedPhone: '***00', reasons: [] }] },
      },
    })
  })

  it('NO_EVIDENCE: nenhum campo de prazo/vencimento explícito no payload (formato real hoje)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { rawPayload: { payment_details: { method: 'pix' } } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(false)
  })

  it('REAL_EVIDENCE: campo explícito de expiração no payload → hasPaymentExpiryEvidence=true (Pix)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { rawPayload: { payment_details: { method: 'pix', pix_expiration_date: '2026-09-20T00:00:00Z' } } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(true)
  })

  it('REAL_EVIDENCE: campo explícito de vencimento no payload → hasPaymentExpiryEvidence=true (boleto)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { rawPayload: { payment_details: { method: 'boleto', due_date: '2026-09-25' } } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'BOLETO_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(true)
  })

  it('não deriva prazo pela idade do pedido — sem campo explícito, mesmo um pedido muito antigo continua sem evidência', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { rawPayload: { payment_details: { method: 'boleto' }, created_at: '2020-01-01' } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'BOLETO_PENDING' }))
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(false)
  })

  // Antes desta correção, o filtro por método (Pix vs. boleto) acontecia em
  // memória dentro de campaignEvidenceService, sobre uma amostra global. Essa
  // responsabilidade agora é do PRÓPRIO segmento de remarketingPreview (cada
  // segmento já só contém as entidades do método correto) — o que este
  // arquivo precisa provar é que cada tipo consulta o segmento certo.
  it('PIX_PENDING consulta o segmento pix_pending (nunca boleto_pending) em remarketingPreview', async () => {
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(mocks.remarketingPreview).toHaveBeenCalledWith('pix_pending')
    expect(mocks.remarketingPreview).not.toHaveBeenCalledWith('boleto_pending')
  })

  it('BOLETO_PENDING consulta o segmento boleto_pending (nunca pix_pending) em remarketingPreview', async () => {
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    await enrichOpportunityEvidence(opportunity({ type: 'BOLETO_PENDING' }))
    expect(mocks.remarketingPreview).toHaveBeenCalledWith('boleto_pending')
    expect(mocks.remarketingPreview).not.toHaveBeenCalledWith('pix_pending')
  })

  // L) PIX/BOLETO ignoram entityIds cujo reasons não está vazio — um pedido
  // bloqueado por opt-out/suppression/cooldown nunca pode influenciar a
  // estratégia, mesmo estando no mesmo segmento.
  it('L) PIX_PENDING ignora entityIds cujo reasons não está vazio (bloqueados por consentimento/suppression/cooldown)', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: { pix_pending: { data: [
        { entityId: 'ok-order', maskedPhone: '***00', reasons: [] },
        { entityId: 'blocked-order', maskedPhone: '***11', reasons: ['opt_out'] },
      ] } },
    })
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(mocks.orderFindMany).toHaveBeenCalledWith({ where: { id: { in: ['ok-order'] } }, select: { rawPayload: true } })
  })

  it('nenhum pedido elegível neste segmento → evidência vazia sem consultar o Prisma', async () => {
    mocks.remarketingPreview.mockResolvedValue({ segments: { pix_pending: { data: [] } } })
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'PIX_PENDING' }))
    expect(mocks.orderFindMany).not.toHaveBeenCalled()
    expect(evidence.evidenceFlags.hasPaymentExpiryEvidence).toBe(false)
  })
})

describe('campaignEvidenceService — RECENT_CUSTOMER / REPEAT_PURCHASE / VIP / WINBACK (histórico de compra)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        recent_customer: { data: [{ entityId: 'o1', maskedPhone: '***00', reasons: [] }] },
        vip_customer: { data: [{ entityId: 'o1', maskedPhone: '***00', reasons: [] }] },
        inactive_customer: { data: [{ entityId: 'o1', maskedPhone: '***00', reasons: [] }] },
      },
    })
    mocks.repeatPurchaseCandidates.mockResolvedValue({ found: 1, eligible: 1, reasons: {}, dataQuality, eligibleOrderIds: ['o1'] })
  })

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

  // Caminho confirmado pela amostra real do Preview: quando o pedido precisou de um fetch de
  // detalhe adicional (orderService.resolveOrderPayload), o produto fica aninhado em
  // rawPayload.fetchedOrderPayload.products[], não em rawPayload.products[] diretamente.
  it('encontra product_id dentro de rawPayload.fetchedOrderPayload.products[] (pedido com fetch de detalhe)', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { rawPayload: { originalWebhookPayload: { id: 123, event: 'order/paid' }, fetchedOrderPayload: { products: [{ name: 'Vestido', quantity: 1, product_id: 'p1', variant_id: 'v1' }] } } },
    ])
    mocks.productTruthVerify.mockResolvedValue({ verified: true, product: realProduct() })

    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'RECENT_CUSTOMER' }))
    expect(evidence.purchasedProducts).toHaveLength(1)
    expect(evidence.purchasedProducts[0].productId).toBe('p1')
    expect(mocks.productTruthVerify).toHaveBeenCalledWith('p1')
    expect(mocks.productTruthVerify).not.toHaveBeenCalledWith('v1')
  })

  it('rawPayload.originalWebhookPayload nunca é vasculhado por produtos — confirmado pela amostra real que ele só tem id/event/store_id', async () => {
    mocks.orderFindMany.mockResolvedValue([
      { rawPayload: { originalWebhookPayload: { id: 123, event: 'order/paid', store_id: 999 } } },
    ])
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'RECENT_CUSTOMER' }))
    expect(evidence.purchasedProducts).toHaveLength(0)
    expect(mocks.productTruthVerify).not.toHaveBeenCalled()
  })

  // I) VIP só pode provar fatos sobre clientes VIP elegíveis — nunca sobre o
  // segmento inactive_customer (WINBACK) nem qualquer outro.
  it('I) VIP usa SOMENTE os entityIds elegíveis do segmento vip_customer — nunca de outro segmento', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        vip_customer: { data: [{ entityId: 'vip-order-1', maskedPhone: '***00', reasons: [] }] },
        inactive_customer: { data: [{ entityId: 'winback-order-9', maskedPhone: '***11', reasons: [] }] },
      },
    })
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    await enrichOpportunityEvidence(opportunity({ type: 'VIP' }))
    expect(mocks.remarketingPreview).toHaveBeenCalledWith('vip_customer')
    expect(mocks.orderFindMany).toHaveBeenCalledWith({ where: { id: { in: ['vip-order-1'] } }, select: { rawPayload: true } })
  })

  // J) WINBACK (segmento inactive_customer) só pode provar fatos sobre
  // clientes inativos elegíveis — nunca sobre VIPs nem sobre nenhum outro tipo.
  it('J) WINBACK usa SOMENTE os entityIds elegíveis do segmento inactive_customer — nunca de outro segmento', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: {
        inactive_customer: { data: [{ entityId: 'winback-order-1', maskedPhone: '***00', reasons: [] }] },
        vip_customer: { data: [{ entityId: 'vip-order-9', maskedPhone: '***11', reasons: [] }] },
      },
    })
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    await enrichOpportunityEvidence(opportunity({ type: 'WINBACK' }))
    expect(mocks.remarketingPreview).toHaveBeenCalledWith('inactive_customer')
    expect(mocks.orderFindMany).toHaveBeenCalledWith({ where: { id: { in: ['winback-order-1'] } }, select: { rawPayload: true } })
  })

  // K) RECENT_CUSTOMER nunca usa um pedido de um cliente fora do próprio
  // segmento (ex.: um cliente VIP ou inativo não pode "vazar" para cá).
  it('K) RECENT_CUSTOMER nunca inclui um pedido de fora do segmento recent_customer', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: { recent_customer: { data: [{ entityId: 'recent-order-1', maskedPhone: '***00', reasons: [] }] } },
    })
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    await enrichOpportunityEvidence(opportunity({ type: 'RECENT_CUSTOMER' }))
    expect(mocks.orderFindMany).toHaveBeenCalledWith({ where: { id: { in: ['recent-order-1'] } }, select: { rawPayload: true } })
  })

  // M) Prova direta do bug corrigido nesta rodada: um pedido pago qualquer,
  // não relacionado à audiência elegível desta oportunidade, jamais pode
  // aparecer em purchasedProducts — porque o Prisma nunca é sequer consultado
  // com o id desse pedido (só com os ids do próprio segmento).
  it('M) um pedido pago global não relacionado ao segmento nunca aparece em purchasedProducts', async () => {
    mocks.remarketingPreview.mockResolvedValue({
      segments: { recent_customer: { data: [{ entityId: 'segment-order', maskedPhone: '***00', reasons: [] }] } },
    })
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: { products: [{ product_id: 'p-segment' }] } }])
    mocks.productTruthVerify.mockResolvedValue({ verified: true, product: realProduct({ productId: 'p-segment' }) })

    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'RECENT_CUSTOMER' }))

    expect(mocks.orderFindMany).toHaveBeenCalledWith({ where: { id: { in: ['segment-order'] } }, select: { rawPayload: true } })
    expect(evidence.purchasedProducts).toEqual([
      { productId: 'p-segment', name: 'Vestido Real', price: 199, compareAtPrice: null, stockStatus: 'in_stock', colors: ['Azul'], sizes: ['M'], url: 'https://loja.test/p1' },
    ])
  })

  it('REPEAT_PURCHASE usa repeatPurchaseCandidates() (mesma lógica de elegibilidade da oportunidade), nunca remarketingPreview', async () => {
    mocks.orderFindMany.mockResolvedValue([{ rawPayload: {} }])
    await enrichOpportunityEvidence(opportunity({ type: 'REPEAT_PURCHASE' }))
    expect(mocks.repeatPurchaseCandidates).toHaveBeenCalledTimes(1)
    expect(mocks.remarketingPreview).not.toHaveBeenCalled()
    expect(mocks.orderFindMany).toHaveBeenCalledWith({ where: { id: { in: ['o1'] } }, select: { rawPayload: true } })
  })

  it('nenhum cliente elegível neste segmento → evidência vazia sem consultar o Prisma', async () => {
    mocks.remarketingPreview.mockResolvedValue({ segments: { vip_customer: { data: [] } } })
    const evidence = await enrichOpportunityEvidence(opportunity({ type: 'VIP' }))
    expect(mocks.orderFindMany).not.toHaveBeenCalled()
    expect(evidence.purchasedProducts).toHaveLength(0)
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
    expect(mocks.remarketingPreview).not.toHaveBeenCalled()
  })
})
