import { describe, it, expect } from 'vitest'
import { normalizePhoneBrazil } from '../../helpers/phoneService'
import { extractUrlSuffix, buildOrderConfirmationVars, buildAbandonedCartVars } from '../../helpers/templateMapper'
import { messageService } from '../../services/messageService'

// -----------------------------------------------------------------------
// normalizePhoneBrazil
// -----------------------------------------------------------------------
describe('normalizePhoneBrazil', () => {
  it('formata número com DDD e traço', () => {
    expect(normalizePhoneBrazil('(31) 99802-1418')).toBe('5531998021418')
  })

  it('formata número nacional sem código de país', () => {
    expect(normalizePhoneBrazil('31998021418')).toBe('5531998021418')
  })

  it('mantém número que já tem 55', () => {
    expect(normalizePhoneBrazil('5531998021418')).toBe('5531998021418')
  })

  it('formata número com +55', () => {
    expect(normalizePhoneBrazil('+55 31 99802-1418')).toBe('5531998021418')
  })

  it('formata número de 10 dígitos (fixo)', () => {
    // fixo: 55 + DDD(2) + número(8) = 12 dígitos
    expect(normalizePhoneBrazil('3133001234')).toBe('553133001234')
    expect(normalizePhoneBrazil('3133001234')).toBe('55' + '3133001234')
  })

  it('retorna null para número muito curto', () => {
    expect(normalizePhoneBrazil('123')).toBeNull()
  })

  it('retorna null para valor vazio', () => {
    expect(normalizePhoneBrazil('')).toBeNull()
    expect(normalizePhoneBrazil(null)).toBeNull()
    expect(normalizePhoneBrazil(undefined)).toBeNull()
  })

  it('remove caracteres especiais variados', () => {
    expect(normalizePhoneBrazil('+55.31.99802.1418')).toBe('5531998021418')
  })
})

// -----------------------------------------------------------------------
// extractUrlSuffix
// -----------------------------------------------------------------------
describe('extractUrlSuffix', () => {
  const base = 'https://www.drosamoda.com.br/checkout/'

  it('extrai sufixo quando URL começa com base', () => {
    expect(extractUrlSuffix(`${base}abc123`, base)).toBe('abc123')
  })

  it('extrai sufixo vazio quando URL é exatamente a base', () => {
    expect(extractUrlSuffix(base, base)).toBe('')
  })

  it('retorna null quando URL não começa com base', () => {
    expect(extractUrlSuffix('https://outro.site.com/checkout/abc', base)).toBeNull()
  })

  it('retorna null para URL completamente diferente', () => {
    expect(extractUrlSuffix('https://malicious.com', base)).toBeNull()
  })
})

// -----------------------------------------------------------------------
// buildOrderConfirmationVars
// -----------------------------------------------------------------------
describe('buildOrderConfirmationVars', () => {
  it('retorna apenas o primeiro nome', () => {
    const vars = buildOrderConfirmationVars({ customerName: 'Maria Silva', orderNumber: '1001' })
    expect(vars.nome_cliente).toBe('Maria')
    expect(vars.numero_pedido).toBe('1001')
  })

  it('lida com nome de uma palavra', () => {
    const vars = buildOrderConfirmationVars({ customerName: 'Maria', orderNumber: '2002' })
    expect(vars.nome_cliente).toBe('Maria')
  })
})

// -----------------------------------------------------------------------
// buildAbandonedCartVars
// -----------------------------------------------------------------------
describe('buildAbandonedCartVars', () => {
  const base = process.env.CHECKOUT_BASE_URL!

  it('extrai sufixo para URL válida', () => {
    const url = `${base}token-xpto-123`
    const vars = buildAbandonedCartVars({ customerName: 'Ana Lima', abandonedCheckoutUrl: url })
    expect(vars.link_checkout).toBe('token-xpto-123')
    expect(vars.nome_cliente).toBe('Ana')
  })

  it('retorna URL completa quando não começa com base', () => {
    const url = 'https://outro.dominio.com/checkout/token'
    const vars = buildAbandonedCartVars({ customerName: 'João', abandonedCheckoutUrl: url })
    expect(vars.link_checkout).toBe(url)
  })
})

// -----------------------------------------------------------------------
// generateIdempotencyKey
// -----------------------------------------------------------------------
describe('generateIdempotencyKey', () => {
  it('gera chave no formato correto para order', () => {
    const key = messageService.generateIdempotencyKey('order', 'abc123', 'confirmacao_pedido_drosa')
    expect(key).toBe('order:abc123:confirmacao_pedido_drosa')
  })

  it('gera chave no formato correto para abandoned_checkout', () => {
    const key = messageService.generateIdempotencyKey(
      'abandoned_checkout',
      'xyz789',
      'carrinho_abandonado_drosa_01'
    )
    expect(key).toBe('abandoned_checkout:xyz789:carrinho_abandonado_drosa_01')
  })
})
