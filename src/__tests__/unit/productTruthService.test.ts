import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchProductById: vi.fn(),
  searchProducts: vi.fn(),
}))

vi.mock('../../services/nuvemshopService', () => ({
  nuvemshopService: {
    fetchProductById: mocks.fetchProductById,
    searchProducts: mocks.searchProducts,
  },
}))

import { productTruthService, toProductTruth } from '../../services/productTruthService'

describe('productTruthService — anti-hallucination', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('nunca inventa campo: propriedade ausente na Nuvemshop vira null, não um valor inferido', () => {
    const truth = toProductTruth({ id: 42, name: { pt: 'Macacão Vivi' } })
    expect(truth.productId).toBe('42')
    expect(truth.name).toBe('Macacão Vivi')
    expect(truth.price).toBeNull()
    expect(truth.compareAtPrice).toBeNull()
    expect(truth.image).toBeNull()
    expect(truth.colors).toBeNull()
    expect(truth.sizes).toBeNull()
    expect(truth.description).toBeNull()
  })

  it('stockStatus fica "unknown" (nunca "in_stock" inventado) quando a Nuvemshop não gerencia estoque para a variante', () => {
    const truth = toProductTruth({ id: 1, variants: [{ id: 'v1', stock_management: false }] })
    expect(truth.stockStatus).toBe('unknown')
  })

  it('verify() retorna verified=false quando a Nuvemshop confirma que o produto não existe mais (404)', async () => {
    mocks.fetchProductById.mockResolvedValue(null)
    const result = await productTruthService.verify('999')
    expect(result.verified).toBe(false)
    expect(result.product).toBeNull()
  })

  it('verify() falha fechado (verified=false) se a chamada à Nuvemshop lançar erro, em vez de assumir que o produto existe', async () => {
    mocks.fetchProductById.mockRejectedValue(new Error('network down'))
    const result = await productTruthService.verify('123')
    expect(result.verified).toBe(false)
  })

  it('verify(null) não faz chamada nenhuma — productId ausente nunca é "verificado" por omissão', async () => {
    const result = await productTruthService.verify(null)
    expect(result.verified).toBe(false)
    expect(mocks.fetchProductById).not.toHaveBeenCalled()
  })
})
