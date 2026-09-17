import { Opportunity, OpportunityType } from '../../services/aiOpportunityEngine'
import { Strategy } from '../../services/ai/aiProvider'

// Fixtures sanitizadas (nenhum dado real de cliente — só contagens e texto de
// exemplo) para os 8 tipos de oportunidade do Strategy Lab v1. Cada fixture
// traz a Opportunity real (mesmo shape de aiOpportunityEngine.ts) e um
// conjunto de 3 estratégias "boas" — respeitando a direção A/B/C do playbook
// daquele tipo, sem nenhuma alegação não comprovada, com CTA curto compatível
// com WhatsApp. Usadas tanto pelos testes quanto pela tabela de exemplos em
// docs/strategy-lab-examples.md — a mesma fonte, para nunca haver deriva
// entre o que é testado e o que é documentado.

const dataQuality = { historyTruncated: false, consentSourceConfigured: true, metaTemplatesVerified: true }
const generatedAt = '2026-09-17T12:00:00.000Z'

function baseOpportunity(overrides: Partial<Opportunity> & Pick<Opportunity, 'id' | 'type' | 'title' | 'reason' | 'audienceCount' | 'eligibleCount' | 'blockedCount' | 'recommendedTiming'>): Opportunity {
  return {
    recommendedChannel: 'whatsapp',
    recommendedProduct: null,
    confidence: 'medium',
    evidence: { topBlockers: [], dataQuality, template: 'template_exemplo' },
    generatedAt,
    ...overrides,
  }
}

function strategy(s: Omit<Strategy, 'warnings'> & { warnings?: string[] }): Strategy {
  return { warnings: [], ...s }
}

export interface StrategyLabFixture {
  type: OpportunityType
  opportunity: Opportunity
  goodStrategies: [Strategy, Strategy, Strategy]
}

export const STRATEGY_LAB_FIXTURES: Record<OpportunityType, StrategyLabFixture> = {
  ABANDONED_CART: {
    type: 'ABANDONED_CART',
    opportunity: baseOpportunity({
      id: 'opp_abandoned_cart_fixture', type: 'ABANDONED_CART',
      title: '100 carrinhos abandonados elegíveis', reason: 'Checkout iniciado e não finalizado, dentro da janela de recuperação configurada.',
      audienceCount: 100, eligibleCount: 40, blockedCount: 60, recommendedTiming: 'Automação existente: 30 min após abandono',
    }),
    goodStrategies: [
      strategy({ direction: 'A', name: 'Recuperação direta', angle: 'Retomar o checkout que ficou aberto', audience: '40 elegíveis', productId: null,
        message: 'Notamos que seu carrinho ficou aberto com um item separado. Ainda dá tempo de finalizar a compra quando quiser.',
        cta: 'Finalizar compra', creativeBrief: 'Print do carrinho com o item já selecionado.' }),
      strategy({ direction: 'B', name: 'Assistência / redução de fricção', angle: 'Oferecer ajuda para destravar a compra', audience: '40 elegíveis', productId: null,
        message: 'Vimos que você não conseguiu concluir a compra. Teve alguma dúvida ou dificuldade que possamos ajudar a resolver agora?',
        cta: 'Falar com atendimento', creativeBrief: 'Balão de conversa simulando atendimento humano.' }),
      strategy({ direction: 'C', name: 'Produto / desejo', angle: 'Reforçar o item já escolhido', audience: '40 elegíveis', productId: null,
        message: 'O item que você separou no carrinho continua disponível para você levar quando quiser finalizar.',
        cta: 'Ver item no carrinho', creativeBrief: 'Foto do item isolado, sem texto de urgência.' }),
    ],
  },
  PIX_PENDING: {
    type: 'PIX_PENDING',
    opportunity: baseOpportunity({
      id: 'opp_pix_pending_fixture', type: 'PIX_PENDING',
      title: '5 pedidos com Pix pendente', reason: 'Pedido criado com Pix aguardando pagamento, sem cancelamento nem reembolso.',
      audienceCount: 5, eligibleCount: 2, blockedCount: 3, recommendedTiming: 'Envio dentro do horário comercial configurado (09h–20h)',
    }),
    goodStrategies: [
      strategy({ direction: 'A', name: 'Lembrete de pagamento', angle: 'Lembrar que o Pix está pendente', audience: '2 elegíveis', productId: null,
        message: 'Seu pagamento via Pix ainda está pendente de confirmação. Você pode concluir quando quiser.',
        cta: 'Ver pagamento', creativeBrief: 'Print da tela de pagamento pendente.' }),
      strategy({ direction: 'B', name: 'Assistência de pagamento', angle: 'Oferecer assistência para concluir o pagamento', audience: '2 elegíveis', productId: null,
        message: 'Notamos que o Pix ainda não foi concluído. Teve alguma dificuldade com o QR code ou com o aplicativo do banco?',
        cta: 'Pedir ajuda', creativeBrief: 'Balão de conversa oferecendo suporte.' }),
      strategy({
        direction: 'C', name: 'Prazo real (degradado)', angle: 'Reforçar a simplicidade do Pix', audience: '2 elegíveis', productId: null,
        message: 'O pagamento via Pix continua disponível para você concluir quando for conveniente — é rápido e simples.',
        cta: 'Pagar agora', creativeBrief: 'Ícone do Pix com destaque na simplicidade.',
        warnings: ['Direção C (prazo real) degradada: nenhum prazo de expiração comprovado está disponível para este Pix — a variação gerada evita menção a prazo.'],
      }),
    ],
  },
  BOLETO_PENDING: {
    type: 'BOLETO_PENDING',
    opportunity: baseOpportunity({
      id: 'opp_boleto_pending_fixture', type: 'BOLETO_PENDING',
      title: '70 boletos pendentes', reason: 'Pedido criado com boleto aguardando pagamento.',
      audienceCount: 70, eligibleCount: 0, blockedCount: 70, recommendedTiming: 'Envio dentro do horário comercial configurado (09h–20h)',
    }),
    goodStrategies: [
      strategy({ direction: 'A', name: 'Lembrete', angle: 'Lembrar que o boleto está pendente', audience: '70 na audiência', productId: null,
        message: 'Seu boleto ainda está pendente de pagamento. Você pode concluir quando for conveniente.',
        cta: 'Ver boleto', creativeBrief: 'Print do boleto pendente.' }),
      strategy({
        direction: 'B', name: 'Facilitação / segunda via (degradado)', angle: 'Oferecer assistência geral para o pagamento', audience: '70 na audiência', productId: null,
        message: 'Notamos que o boleto ainda não foi pago. Se precisar de ajuda para resolver o pagamento, é só responder por aqui.',
        cta: 'Pedir ajuda', creativeBrief: 'Balão de conversa oferecendo suporte geral.',
        warnings: ['Direção B (segunda via) degradada: não há confirmação de que a reemissão do boleto está disponível para este pedido — a variação gerada oferece assistência geral no lugar.'],
      }),
      strategy({
        direction: 'C', name: 'Prazo real (degradado)', angle: 'Reforçar a facilidade de pagar em qualquer lugar', audience: '70 na audiência', productId: null,
        message: 'O pagamento do boleto pode ser feito em qualquer banco ou lotérica, quando for conveniente para você.',
        cta: 'Ver formas de pagar', creativeBrief: 'Ícone de banco e lotérica lado a lado.',
        warnings: ['Direção C (prazo real) degradada: nenhum vencimento comprovado está disponível para este boleto — a variação gerada evita menção a prazo.'],
      }),
    ],
  },
  VIP: {
    type: 'VIP',
    opportunity: baseOpportunity({
      id: 'opp_vip_fixture', type: 'VIP',
      title: '85 clientes VIP', reason: 'Critério documentado: 3+ pedidos pagos e R$ 500+ em compras.',
      audienceCount: 85, eligibleCount: 0, blockedCount: 85, recommendedTiming: 'Envio dentro do horário comercial configurado (09h–20h)',
    }),
    goodStrategies: [
      strategy({ direction: 'A', name: 'Curadoria personalizada', angle: 'Curadoria baseada no histórico real do cliente', audience: '85 na audiência', productId: null,
        message: 'Preparamos uma seleção pensada especialmente para o seu histórico de compras com a gente.',
        cta: 'Ver seleção', creativeBrief: 'Grade de fotos com itens variados.' }),
      strategy({ direction: 'B', name: 'Relacionamento', angle: 'Reconhecer o cliente como frequente', audience: '85 na audiência', productId: null,
        message: 'Você é um dos nossos clientes mais frequentes e queríamos agradecer por isso.',
        cta: 'Ver novidades', creativeBrief: 'Mensagem de agradecimento em tom pessoal.' }),
      strategy({
        direction: 'C', name: 'Novidade / afinidade (sem produto candidato)', angle: 'Manter contato sem recomendação de produto ainda', audience: '85 na audiência', productId: null,
        message: 'Ainda não temos uma recomendação de produto específica para você nesta janela, mas queríamos manter contato.',
        cta: 'Responder esta mensagem', creativeBrief: 'Texto simples, sem imagem de produto.',
        warnings: ['Nenhum produto candidato real foi fornecido para esta direção — recomendação de produto fica pendente.'],
      }),
    ],
  },
  RECENT_CUSTOMER: {
    type: 'RECENT_CUSTOMER',
    opportunity: baseOpportunity({
      id: 'opp_recent_customer_fixture', type: 'RECENT_CUSTOMER',
      title: '1075 clientes recentes', reason: 'Última compra paga nos últimos 30 dias.',
      audienceCount: 1075, eligibleCount: 0, blockedCount: 1075, recommendedTiming: 'Envio dentro do horário comercial configurado (09h–20h)',
    }),
    goodStrategies: [
      strategy({ direction: 'A', name: 'Cross-sell complementar', angle: 'Sugerir complemento real da compra recente', audience: '1075 na audiência', productId: null,
        message: 'Como você comprou recentemente, separamos um complemento que combina com o que já é seu.',
        cta: 'Ver complemento', creativeBrief: 'Foto do complemento ao lado do item comprado.' }),
      strategy({ direction: 'B', name: 'Style guidance', angle: 'Orientar como aproveitar a compra recente', audience: '1075 na audiência', productId: null,
        message: 'Preparamos algumas sugestões de como aproveitar melhor o que você comprou recentemente no dia a dia.',
        cta: 'Ver sugestões', creativeBrief: 'Carrossel com ideias de uso.' }),
      strategy({ direction: 'C', name: 'Novidades relacionadas', angle: 'Apresentar novidades da categoria comprada', audience: '1075 na audiência', productId: null,
        message: 'Chegaram novidades na mesma categoria da sua última compra, caso queira dar uma olhada.',
        cta: 'Ver novidades', creativeBrief: 'Grade com as novidades da categoria.' }),
    ],
  },
  ENGAGED_NO_PURCHASE: {
    type: 'ENGAGED_NO_PURCHASE',
    opportunity: baseOpportunity({
      id: 'opp_engaged_no_purchase_fixture', type: 'ENGAGED_NO_PURCHASE',
      title: '2 contatos engajados sem compra', reason: 'Mensagem recebida via WhatsApp nos últimos 30 dias, sem pedido pago desde então.',
      audienceCount: 2, eligibleCount: 0, blockedCount: 2, recommendedTiming: 'Envio dentro do horário comercial configurado (09h–20h)',
    }),
    goodStrategies: [
      strategy({ direction: 'A', name: 'Venda assistida', angle: 'Retomar atendimento humano', audience: '2 na audiência', productId: null,
        message: 'Vimos que você conversou com a gente recentemente. Podemos continuar te ajudando a decidir?',
        cta: 'Continuar conversa', creativeBrief: 'Balão de retomada de atendimento.' }),
      strategy({
        direction: 'B', name: 'Curadoria de opções (sem produto candidato)', angle: 'Convidar a detalhar o que procura, sem produto ainda', audience: '2 na audiência', productId: null,
        message: 'Ainda não temos produtos candidatos específicos para sugerir nesta janela, mas ficamos à disposição para ajudar a encontrar o que procura.',
        cta: 'Contar o que procura', creativeBrief: 'Texto simples convidando a responder.',
        warnings: ['Nenhum produto candidato real foi fornecido para esta direção — apresentamos um convite geral em vez de opções específicas.'],
      }),
      strategy({ direction: 'C', name: 'Redução de fricção', angle: 'Perguntar objetivamente sobre a barreira à compra', audience: '2 na audiência', productId: null,
        message: 'Ficamos com uma dúvida: teve algo que impediu a compra da última vez que conversamos?',
        cta: 'Responder aqui', creativeBrief: 'Pergunta direta, sem nenhum anexo comercial.' }),
    ],
  },
  WINBACK: {
    type: 'WINBACK',
    opportunity: baseOpportunity({
      id: 'opp_winback_fixture', type: 'WINBACK',
      title: '181 clientes inativos para reativação', reason: 'Última compra paga há 90+ dias e nenhum pedido posterior.',
      audienceCount: 181, eligibleCount: 0, blockedCount: 181, recommendedTiming: 'Envio dentro do horário comercial configurado (09h–20h)',
    }),
    goodStrategies: [
      strategy({
        direction: 'A', name: 'Novidade (sem produto candidato)', angle: 'Reabrir contato sem novidade de produto ainda', audience: '181 na audiência', productId: null,
        message: 'Ainda não temos uma novidade específica de produto para compartilhar com você nesta janela, mas gostaríamos de retomar contato.',
        cta: 'Responder esta mensagem', creativeBrief: 'Texto simples de reconexão.',
        warnings: ['Nenhum produto candidato real foi fornecido para esta direção — apresentamos uma reconexão geral em vez de uma novidade específica.'],
      }),
      strategy({ direction: 'B', name: 'Afinidade de categoria', angle: 'Reconectar pela categoria de interesse do histórico', audience: '181 na audiência', productId: null,
        message: 'Notamos que faz um tempo desde sua última compra na categoria que você costumava explorar com a gente.',
        cta: 'Dar uma olhada', creativeBrief: 'Grade com itens da categoria de interesse.' }),
      strategy({ direction: 'C', name: 'Redescoberta / relacionamento', angle: 'Reabrir relacionamento com tom de reconexão genuína', audience: '181 na audiência', productId: null,
        message: 'Faz um tempo que não conversamos. Gostaríamos de saber como você está e se podemos ajudar em algo.',
        cta: 'Responder aqui', creativeBrief: 'Mensagem de tom pessoal, sem nenhum anexo comercial.' }),
    ],
  },
  REPEAT_PURCHASE: {
    type: 'REPEAT_PURCHASE',
    opportunity: baseOpportunity({
      id: 'opp_repeat_purchase_fixture', type: 'REPEAT_PURCHASE',
      title: '1550 clientes prontos para recompra', reason: 'Última compra paga entre 30 e 90 dias atrás e nenhum pedido posterior.',
      audienceCount: 1550, eligibleCount: 0, blockedCount: 1550, recommendedTiming: 'Envio dentro do horário comercial configurado (09h–20h)',
    }),
    goodStrategies: [
      strategy({ direction: 'A', name: 'Complemento da compra anterior', angle: 'Sugerir complemento real da compra anterior', audience: '1550 na audiência', productId: null,
        message: 'Como faz um tempo desde sua última compra, separamos um complemento que combina bem com o que você já tem.',
        cta: 'Ver complemento', creativeBrief: 'Foto do complemento sugerido.' }),
      strategy({ direction: 'B', name: 'Renovação de look', angle: 'Sugerir renovação com base no padrão de compra', audience: '1550 na audiência', productId: null,
        message: 'Preparamos ideias de como renovar o que você já tem, combinando com peças novas.',
        cta: 'Ver ideias', creativeBrief: 'Carrossel com sugestões de combinação.' }),
      strategy({ direction: 'C', name: 'Novidades da categoria de afinidade', angle: 'Apresentar novidades da categoria de afinidade', audience: '1550 na audiência', productId: null,
        message: 'Chegaram novidades na categoria que você costuma comprar com a gente, caso queira conferir.',
        cta: 'Ver novidades', creativeBrief: 'Grade com novidades da categoria de afinidade.' }),
    ],
  },
}
