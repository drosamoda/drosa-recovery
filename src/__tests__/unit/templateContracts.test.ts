import { describe, expect, it } from 'vitest'
import { renderContract, verifyDispatchContract } from '../../services/templateContracts'

describe('verified template contracts', () => {
  it('rejects guessed Pix template names and wrong parameter counts', () => {
    expect(renderContract('pix_pendente_drosa_01', ['Ana', '1'])).toBeNull()
    expect(renderContract('_pix_pendente', ['Ana', '1'])).toBeNull()
  })
  it('renders exact confirmation without inventing payment status', () => {
    const text = renderContract('confirmacao_pedido_drosa', ['Ana', '100'])
    expect(text).toContain('Recebemos o seu pedido *100* com sucesso')
    expect(text).not.toContain('pagamento')
  })
  it('rejects invalid encoding', () => {
    expect(renderContract('confirmacao_pedido_drosa', ['Ana�', '1'])).toBeNull()
  })
  it('blocks unsupported reservation claim before API access', async () => {
    expect(await verifyDispatchContract('carrinho_abandonado_drosa_01', 'pt_BR', ['Ana', 'https://example.com'])).toBe('unsupported_reservation_claim')
  })
  it('recognizes the approved cart v2 contract and still requires marketing consent', async () => {
    const text = renderContract('carrinho_abandonado_drosa_v2', ['Ana', 'https://example.com/checkout'])
    expect(text).toBe(`Oi, Ana! 😊
Você deixou algumas peças no carrinho da D’Rosa Moda.

Se quiser continuar sua compra, acesse:
https://example.com/checkout

Se precisar de ajuda com tamanho, tecido ou combinação, me chama por aqui.`)
    expect(await verifyDispatchContract('carrinho_abandonado_drosa_v2', 'pt_BR', ['Ana', 'https://example.com/checkout'])).toBe('consent_unproven')
  })
  it('renders the exact approved Pix and boleto parameter order', () => {
    expect(renderContract('_pix_pendente', ['Ana', '1001', '129,90']))
      .toContain('Pedido nº *1001* no valor de *R$ 129,90*')
    expect(renderContract('pedido_boleto_drosa_01', ['Ana', '1001']))
      .toContain('Seu pedido *1001* foi recebido')
  })
})
