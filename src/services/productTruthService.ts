import { nuvemshopService, NuvemshopProduct } from './nuvemshopService'

// Única fonte de verdade de produto: a API real da Nuvemshop. Nunca lê de
// cache local, nunca aceita um campo vindo da IA como fato — cada campo aqui
// só existe se a API respondeu com ele. Ausente = null, nunca inventado.

export type ProductTruth = {
  productId: string
  name: string | null
  url: string | null
  image: string | null
  price: number | null
  compareAtPrice: number | null
  variants: number | null
  colors: string[] | null
  sizes: string[] | null
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown'
  description: string | null
  updatedAt: string
}

function firstLocale(value: Record<string, string> | string | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  return value.pt ?? value.es ?? value.en ?? Object.values(value)[0] ?? null
}

// Nuvemshop associa product.attributes[i] <-> variant.values[i] por posição
// (ex.: attributes=["Cor","Tamanho"], values=[{pt:"Azul"},{pt:"P"}]). Sem
// attributes no payload não há como saber com segurança o que cada posição
// significa — nesse caso retorna null em vez de arriscar rotular errado.
function extractOptionValues(product: NuvemshopProduct, matcher: RegExp): string[] | null {
  const attributeIndex = (product.attributes ?? []).findIndex(attr => matcher.test(firstLocale(attr) ?? ''))
  if (attributeIndex === -1) return null
  const values = new Set<string>()
  for (const variant of product.variants ?? []) {
    const label = firstLocale(variant.values?.[attributeIndex] as Record<string, string> | undefined)
    if (label) values.add(label)
  }
  return values.size ? [...values] : null
}

export function toProductTruth(product: NuvemshopProduct): ProductTruth {
  const variant = product.variants?.[0]
  const stockKnown = variant?.stock_management === true
  return {
    productId: String(product.id),
    name: firstLocale(product.name),
    url: product.canonical_url ?? null,
    image: product.images?.[0]?.src ?? null,
    price: variant?.price ? Number(variant.price) : null,
    compareAtPrice: variant?.compare_at_price ? Number(variant.compare_at_price) : null,
    variants: product.variants?.length ?? null,
    colors: extractOptionValues(product, /cor|color/i),
    sizes: extractOptionValues(product, /tam|talle|size/i),
    stockStatus: stockKnown ? ((variant?.stock ?? 0) > 0 ? 'in_stock' : 'out_of_stock') : 'unknown',
    description: firstLocale(product.description),
    updatedAt: new Date().toISOString(),
  }
}

export const productTruthService = {
  async getById(productId: string): Promise<ProductTruth | null> {
    const product = await nuvemshopService.fetchProductById(productId)
    return product ? toProductTruth(product) : null
  },

  async search(term: string): Promise<ProductTruth[]> {
    const products = await nuvemshopService.searchProducts(term)
    return products.map(toProductTruth)
  },

  // Usado pelo audit de campanha: um productId citado pela IA só é aceito
  // se a Nuvemshop confirmar que ele existe agora.
  async verify(productId: string | null): Promise<{ verified: boolean; product: ProductTruth | null }> {
    if (!productId) return { verified: false, product: null }
    try {
      const product = await productTruthService.getById(productId)
      return { verified: product !== null, product }
    } catch {
      return { verified: false, product: null }
    }
  },
}
