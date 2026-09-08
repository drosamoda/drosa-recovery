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
})
