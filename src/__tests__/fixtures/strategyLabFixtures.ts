import { Opportunity, OpportunityType } from '../../services/aiOpportunityEngine'
import { Strategy } from '../../services/ai/aiProvider'

// Fixtures sanitizadas (nenhum dado real de cliente — só contagens e texto de
// exemplo) para os 8 tipos de oportunidade do Strategy Lab. Cada fixture traz
// a Opportunity real (mesmo shape de aiOpportunityEngine.ts) e um conjunto de
// 3 estratégias "boas" — respeitando a direção A/B/C do playbook daquele
// tipo, sem nenhuma alegação não comprovada (nem por palavra proibida, nem
// por claim implícita sem evidência — v1.1 Truth Hardening), com CTA curto
// compatível com WhatsApp. Usadas tanto pelos testes quanto pela tabela de
// exemplos em docs/strategy-lab-examples.md — a mesma fonte, para nunca haver
// deriva entre o que é testado e o que é documentado.
//
// candidateProducts é sempre [] no sistema real hoje (campaignService.ts), e
// nenhuma fonte real de categoria de interesse, estoque por candidato,
// indício de novidade ou prazo de pagamento comprovado existe — por isso a
// maioria das direções aqui está no seu estado DEGRADADO (o único estado
// honesto possível agora). O texto "bom" é justamente a variação seguem
// conservadora, nunca a versão que precisaria do dado que não existe.

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
      strategy({
        direction: 'A', name: 'Recuperação direta (degradado — sem URL de recuperação confirmada)', angle: 'Informar que o checkout ficou em aberto', audience: '40 elegíveis', productId: null,
        message: 'Identificamos que um checkout foi iniciado e não foi concluído.',
        cta: 'Falar com atendimento', creativeBrief: 'Texto neutro, sem foto do carrinho.',
        warnings: ['Direção A (recuperação direta) degradada: nenhuma URL de recuperação real e válida foi confirmada para os checkouts desta oportunidade — o CTA oferece atendimento humano em vez de retomar o checkout diretamente.'],
      }),
      strategy({ direction: 'B', name: 'Assistência / redução de fricção', angle: 'Oferecer ajuda para destravar a compra', audience: '40 elegíveis', productId: null,
        message: 'Vimos que você não conseguiu concluir a compra. Teve alguma dúvida ou dificuldade que possamos ajudar a resolver agora?',
        cta: 'Falar com atendimento', creativeBrief: 'Balão de conversa simulando atendimento humano.' }),
      strategy({
        direction: 'C', name: 'Produto / desejo (degradado — sem estoque comprovado)', angle: 'Reconhecer o interesse demonstrado, sem falar do item', audience: '40 elegíveis', productId: null,
        message: 'Vimos que você demonstrou interesse por algo em nossa loja recentemente. Ficamos à disposição se quiser continuar de onde parou.',
        cta: 'Continuar de onde parei', creativeBrief: 'Texto genérico de reconexão, sem foto do produto.',
        warnings: ['Direção C (produto/desejo) degradada: nenhuma confirmação real de estoque está disponível para o item deste carrinho — a variação gerada evita afirmar disponibilidade.'],
      }),
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
      strategy({ direction: 'A', name: 'Lembrete de pagamento (neutro)', angle: 'Informar o status pendente do pagamento', audience: '2 elegíveis', productId: null,
        message: 'Identificamos que o pagamento via Pix deste pedido ainda consta como pendente.',
        cta: 'Ver situação do pagamento', creativeBrief: 'Print neutro do status pendente, sem ícone de urgência.' }),
      strategy({ direction: 'B', name: 'Assistência de pagamento', angle: 'Oferecer ajuda para o pagamento que não foi concluído', audience: '2 elegíveis', productId: null,
        message: 'Notamos que o Pix ainda não foi concluído. Teve alguma dificuldade com o QR code ou com o aplicativo do banco?',
        cta: 'Pedir ajuda', creativeBrief: 'Balão de conversa oferecendo suporte.' }),
      strategy({
        direction: 'C', name: 'Prazo real (degradado — sem prazo comprovado)', angle: 'Convidar a verificar a situação do pagamento', audience: '2 elegíveis', productId: null,
        message: 'Para confirmar a situação atual do seu pagamento via Pix, é só nos chamar por aqui.',
        cta: 'Falar com atendimento', creativeBrief: 'Texto simples convidando a checar o status, sem ícone de validade.',
        warnings: ['Direção C (prazo real) degradada: nenhum prazo de expiração comprovado está disponível para este Pix — a variação gerada evita implicar que o pagamento continua válido.'],
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
      strategy({ direction: 'A', name: 'Lembrete (neutro)', angle: 'Informar o status pendente do boleto', audience: '70 na audiência', productId: null,
        message: 'Identificamos que o pedido ainda consta com boleto pendente de pagamento.',
        cta: 'Ver situação', creativeBrief: 'Print neutro do status pendente do boleto.' }),
      strategy({
        direction: 'B', name: 'Facilitação / segunda via (degradado)', angle: 'Oferecer contato humano para o pagamento pendente', audience: '70 na audiência', productId: null,
        message: 'Notamos que o boleto deste pedido ainda não foi pago. Fale com a gente para verificar a situação e ver como podemos ajudar.',
        cta: 'Falar com atendimento', creativeBrief: 'Balão de conversa oferecendo suporte geral.',
        warnings: ['Direção B (segunda via) degradada: não há confirmação de que a reemissão do boleto está disponível para este pedido — a variação gerada evita implicar que o pagamento ainda é possível.'],
      }),
      strategy({
        direction: 'C', name: 'Prazo real (degradado)', angle: 'Convidar a verificar a situação do pedido', audience: '70 na audiência', productId: null,
        message: 'Para confirmar a situação atual do seu boleto, é só chamar a gente por aqui.',
        cta: 'Ver situação do boleto', creativeBrief: 'Texto simples convidando a checar o status, sem ícone de validade.',
        warnings: ['Direção C (prazo real) degradada: nenhum vencimento comprovado está disponível para este boleto — a variação gerada evita implicar que o pagamento continua válido.'],
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
      strategy({
        direction: 'A', name: 'Curadoria personalizada (degradado — sem produto candidato)', angle: 'Reconhecer o perfil de compras do cliente', audience: '85 na audiência', productId: null,
        message: 'Analisando seu histórico com a gente, você tem um perfil de compras que valorizamos bastante.',
        cta: 'Ver catálogo atual', creativeBrief: 'Mensagem de reconhecimento, sem imagem de produto.',
        warnings: ['Direção A (curadoria personalizada) degradada: nenhum produto candidato real foi fornecido — a variação gerada reconhece o perfil de compra sem afirmar uma curadoria específica.'],
      }),
      strategy({ direction: 'B', name: 'Relacionamento', angle: 'Reconhecer o cliente como frequente', audience: '85 na audiência', productId: null,
        message: 'Você é um dos nossos clientes mais frequentes e queríamos agradecer por isso.',
        cta: 'Responder esta mensagem', creativeBrief: 'Mensagem de agradecimento em tom pessoal.' }),
      strategy({
        direction: 'C', name: 'Novidade / afinidade (degradado — sem produto candidato)', angle: 'Manter contato sem recomendação de produto ainda', audience: '85 na audiência', productId: null,
        message: 'Ainda não temos uma recomendação de produto específica para compartilhar com você nesta janela, mas gostaríamos de manter contato.',
        cta: 'Falar com a gente', creativeBrief: 'Texto simples de reconexão, sem nenhum anexo comercial.',
        warnings: ['Direção C (novidade / afinidade de categoria) degradada: nenhum produto candidato real foi fornecido — a variação gerada mantém contato sem afirmar novidade.'],
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
      strategy({
        direction: 'A', name: 'Cross-sell complementar (degradado — sem produto candidato)', angle: 'Relacionamento pós-compra', audience: '1075 na audiência', productId: null,
        message: 'Obrigado por comprar com a gente recentemente! Ficamos à disposição se precisar de qualquer coisa.',
        cta: 'Responder esta mensagem', creativeBrief: 'Mensagem de agradecimento em tom pessoal.',
        warnings: ['Direção A (cross-sell complementar) degradada: nenhum produto candidato real foi fornecido — a variação gerada foca em relacionamento pós-compra, sem afirmar um complemento específico.'],
      }),
      strategy({
        direction: 'B', name: 'Style guidance (degradado — sem produto candidato)', angle: 'Orientação de estilo geral', audience: '1075 na audiência', productId: null,
        message: 'Preparamos algumas dicas gerais de cuidado e estilo que podem ser úteis no dia a dia.',
        cta: 'Ver dicas', creativeBrief: 'Carrossel com dicas gerais, sem citar produto específico.',
        warnings: ['Direção B (style guidance) degradada: nenhum produto candidato real foi fornecido — a variação gerada oferece orientação geral, sem citar um item específico.'],
      }),
      strategy({
        direction: 'C', name: 'Novidades relacionadas (degradado — sem categoria comprovada)', angle: 'Convite para conhecer o catálogo atual', audience: '1075 na audiência', productId: null,
        message: 'Enquanto isso, você pode dar uma olhada no que temos disponível no catálogo atual.',
        cta: 'Ver catálogo', creativeBrief: 'Grade geral do catálogo, sem recorte de categoria.',
        warnings: ['Direção C (novidades relacionadas) degradada: nenhuma evidência real de categoria está disponível — a variação gerada convida a conhecer o catálogo atual, sem afirmar relação com a compra anterior.'],
      }),
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
        direction: 'B', name: 'Curadoria de opções (degradado — sem produto candidato)', angle: 'Convidar a detalhar o que procura, sem produto ainda', audience: '2 na audiência', productId: null,
        message: 'Ainda não temos produtos candidatos específicos para sugerir nesta janela, mas ficamos à disposição para ajudar a encontrar o que procura.',
        cta: 'Contar o que procura', creativeBrief: 'Texto simples convidando a responder.',
        warnings: ['Direção B (curadoria de opções) degradada: nenhum produto candidato real foi fornecido — a variação gerada convida o cliente a detalhar o que procura, em vez de apresentar opções.'],
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
        direction: 'A', name: 'Novidade (degradado — sem produto candidato)', angle: 'Reabrir contato sem novidade de produto ainda', audience: '181 na audiência', productId: null,
        message: 'Ainda não temos uma novidade específica de produto para compartilhar com você nesta janela, mas gostaríamos de retomar contato.',
        cta: 'Responder esta mensagem', creativeBrief: 'Texto simples de reconexão.',
        warnings: ['Direção A (novidade) degradada: nenhum produto candidato real foi fornecido — a variação gerada reabre contato sem afirmar novidade específica.'],
      }),
      strategy({
        direction: 'B', name: 'Afinidade de categoria (degradado — sem categoria comprovada)', angle: 'Reativação baseada no tempo de inatividade', audience: '181 na audiência', productId: null,
        message: 'Notamos que faz um tempo desde sua última compra com a gente.',
        cta: 'Dar uma olhada', creativeBrief: 'Mensagem simples baseada no tempo, sem menção a categoria.',
        warnings: ['Direção B (afinidade de categoria) degradada: nenhuma evidência real de categoria está disponível — a variação gerada se baseia apenas no tempo de inatividade, sem citar categoria.'],
      }),
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
      strategy({
        direction: 'A', name: 'Complemento da compra anterior (degradado — sem produto candidato)', angle: 'Retomar o relacionamento reconhecendo o tempo desde a última compra', audience: '1550 na audiência', productId: null,
        message: 'Faz um tempo desde sua última compra com a gente. Ficamos à disposição se precisar de algo.',
        cta: 'Responder esta mensagem', creativeBrief: 'Mensagem simples de reconexão.',
        warnings: ['Direção A (complemento da compra anterior) degradada: nenhum produto candidato real foi fornecido — a variação gerada retoma o relacionamento, sem afirmar um complemento específico.'],
      }),
      strategy({
        direction: 'B', name: 'Renovação de look (degradado — sem produto candidato)', angle: 'Inspiração geral de novo look', audience: '1550 na audiência', productId: null,
        message: 'Preparamos algumas inspirações gerais de composição que podem ser úteis para renovar o visual.',
        cta: 'Ver inspirações', creativeBrief: 'Carrossel com ideias gerais, sem citar peça específica.',
        warnings: ['Direção B (renovação de look) degradada: nenhum produto candidato real foi fornecido — a variação gerada oferece inspiração geral, sem afirmar combinação específica.'],
      }),
      strategy({
        direction: 'C', name: 'Novidades da categoria de afinidade (degradado — sem categoria comprovada)', angle: 'Convite para conhecer o catálogo atual', audience: '1550 na audiência', productId: null,
        message: 'Enquanto isso, você pode conferir o que temos disponível no catálogo atual.',
        cta: 'Ver catálogo atual', creativeBrief: 'Grade geral do catálogo, sem recorte de categoria.',
        warnings: ['Direção C (novidades da categoria de afinidade) degradada: nenhuma evidência real de categoria está disponível — a variação gerada convida a ver o catálogo atual, sem afirmar relação com a categoria de afinidade.'],
      }),
    ],
  },
}
