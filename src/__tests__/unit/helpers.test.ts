import { describe, it, expect } from 'vitest'
import { normalizePhoneBrazil } from '../../helpers/phoneService'
import { extractUrlSuffix, buildOrderConfirmationVars, buildAbandonedCartVars } from '../../helpers/templateMapper'
import { messageService } from '../../services/messageService'
import { renderTemplatePreview } from '../../helpers/inboxTemplatePreview'

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

  it('formata número de 10 dígitos fixo', () => {
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

describe('renderTemplatePreview', () => {
  it('renderiza o preview completo de confirmacao de pedido', () => {
    const result = renderTemplatePreview('confirmacao_pedido_drosa', {
      templatePreview: `Oi, [nome_cliente]!
Sou a Dani da D'Rosa Moda.

Recebemos o seu pedido *[numero_pedido]* com sucesso.

Agora estamos aguardando a confirmação do pagamento para separar suas peças com todo carinho.

*Entre aqui:* [link_grupo_vip]`,
      templateVariables: {
        nome_cliente: 'Maria',
        numero_pedido: '1001',
        link_grupo_vip: 'https://chat.whatsapp.com/grupo-vip',
      },
    })

    expect(result.complete).toBe(true)
    expect(result.renderedPreview).toContain('Maria')
    expect(result.renderedPreview).toContain('1001')
    expect(result.renderedPreview).toContain('grupo-vip')
  })

  it('preserva acentos no preview renderizado de confirmacao de pedido', () => {
    const result = renderTemplatePreview('confirmacao_pedido_drosa', {
      templatePreview: `Oi, [nome_cliente]!
Sou a Dani da D'Rosa Moda.

Obrigada pela sua confiança!
Recebemos o seu pedido *[numero_pedido]* e o pagamento foi confirmado com sucesso.

Seu pedido já está sendo preparado com todo carinho. Assim que ele for postado, você receberá o código de rastreio por e-mail.

Também quero te convidar para o nosso Grupo VIP D'Rosa: por lá, você recebe lançamentos em primeira mão, condições especiais e novidades antes de todo mundo.

Entre aqui:
[link_grupo_vip]

Qualquer dúvida, estou por aqui para te ajudar.
Com carinho,
Dani | D'Rosa Moda`,
      templateVariables: {
        nome_cliente: 'Maria',
        numero_pedido: '1001',
        link_grupo_vip: 'https://chat.whatsapp.com/grupo-vip',
      },
    })

    expect(result.complete).toBe(true)
    expect(result.renderedPreview).toContain('confiança')
    expect(result.renderedPreview).toContain('já')
    expect(result.renderedPreview).toContain('está')
    expect(result.renderedPreview).toContain('você')
    expect(result.renderedPreview).toContain('código')
    expect(result.renderedPreview).toContain('Também')
    expect(result.renderedPreview).toContain('lá')
    expect(result.renderedPreview).toContain('lançamentos')
    expect(result.renderedPreview).toContain('mão')
    expect(result.renderedPreview).toContain('condições')
    expect(result.renderedPreview).toContain('dúvida')
    expect(result.renderedPreview).not.toContain('??')
    expect(result.renderedPreview).not.toMatch(/Ã|�/)
  })

  it('substitui preview corrompido conhecido por texto canonico em UTF-8', () => {
    const result = renderTemplatePreview('confirmacao_pedido_drosa', {
      templatePreview: `Oi, [nome_cliente]! ??\nObrigada pela sua confiana!\nSeu pedido j est sendo preparado. Voc receber o cdigo.\nTambm tem lanamentos em primeira mo e condies especiais.\nQualquer dvida, estou por aqui.`,
      templateVariables: {
        nome_cliente: 'Vilmara',
        numero_pedido: '83274',
        link_grupo_vip: 'https://chat.whatsapp.com/grupo-vip',
      },
    })

    expect(result.complete).toBe(true)
    expect(result.renderedPreview).toContain('Vilmara')
    expect(result.renderedPreview).toContain('83274')
    expect(result.renderedPreview).toContain('confiança')
    expect(result.renderedPreview).toContain('já')
    expect(result.renderedPreview).toContain('está')
    expect(result.renderedPreview).toContain('você')
    expect(result.renderedPreview).toContain('código')
    expect(result.renderedPreview).toContain('Também')
    expect(result.renderedPreview).toContain('lá')
    expect(result.renderedPreview).toContain('lançamentos')
    expect(result.renderedPreview).toContain('mão')
    expect(result.renderedPreview).toContain('condições')
    expect(result.renderedPreview).toContain('dúvida')
    expect(result.renderedPreview).not.toContain('??')
    expect(result.renderedPreview).not.toMatch(/Ã|�/)
  })

  it('renderiza preview de pix pendente com valor', () => {
    const result = renderTemplatePreview('pix_pendente_drosa_01', {
      templatePreview: `Oi, [nome_cliente]!\n\nVi que o pedido nº *[numero_pedido]*, no valor de *[valor_total]*, ainda está aguardando o pagamento.`,
      templateVariables: {
        nome_cliente: 'Ana',
        numero_pedido: '2002',
        valor_total: 'R$ 149,90',
      },
    })

    expect(result.complete).toBe(true)
    expect(result.renderedPreview).toContain('Ana')
    expect(result.renderedPreview).toContain('2002')
    expect(result.renderedPreview).toContain('R$ 149,90')
  })

  it('usa fallback auditavel quando nao consegue renderizar completo', () => {
    const result = renderTemplatePreview('carrinho_abandonado_drosa_01', {
      templatePreview: 'Oi, [nome_cliente]! Continue pelo link: [link_checkout]',
      templateVariables: {
        nome_cliente: 'Regina',
      },
    })

    expect(result.complete).toBe(false)
    expect(result.renderedPreview).toContain('Template enviado: carrinho_abandonado_drosa_01')
    expect(result.renderedPreview).toContain('preview completo indisponível')
    expect(result.renderedPreview).toContain('"nome_cliente":"Regina"')
  })
})
