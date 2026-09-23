import { describe, expect, it } from 'vitest'
import { evaluateCreativeDistance } from '../../services/ai/strategyDistanceService'
import { WhatsappStrategy as Strategy } from '../../services/ai/aiProvider'

function strategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    direction: 'A', name: 'x', angle: 'Recuperar o carrinho abandonado', audience: '10 elegíveis', productId: null,
    message: 'Seu carrinho ainda está aberto, finalize quando quiser.', cta: 'Finalizar compra', creativeBrief: 'Foto do item no carrinho.', warnings: [],
    ...overrides,
  }
}

describe('strategyDistanceService — Creative Distance (sem previsão de venda, só texto)', () => {
  it('não encontra colisão entre 3 estratégias genuinamente diferentes', () => {
    const strategies = [
      strategy({ direction: 'A', angle: 'Recuperar o carrinho abandonado', message: 'Seu carrinho ainda está aberto, finalize quando quiser.', cta: 'Finalizar compra', creativeBrief: 'Foto do item no carrinho.' }),
      strategy({ direction: 'B', angle: 'Oferecer ajuda para destravar a compra', message: 'Teve alguma dúvida ou dificuldade que possamos ajudar a resolver?', cta: 'Falar com atendimento', creativeBrief: 'Balão de conversa com atendente.' }),
      strategy({ direction: 'C', angle: 'Reforçar o item já escolhido', message: 'O item que você separou continua disponível para você levar.', cta: 'Ver item', creativeBrief: 'Foto isolada do produto.' }),
    ]
    expect(evaluateCreativeDistance(strategies)).toHaveLength(0)
  })

  it('encontra colisão quando duas estratégias são a mesma ideia com troca de adjetivos (hook/CTA/argumento quase iguais)', () => {
    const strategies = [
      strategy({ direction: 'A', angle: 'Recuperar o carrinho abandonado rapidamente', message: 'Seu carrinho incrível ainda está aberto, finalize agora mesmo.', cta: 'Finalizar compra agora', creativeBrief: 'Foto do item no carrinho.' }),
      strategy({ direction: 'B', angle: 'Recuperar o carrinho abandonado hoje mesmo', message: 'Seu carrinho especial ainda está aberto, finalize logo agora.', cta: 'Finalizar sua compra agora', creativeBrief: 'Vídeo do item no carrinho.' }),
      strategy({ direction: 'C', angle: 'Reforçar o item já escolhido', message: 'O item que você separou continua disponível para você levar.', cta: 'Ver item', creativeBrief: 'Foto isolada do produto.' }),
    ]
    const findings = evaluateCreativeDistance(strategies)
    expect(findings.some(f => f.strategyIndexA === 0 && f.strategyIndexB === 1)).toBe(true)
  })

  it('um único CTA parecido por coincidência não reprova sozinho (precisa de pelo menos 2 campos colidindo)', () => {
    const strategies = [
      strategy({ direction: 'A', angle: 'Recuperar o carrinho abandonado', message: 'Seu carrinho ainda está aberto, finalize quando quiser.', cta: 'Ver agora', creativeBrief: 'Foto do item no carrinho.' }),
      strategy({ direction: 'B', angle: 'Oferecer ajuda para destravar a compra', message: 'Teve alguma dúvida ou dificuldade que possamos ajudar a resolver?', cta: 'Ver agora', creativeBrief: 'Balão de conversa com atendente.' }),
      strategy({ direction: 'C', angle: 'Reforçar o item já escolhido', message: 'O item que você separou continua disponível para você levar.', cta: 'Ver item', creativeBrief: 'Foto isolada do produto.' }),
    ]
    expect(evaluateCreativeDistance(strategies)).toHaveLength(0)
  })

  it('reporta todos os pares colidentes quando mais de duas estratégias são parecidas entre si', () => {
    const near = strategy({ angle: 'Recuperar o carrinho já', message: 'Seu carrinho incrível segue aberto, finalize agora mesmo.', cta: 'Finalizar agora' })
    const strategies = [
      strategy({ ...near, direction: 'A' }),
      strategy({ ...near, direction: 'B', name: 'dup' }),
      strategy({ ...near, direction: 'C', name: 'dup2' }),
    ]
    const findings = evaluateCreativeDistance(strategies)
    expect(findings).toHaveLength(3)
  })
})
