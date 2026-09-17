import { prisma } from '../config/prisma'
import { validRecoveryUrl } from './abandonedCheckoutEligibilityService'
import { productTruthService } from './productTruthService'
import { Opportunity, repeatPurchaseCandidates } from './aiOpportunityEngine'
import { remarketingPreview, Segment } from './remarketingService'
import { runAbandonedCheckoutsPreview } from '../jobs/previewAbandonedCheckouts'
import { EvidenceFlags } from './ai/strategyPlaybook'
import { CampaignPromptInput } from './ai/aiProvider'

// Evidence Enrichment v1 — única responsabilidade: transformar uma
// Opportunity real em fatos COMPROVADOS (nunca inferidos, nunca por
// intuição). Não gera copy, não recomenda produto por afinidade, não decide
// elegibilidade (isso já vem pronto de remarketingService/
// abandonedCheckoutEligibilityService). Cada flag só vira true quando o dado
// que ela representa foi genuinamente encontrado nos dados já existentes
// (AbandonedCheckout, Order, Product Truth) — nunca por heurística textual.
//
// v1.1 — Live Evidence Probe: uma inspeção read-only real do Preview (ver
// docs/evidence-enrichment-report.md) corrigiu uma conclusão errada do
// relatório anterior, que assumiu ausência de product_id só porque a
// interface TypeScript (`NuvemshopCheckoutPayload`/`NuvemshopOrderPayload`)
// não o modelava. O payload REAL armazenado é muito mais rico — a integração
// salva a resposta completa da Nuvemshop, e a interface só documentava um
// subconjunto. Os caminhos abaixo (CHECKOUT_PRODUCT_PATHS/ORDER_PRODUCT_PATHS)
// são exatamente os confirmados pela amostra real, nada além disso.
//
// Amostragem, não varredura completa: gerar UMA campanha nunca precisa
// inspecionar as centenas de linhas elegíveis, só uma amostra pequena — evita
// N+1 contra a Nuvemshop e contra o Postgres sob o connection_limit=2 do
// Preview.
//
// v1.2 — Segment-Scoped Evidence (correção crítica): a amostra NUNCA é mais
// "os N mais recentes desse tipo, globalmente". Ela vem SEMPRE dos ids de
// entidade genuinamente elegíveis desta oportunidade específica
// (remarketingPreview(segmento)/repeatPurchaseCandidates(), filtrados por
// reasons.length === 0 — a mesma elegibilidade real já usada para decidir
// quem pode receber a campanha). Uma oportunidade VIP só pode provar fatos
// sobre clientes VIP elegíveis; nunca sobre os 5 pedidos pagos mais recentes
// da loja inteira. O telefone nunca sai dessas funções: só o id interno
// (Order.id/AbandonedCheckout.id) é usado para buscar o rawPayload.
const MAX_SAMPLE_ROWS = 5
const MAX_CANDIDATE_PRODUCTS = 3

export type CandidateProduct = CampaignPromptInput['candidateProducts'][number]

export interface EvidenceSource {
  check: string
  result: string
}

export interface CampaignEvidence {
  candidateProducts: CandidateProduct[]
  purchasedProducts: CandidateProduct[]
  cartProducts: CandidateProduct[]
  evidenceFlags: EvidenceFlags
  evidenceSources: EvidenceSource[]
}

function emptyFlags(): EvidenceFlags {
  return {
    hasCandidateProducts: false,
    hasCategoryEvidence: false,
    hasStockEvidence: false,
    hasNewnessEvidence: false,
    hasPaymentExpiryEvidence: false,
    hasSecondCopySupport: false,
    hasPromotionEvidence: false,
    hasRecoveryUrlEvidence: false,
  }
}

function emptyEvidence(sources: EvidenceSource[]): CampaignEvidence {
  return { candidateProducts: [], purchasedProducts: [], cartProducts: [], evidenceFlags: emptyFlags(), evidenceSources: sources }
}

function toCandidateProduct(product: NonNullable<Awaited<ReturnType<typeof productTruthService.getById>>>): CandidateProduct {
  return {
    productId: product.productId,
    name: product.name,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    stockStatus: product.stockStatus,
    colors: product.colors,
    sizes: product.sizes,
    url: product.url,
  }
}

// Shape de um item de produto tal como REALMENTE armazenado hoje — confirmado
// por inspeção read-only real do Preview (não só pela interface TypeScript
// estreita que a integração usa para o resto do código; o payload salvo é a
// resposta completa da Nuvemshop, bem mais rica). `product_id` e
// `variant_id` são campos DISTINTOS no payload real — nunca o mesmo id.
interface StoredProductLine { product_id?: string | number; variant_id?: string | number; name?: string; quantity?: number }

interface ExtractedProductRef { productId: string | null; variantId: string | null }

function getByPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) return (acc as Record<string, unknown>)[key]
    return undefined
  }, value)
}

function toNonEmptyString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text ? text : null
}

// Caminhos EXATOS confirmados por amostra real (read-only) do Preview em
// 2026-09 — ver docs/evidence-enrichment-report.md. De propósito, não é um
// crawler genérico que vasculha qualquer campo: só estes caminhos, porque só
// estes foram observados em dados reais.
//
// AbandonedCheckout: rawPayload.products[] (raiz, sem aninhamento).
// Order: rawPayload.products[] quando o webhook já veio completo, OU
// rawPayload.fetchedOrderPayload.products[] quando o pedido precisou de um
// fetch de detalhe adicional (orderService.resolveOrderPayload) — as duas
// formas foram confirmadas na mesma amostra de 3 pedidos reais.
const CHECKOUT_PRODUCT_PATHS = ['products']
const ORDER_PRODUCT_PATHS = ['products', 'fetchedOrderPayload.products']

function extractProductRefs(rawPayload: unknown, paths: string[]): ExtractedProductRef[] {
  if (!rawPayload || typeof rawPayload !== 'object') return []
  const refs: ExtractedProductRef[] = []
  for (const path of paths) {
    const value = getByPath(rawPayload, path)
    if (!Array.isArray(value)) continue
    for (const item of value as StoredProductLine[]) {
      const productId = toNonEmptyString(item?.product_id)
      const variantId = toNonEmptyString(item?.variant_id)
      if (productId || variantId) refs.push({ productId, variantId })
    }
  }
  return refs
}

// PRODUCT_ID ≠ VARIANT_ID — correção obrigatória desta rodada. Só productId
// comprovado é verificado contra Product Truth (GET /products/:id da
// Nuvemshop). Um variantId sozinho NUNCA é tratado como productId: não existe
// hoje uma função que resolva variante → produto pai de forma confirmada
// pela API (fetchProductById só aceita um id de produto), então fica
// fail-closed — não vira candidato — em vez de arriscar chamar
// /products/:variantId com um id que pode nem ser de produto.
async function verifyRealProducts(refs: ExtractedProductRef[]): Promise<{ candidates: CandidateProduct[]; unresolvedVariantIds: string[] }> {
  const productIds = [...new Set(refs.map((r) => r.productId).filter((id): id is string => id !== null))].slice(0, MAX_CANDIDATE_PRODUCTS)
  const unresolvedVariantIds = [...new Set(refs.filter((r) => !r.productId && r.variantId).map((r) => r.variantId as string))]

  if (!productIds.length) return { candidates: [], unresolvedVariantIds }
  const results = await Promise.all(productIds.map(async (id) => {
    const { verified, product } = await productTruthService.verify(id)
    return verified && product ? toCandidateProduct(product) : null
  }))
  return { candidates: results.filter((p): p is CandidateProduct => p !== null), unresolvedVariantIds }
}

// Nunca deriva vencimento pela idade do pedido (syncBoletoExpiring.ts já usa
// uma janela sintética para o job de notificação, o que é uma decisão
// operacional diferente de "comprovar" um prazo real) — só reconhece um
// campo EXPLÍCITO de prazo/vencimento se ele existir no payload. Varredura
// rasa (profundidade 2) já alcança rawPayload.fetchedOrderPayload.payment_details
// na amostra real confirmada — suficiente sem precisar de mais profundidade.
const EXPIRY_KEY_PATTERN = /expir|due_?date|vencimento|boleto_expiration|pix_expiration/i

function findExpiryLikeKey(value: unknown, depth = 0): string | null {
  if (depth > 2 || !value || typeof value !== 'object') return null
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (EXPIRY_KEY_PATTERN.test(key)) return key
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const found = findExpiryLikeKey(nested, depth + 1)
      if (found) return `${key}.${found}`
    }
  }
  return null
}

// Resolve os ids de entidade GENUINAMENTE elegíveis de UMA oportunidade
// específica — nunca uma amostra global. `reasons.length === 0` é a mesma
// definição de "elegível" já usada por remarketingPreview()/
// runAbandonedCheckoutsPreview() para decidir quem pode receber a campanha;
// nenhuma regra de elegibilidade nova é inventada aqui. Retorna só ids
// (Order.id/AbandonedCheckout.id) — nunca telefone.
async function eligibleAbandonedCheckoutIds(): Promise<string[]> {
  const preview = await runAbandonedCheckoutsPreview()
  return preview.data.filter((item) => item.eligible).map((item) => item.checkoutId).slice(0, MAX_SAMPLE_ROWS)
}

async function eligibleSegmentOrderIds(segmentKey: Exclude<Segment, 'abandoned_cart'>): Promise<string[]> {
  const preview = await remarketingPreview(segmentKey)
  const segment = preview.segments[segmentKey] as { data?: Array<{ entityId: string; reasons: string[] }> } | undefined
  return (segment?.data ?? []).filter((item) => item.reasons.length === 0).map((item) => item.entityId).slice(0, MAX_SAMPLE_ROWS)
}

async function eligibleRepeatPurchaseOrderIds(): Promise<string[]> {
  const { eligibleOrderIds } = await repeatPurchaseCandidates()
  return eligibleOrderIds.slice(0, MAX_SAMPLE_ROWS)
}

async function enrichAbandonedCart(checkoutIds: string[]): Promise<CampaignEvidence> {
  if (!checkoutIds.length) {
    return emptyEvidence([{ check: 'abandoned_checkout (audiência elegível desta oportunidade)', result: 'nenhum checkout elegível (reasons vazio) encontrado para esta oportunidade — sem amostra, sem evidência' }])
  }
  const sample = await prisma.abandonedCheckout.findMany({
    where: { id: { in: checkoutIds } },
    select: { abandonedCheckoutUrl: true, rawPayload: true },
  })

  const hasRecoveryUrlEvidence = sample.some((c) => validRecoveryUrl((c.abandonedCheckoutUrl ?? '').trim()))
  const refs = sample.flatMap((c) => extractProductRefs(c.rawPayload, CHECKOUT_PRODUCT_PATHS))
  const { candidates: candidateProducts, unresolvedVariantIds } = await verifyRealProducts(refs)

  return {
    candidateProducts,
    purchasedProducts: [],
    cartProducts: candidateProducts,
    evidenceFlags: {
      ...emptyFlags(),
      hasCandidateProducts: candidateProducts.length > 0,
      hasStockEvidence: candidateProducts.some((p) => p.stockStatus !== 'unknown'),
      hasRecoveryUrlEvidence,
    },
    evidenceSources: [
      { check: 'abandoned_checkout.recovery_url (amostra da audiência elegível desta oportunidade)', result: `${sample.length} checkout(s) elegível(is) amostrados; URL real e válida encontrada: ${hasRecoveryUrlEvidence}` },
      { check: 'abandoned_checkout.rawPayload.products[].product_id', result: refs.length ? `${refs.length} referência(s) de produto encontradas, ${candidateProducts.length} confirmada(s) via Product Truth` : 'nenhuma referência de produto encontrada na amostra' },
      ...(unresolvedVariantIds.length ? [{ check: 'variant_id sem product_id', result: `${unresolvedVariantIds.length} variantId(s) sem productId correspondente — não resolvidos (fail-closed, nunca chamado como se fosse productId)` }] : []),
    ],
  }
}

async function enrichPaymentPending(orderIds: string[]): Promise<CampaignEvidence> {
  if (!orderIds.length) {
    return emptyEvidence([{ check: 'order (audiência elegível desta oportunidade)', result: 'nenhum pedido elegível (reasons vazio) encontrado para esta oportunidade — sem amostra, sem evidência' }])
  }
  // Já vem filtrado por método (pix/boleto) por remarketingPreview() ao
  // montar o segmento — nenhum filtro de método adicional é necessário aqui.
  const sample = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { rawPayload: true },
  })

  const expiryKeysFound = sample
    .map((o) => findExpiryLikeKey(o.rawPayload))
    .filter((k): k is string => k !== null)

  return {
    ...emptyEvidence([]),
    evidenceFlags: { ...emptyFlags(), hasPaymentExpiryEvidence: expiryKeysFound.length > 0 },
    evidenceSources: [
      { check: 'order.rawPayload (campo de prazo/vencimento explícito, incl. fetchedOrderPayload.payment_details) — audiência elegível desta oportunidade', result: expiryKeysFound.length ? `campo(s) encontrado(s): ${[...new Set(expiryKeysFound)].join(', ')}` : `nenhum campo de prazo/vencimento explícito em ${sample.length} pedido(s) elegível(is) amostrado(s) — confirmado por inspeção real do payload completo (payment_details só tem method/installments/credit_card_company)` },
    ],
  }
}

async function enrichPurchaseHistory(orderIds: string[]): Promise<CampaignEvidence> {
  if (!orderIds.length) {
    return {
      ...emptyEvidence([{ check: 'order (audiência elegível desta oportunidade)', result: 'nenhum pedido elegível (reasons vazio) encontrado para esta oportunidade — sem amostra, sem evidência' }]),
    }
  }
  const sample = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { rawPayload: true },
  })

  const refs = sample.flatMap((o) => extractProductRefs(o.rawPayload, ORDER_PRODUCT_PATHS))
  const { candidates: purchasedProducts, unresolvedVariantIds } = await verifyRealProducts(refs)

  return {
    candidateProducts: [],
    purchasedProducts,
    cartProducts: [],
    evidenceFlags: {
      ...emptyFlags(),
      // purchasedProducts é CONTEXTO de compra anterior, nunca um produto
      // recomendado — por isso não vira hasCandidateProducts sozinho, mesmo
      // agora que a extração real funciona (missão anterior, seção 4: "não
      // dizer que uma peça combina sem regra de recomendação real
      // implementada"). Nenhuma regra de cross-sell determinística existe
      // ainda, então isto fica false de propósito, não por limitação técnica.
      hasCandidateProducts: false,
      // Nenhum categoryId existe em NuvemshopProduct/productTruthService nem
      // no payload real amostrado (produtos têm sku/price/variant_id/etc.,
      // nunca categoria) — sem essa fonte, não há regra determinística
      // possível de afinidade de categoria.
      hasCategoryEvidence: false,
    },
    evidenceSources: [
      { check: 'order.rawPayload.products[]/fetchedOrderPayload.products[].product_id (histórico de compra da audiência elegível desta oportunidade)', result: refs.length ? `${refs.length} referência(s) encontradas, ${purchasedProducts.length} confirmada(s) via Product Truth (contexto, não recomendação)` : 'nenhuma referência de produto encontrada na amostra de pedidos elegíveis' },
      ...(unresolvedVariantIds.length ? [{ check: 'variant_id sem product_id', result: `${unresolvedVariantIds.length} variantId(s) sem productId correspondente — não resolvidos` }] : []),
      { check: 'category_id em Order/ProductTruth', result: 'AUSENTE — confirmado por inspeção real: itens de produto têm sku/price/variant_id/promotions/properties, nunca categoria' },
    ],
  }
}

// ENGAGED_NO_PURCHASE: nunca tenta adivinhar produto a partir do texto livre
// da conversa — só associaria produto a uma evidência estruturada inequívoca
// (productId, URL de produto mapeável, carrinho/pedido conhecido), e nenhuma
// dessas existe ligada a uma Conversation hoje. Por isso retorna sempre vazio,
// de propósito — não é uma lacuna a preencher depois com NLP.
function enrichEngagedNoPurchase(): CampaignEvidence {
  return emptyEvidence([
    { check: 'conversation → produto', result: 'não tentado de propósito — texto livre de WhatsApp nunca vira Product Truth automaticamente (sem productId/URL/pedido estruturado ligado à conversa)' },
  ])
}

// Mapa oportunidade → segmento real de remarketingPreview(). Cada tipo só
// pode enxergar a audiência que remarketingPreview()/repeatPurchaseCandidates()
// já provou elegível para ELE — nunca o segmento de outro tipo, nunca "todos".
export async function enrichOpportunityEvidence(opportunity: Opportunity): Promise<CampaignEvidence> {
  try {
    switch (opportunity.type) {
      case 'ABANDONED_CART':
        return await enrichAbandonedCart(await eligibleAbandonedCheckoutIds())
      case 'PIX_PENDING':
        return await enrichPaymentPending(await eligibleSegmentOrderIds('pix_pending'))
      case 'BOLETO_PENDING':
        return await enrichPaymentPending(await eligibleSegmentOrderIds('boleto_pending'))
      case 'RECENT_CUSTOMER':
        return await enrichPurchaseHistory(await eligibleSegmentOrderIds('recent_customer'))
      case 'VIP':
        return await enrichPurchaseHistory(await eligibleSegmentOrderIds('vip_customer'))
      case 'WINBACK':
        return await enrichPurchaseHistory(await eligibleSegmentOrderIds('inactive_customer'))
      case 'REPEAT_PURCHASE':
        return await enrichPurchaseHistory(await eligibleRepeatPurchaseOrderIds())
      case 'ENGAGED_NO_PURCHASE':
        return enrichEngagedNoPurchase()
      default:
        return emptyEvidence([])
    }
  } catch (error) {
    // Fail-closed: qualquer erro (timeout, conexão, payload inesperado) vira
    // "nenhuma evidência comprovada", nunca uma exceção que derruba a geração
    // da campanha nem um dado inventado no lugar do que falhou.
    return emptyEvidence([
      { check: 'evidence_enrichment', result: `falhou (${error instanceof Error ? error.message : String(error)}) — tratado como ausência de evidência` },
    ])
  }
}
