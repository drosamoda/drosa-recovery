import { prisma } from '../config/prisma'
import { validRecoveryUrl } from './abandonedCheckoutEligibilityService'
import { productTruthService } from './productTruthService'
import { Opportunity } from './aiOpportunityEngine'
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
// Amostragem, não varredura completa: gerar UMA campanha nunca precisa
// inspecionar as centenas de linhas elegíveis, só uma amostra pequena e
// determinística (mais recentes primeiro) — evita N+1 contra a Nuvemshop e
// contra o Postgres sob o connection_limit=2 do Preview.
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

// Confirma cada id via Product Truth (Nuvemshop real) ANTES de entrar no
// CampaignPromptInput — "Product Truth antes da IA": a IA nunca recebe um id
// só porque apareceu num payload armazenado, só depois de a Nuvemshop
// confirmar que o produto existe agora. Falhas de rede/timeout são
// fail-closed (produto simplesmente não entra), nunca inventadas.
async function verifyRealProductIds(rawIds: string[]): Promise<CandidateProduct[]> {
  const uniqueIds = [...new Set(rawIds.filter(Boolean))].slice(0, MAX_CANDIDATE_PRODUCTS)
  if (!uniqueIds.length) return []
  const results = await Promise.all(uniqueIds.map(async (id) => {
    const { verified, product } = await productTruthService.verify(id)
    return verified && product ? toCandidateProduct(product) : null
  }))
  return results.filter((p): p is CandidateProduct => p !== null)
}

// Shape de um item de carrinho tal como REALMENTE armazenado hoje
// (confirmado por leitura de código: só name/quantity, nunca um id — ver
// docs/evidence-enrichment-report.md). Mantido explícito, em vez de
// `unknown`, para o dia em que a ingestão passar a capturar um id real: o
// extractor abaixo já sabe o que procurar, só falta o dado existir.
interface StoredProductLine { name?: string; quantity?: number; product_id?: string | number; variant_id?: string | number }

function extractProductIdsFromRawPayload(rawPayload: unknown): string[] {
  if (!rawPayload || typeof rawPayload !== 'object') return []
  const products = (rawPayload as { products?: unknown }).products
  if (!Array.isArray(products)) return []
  const ids: string[] = []
  for (const item of products as StoredProductLine[]) {
    const id = item?.product_id ?? item?.variant_id
    if (id !== undefined && id !== null && String(id).trim()) ids.push(String(id).trim())
  }
  return ids
}

// Nunca deriva vencimento pela idade do pedido (syncBoletoExpiring.ts já usa
// uma janela sintética para o job de notificação, o que é uma decisão
// operacional diferente de "comprovar" um prazo real) — só reconhece um
// campo EXPLÍCITO de prazo/vencimento se ele existir no payload. Varredura
// rasa (profundidade 2) para não custar caro nem exigir manutenção a cada
// formato novo de payload.
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

async function enrichAbandonedCart(): Promise<CampaignEvidence> {
  const sample = await prisma.abandonedCheckout.findMany({
    where: { status: 'abandoned' },
    orderBy: { sourceUpdatedAt: 'desc' },
    take: MAX_SAMPLE_ROWS,
    select: { abandonedCheckoutUrl: true, rawPayload: true },
  })

  const hasRecoveryUrlEvidence = sample.some((c) => validRecoveryUrl((c.abandonedCheckoutUrl ?? '').trim()))
  const rawIds = sample.flatMap((c) => extractProductIdsFromRawPayload(c.rawPayload))
  const candidateProducts = await verifyRealProductIds(rawIds)

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
      { check: 'abandoned_checkout.recovery_url (amostra)', result: `${sample.length} checkout(s) amostrados; URL real e válida encontrada: ${hasRecoveryUrlEvidence}` },
      { check: 'abandoned_checkout.rawPayload.products[].product_id', result: rawIds.length ? `${rawIds.length} id(s) bruto(s) encontrados no payload armazenado, ${candidateProducts.length} confirmado(s) via Product Truth` : 'nenhum product_id encontrado no payload armazenado — a integração atual só guarda name/quantity por item' },
    ],
  }
}

async function enrichPaymentPending(paymentMethodPattern: RegExp): Promise<CampaignEvidence> {
  const sample = await prisma.order.findMany({
    where: { paymentStatus: 'pending', status: { notIn: ['cancelled', 'canceled', 'refunded'] } },
    orderBy: { sourceCreatedAt: 'desc' },
    take: MAX_SAMPLE_ROWS * 4, // filtra por método em memória — método não é indexado separadamente
    select: { paymentMethod: true, rawPayload: true },
  })
  const relevant = sample.filter((o) => paymentMethodPattern.test((o.paymentMethod ?? '').toLowerCase())).slice(0, MAX_SAMPLE_ROWS)

  const expiryKeysFound = relevant
    .map((o) => findExpiryLikeKey(o.rawPayload))
    .filter((k): k is string => k !== null)

  return {
    ...emptyEvidence([]),
    evidenceFlags: { ...emptyFlags(), hasPaymentExpiryEvidence: expiryKeysFound.length > 0 },
    evidenceSources: [
      { check: 'order.rawPayload (campo de prazo/vencimento explícito)', result: expiryKeysFound.length ? `campo(s) encontrado(s): ${[...new Set(expiryKeysFound)].join(', ')}` : `nenhum campo de prazo/vencimento explícito em ${relevant.length} pedido(s) amostrado(s) — a integração atual não recebe esse dado da Nuvemshop` },
    ],
  }
}

async function enrichPurchaseHistory(): Promise<CampaignEvidence> {
  const sample = await prisma.order.findMany({
    where: { paymentStatus: 'paid', status: { notIn: ['cancelled', 'canceled', 'refunded'] } },
    orderBy: { sourceCreatedAt: 'desc' },
    take: MAX_SAMPLE_ROWS,
    select: { rawPayload: true },
  })

  const rawIds = sample.flatMap((o) => extractProductIdsFromRawPayload(o.rawPayload))
  const purchasedProducts = await verifyRealProductIds(rawIds)

  return {
    candidateProducts: [],
    purchasedProducts,
    cartProducts: [],
    evidenceFlags: {
      ...emptyFlags(),
      // purchasedProducts é CONTEXTO de compra anterior, nunca um produto
      // recomendado — por isso não vira hasCandidateProducts sozinho (ver
      // seção 4 da missão: "não dizer que uma peça combina sem regra de
      // recomendação real implementada"). Nenhuma regra de cross-sell
      // determinística existe ainda, então isto fica false de propósito.
      hasCandidateProducts: false,
      // Nenhum categoryId existe em NuvemshopProduct/productTruthService hoje
      // (confirmado por leitura de código) — sem essa fonte, não há regra
      // determinística possível de afinidade de categoria.
      hasCategoryEvidence: false,
    },
    evidenceSources: [
      { check: 'order.rawPayload.products[].product_id (histórico de compra)', result: rawIds.length ? `${rawIds.length} id(s) bruto(s) encontrados, ${purchasedProducts.length} confirmado(s) via Product Truth (context, não recomendação)` : 'nenhum product_id encontrado no payload armazenado dos pedidos pagos' },
      { check: 'category_id em Order/ProductTruth', result: 'AUSENTE — nenhum campo de categoria existe no modelo de dados ou na integração Nuvemshop atual' },
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

export async function enrichOpportunityEvidence(opportunity: Opportunity): Promise<CampaignEvidence> {
  try {
    switch (opportunity.type) {
      case 'ABANDONED_CART':
        return await enrichAbandonedCart()
      case 'PIX_PENDING':
        return await enrichPaymentPending(/pix/)
      case 'BOLETO_PENDING':
        return await enrichPaymentPending(/boleto|ticket/)
      case 'RECENT_CUSTOMER':
      case 'REPEAT_PURCHASE':
      case 'VIP':
      case 'WINBACK':
        return await enrichPurchaseHistory()
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
