import { OpportunityType } from '../aiOpportunityEngine'

export type StrategyDirectionKey = 'A' | 'B' | 'C'

// Nenhuma dessas fontes existe hoje no modelo de dados real (Order/Opportunity
// não carregam produto candidato, categoria de interesse, estoque, indício de
// novidade, prazo de pagamento nem segunda via de boleto) — por isso
// campaignService.ts sempre passa todas como false hoje. Existem como
// parâmetro explícito (em vez de hardcoded dentro deste arquivo) para o dia em
// que uma fonte real de cada uma existir, e para o resolver ser testável nos
// dois caminhos sem fingir que o dado existe agora.
export interface EvidenceFlags {
  hasCandidateProducts: boolean
  hasCategoryEvidence: boolean
  hasStockEvidence: boolean
  hasNewnessEvidence: boolean
  hasPaymentExpiryEvidence: boolean
  hasSecondCopySupport: boolean
  hasPromotionEvidence: boolean
}

export interface ResolvedDirection {
  key: StrategyDirectionKey
  label: string
  intent: string
  guidance: string
  degraded: boolean
  requiredWarning: string | null
}

interface DirectionDefinition {
  key: StrategyDirectionKey
  label: string
  intent: string
  guidance: string
  requires?: keyof EvidenceFlags
  fallbackGuidance?: string
  fallbackWarning?: string
}

// Direções determinísticas por tipo de oportunidade. Cada uma é um ÂNGULO
// distinto (intenção diferente), não uma paráfrase de tom — é isso que o
// strategyDistanceService audita depois de a IA responder. Direções marcadas
// com `requires` degradam para `fallbackGuidance` quando o dado real que elas
// dependem não está comprovado, em vez de a IA inventar o dado ou implicar
// algo que os dados atuais não sustentam (Strategy Lab v1.1 — Truth
// Hardening: "continua disponível", "separamos uma seleção", "mesma
// categoria" etc. só podem aparecer quando a evidência correspondente existir
// — ver EvidenceFlags e complianceService.auditClaimCategories).
const PLAYBOOKS: Record<OpportunityType, DirectionDefinition[]> = {
  ABANDONED_CART: [
    {
      key: 'A', label: 'RECUPERAÇÃO DIRETA',
      intent: 'Retomar o checkout iniciado e não finalizado.',
      guidance: 'Lembre objetivamente que o carrinho ficou aberto e convide a finalizar a compra. Foque na ação de concluir — nunca em desconto, cupom ou urgência de tempo.',
    },
    {
      key: 'B', label: 'ASSISTÊNCIA / REDUÇÃO DE FRICÇÃO',
      intent: 'Remover um possível obstáculo que impediu a finalização.',
      guidance: 'Ofereça ajuda humana real (dúvida sobre o produto, forma de pagamento, tamanho) para destravar a compra. Pergunte qual foi o obstáculo — nunca assuma qual foi.',
    },
    {
      key: 'C', label: 'PRODUTO / DESEJO',
      intent: 'Reforçar o interesse pelo item já escolhido, sem pressão comercial.',
      guidance: 'Reforce que o item específico do carrinho está confirmado em estoque, citando apenas o dado de estoque fornecido no input.',
      requires: 'hasStockEvidence',
      fallbackGuidance: 'Sem confirmação real de estoque para o item do carrinho, não afirme nem implique que ele está disponível. Gere uma variação que retome o convite para reabrir o checkout, com um ângulo diferente do da estratégia A (ex.: focar no interesse já demonstrado pelo cliente, não no produto em si).',
      fallbackWarning: 'Direção C (produto/desejo) degradada: nenhuma confirmação real de estoque está disponível para o item deste carrinho — a variação gerada evita afirmar disponibilidade.',
    },
  ],
  PIX_PENDING: [
    {
      key: 'A', label: 'LEMBRETE DE PAGAMENTO',
      intent: 'Lembrar que o Pix está aguardando pagamento, sem implicar que ainda é válido.',
      guidance: 'Informe de forma neutra e objetiva que o pagamento via Pix ainda consta como pendente. Não afirme nem implique que o Pix continua válido, disponível ou pagável — apenas registre o status pendente.',
    },
    {
      key: 'B', label: 'ASSISTÊNCIA DE PAGAMENTO',
      intent: 'Oferecer ajuda para um pagamento que não foi finalizado, sem implicar que ainda pode ser concluído.',
      guidance: 'Ofereça ajuda caso o cliente tenha tido dificuldade para pagar (QR code, app do banco). Pergunte — nunca assuma qual foi a causa, e nunca implique que o Pix ainda pode ser pago.',
    },
    {
      key: 'C', label: 'PRAZO REAL',
      intent: 'Comunicar um prazo real de expiração do Pix, se comprovado.',
      guidance: 'Informe o prazo real de expiração do Pix, citando apenas o dado de prazo fornecido no input.',
      requires: 'hasPaymentExpiryEvidence',
      fallbackGuidance: 'Sem prazo comprovado, não implique que o Pix continua válido ou disponível para pagamento. Gere uma variação que convide o cliente a verificar a situação atual do pagamento, sem afirmar que ainda pode ser concluído.',
      fallbackWarning: 'Direção C (prazo real) degradada: nenhum prazo de expiração comprovado está disponível para este Pix — a variação gerada evita implicar que o pagamento continua válido.',
    },
  ],
  BOLETO_PENDING: [
    {
      key: 'A', label: 'LEMBRETE',
      intent: 'Lembrar que o boleto está pendente, sem implicar que ainda é válido.',
      guidance: 'Informe de forma neutra que o pedido ainda consta com boleto pendente. Não afirme nem implique que o boleto ainda pode ser pago em qualquer lugar ou que continua válido.',
    },
    {
      key: 'B', label: 'FACILITAÇÃO / SEGUNDA VIA',
      intent: 'Facilitar a reemissão do boleto, se disponível.',
      guidance: 'Ofereça a segunda via do boleto usando exclusivamente o link/dado real fornecido no input.',
      requires: 'hasSecondCopySupport',
      fallbackGuidance: 'Sem confirmação de segunda via disponível, não ofereça reemissão nem implique que o boleto ainda pode ser pago. Ofereça apenas contato humano para verificar a situação do pedido.',
      fallbackWarning: 'Direção B (segunda via) degradada: não há confirmação de que a reemissão do boleto está disponível para este pedido — a variação gerada evita implicar que o pagamento ainda é possível.',
    },
    {
      key: 'C', label: 'PRAZO REAL',
      intent: 'Comunicar o vencimento real do boleto, se comprovado.',
      guidance: 'Informe o vencimento real do boleto, citando apenas o dado de prazo fornecido no input.',
      requires: 'hasPaymentExpiryEvidence',
      fallbackGuidance: 'Sem vencimento comprovado, não implique que o boleto ainda pode ser pago em qualquer banco ou lotérica. Ofereça verificar a situação do pedido junto ao atendimento, sem afirmar validade atual.',
      fallbackWarning: 'Direção C (prazo real) degradada: nenhum vencimento comprovado está disponível para este boleto — a variação gerada evita implicar que o pagamento continua válido.',
    },
  ],
  VIP: [
    {
      key: 'A', label: 'CURADORIA PERSONALIZADA',
      intent: 'Oferecer uma seleção pensada com base em produtos candidatos reais.',
      guidance: 'Proponha uma curadoria com base no histórico real de compras do cliente e nos produtos candidatos fornecidos no input. Nunca invente itens específicos que não vieram no input.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produtos candidatos reais fornecidos, não afirme ter preparado uma seleção de itens. Reconheça o perfil de compra do cliente de forma geral, com um ângulo diferente do da estratégia B (ex.: foco no histórico de compras, não na frequência como cliente).',
      fallbackWarning: 'Direção A (curadoria personalizada) degradada: nenhum produto candidato real foi fornecido — a variação gerada reconhece o perfil de compra sem afirmar uma curadoria específica.',
    },
    {
      key: 'B', label: 'RELACIONAMENTO',
      intent: 'Reconhecer o cliente como frequente/VIP, sem oferecer benefício não comprovado.',
      guidance: 'Reconheça o histórico de compras do cliente com tom de relacionamento, falando da frequência/tempo como cliente. Nunca ofereça desconto, brinde ou outro benefício não comprovado no input.',
    },
    {
      key: 'C', label: 'NOVIDADE / AFINIDADE DE CATEGORIA',
      intent: 'Apresentar novidade real relacionada ao interesse do cliente.',
      guidance: 'Apresente uma novidade relacionada à categoria de interesse do cliente, citando o produto candidato real fornecido no input.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produto candidato real fornecido, não afirme ter uma novidade para apresentar. Convide o cliente a manter contato, deixando claro que a recomendação de produto ainda está pendente.',
      fallbackWarning: 'Direção C (novidade / afinidade de categoria) degradada: nenhum produto candidato real foi fornecido — a variação gerada mantém contato sem afirmar novidade.',
    },
  ],
  RECENT_CUSTOMER: [
    {
      key: 'A', label: 'CROSS-SELL COMPLEMENTAR',
      intent: 'Sugerir um complemento real da compra recente.',
      guidance: 'Sugira um produto complementar real à compra recente, citando o produto candidato fornecido no input.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produto candidato real fornecido, não afirme ter separado um complemento. Agradeça a compra recente e reforce a disposição para ajudar no futuro (relacionamento pós-compra), com um ângulo diferente do da estratégia B.',
      fallbackWarning: 'Direção A (cross-sell complementar) degradada: nenhum produto candidato real foi fornecido — a variação gerada foca em relacionamento pós-compra, sem afirmar um complemento específico.',
    },
    {
      key: 'B', label: 'STYLE GUIDANCE / COMO COMBINAR',
      intent: 'Orientar como usar ou combinar especificamente o que já foi comprado.',
      guidance: 'Ofereça orientação de como combinar especificamente o produto comprado, usando só atributos reais fornecidos no input.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produto candidato real fornecido, não afirme saber o que o cliente comprou para sugerir combinações específicas. Ofereça orientação de estilo geral que não dependa de conhecer o item exato.',
      fallbackWarning: 'Direção B (style guidance) degradada: nenhum produto candidato real foi fornecido — a variação gerada oferece orientação geral, sem citar um item específico.',
    },
    {
      key: 'C', label: 'NOVIDADES RELACIONADAS',
      intent: 'Apresentar novidades reais relacionadas à categoria da compra.',
      guidance: 'Apresente novidades relacionadas à categoria real da compra recente, citando a evidência de categoria fornecida no input.',
      requires: 'hasCategoryEvidence',
      fallbackGuidance: 'Sem evidência real de categoria de interesse, não afirme que há novidades relacionadas à compra. Convide o cliente a conhecer o catálogo atual, sem prometer relação com a compra anterior.',
      fallbackWarning: 'Direção C (novidades relacionadas) degradada: nenhuma evidência real de categoria está disponível — a variação gerada convida a conhecer o catálogo atual, sem afirmar relação com a compra anterior.',
    },
  ],
  ENGAGED_NO_PURCHASE: [
    {
      key: 'A', label: 'VENDA ASSISTIDA',
      intent: 'Oferecer atendimento humano para destravar a decisão de compra.',
      guidance: 'Ofereça retomar a conversa com atendimento humano para ajudar na decisão de compra.',
    },
    {
      key: 'B', label: 'CURADORIA DE OPÇÕES',
      intent: 'Apresentar opções reais relevantes ao que foi conversado.',
      guidance: 'Apresente as opções reais fornecidas no input, relevantes ao que foi conversado.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produtos candidatos reais fornecidos, não afirme ter opções para apresentar. Convide o cliente a contar o que procura, para ajudar a encontrar depois.',
      fallbackWarning: 'Direção B (curadoria de opções) degradada: nenhum produto candidato real foi fornecido — a variação gerada convida o cliente a detalhar o que procura, em vez de apresentar opções.',
    },
    {
      key: 'C', label: 'REDUÇÃO DE FRICÇÃO',
      intent: 'Identificar e remover uma barreira específica à compra.',
      guidance: 'Pergunte objetivamente se algo impediu a compra (dúvida, preço, tamanho) e ofereça ajudar a resolver — nunca assuma qual foi a barreira.',
    },
  ],
  WINBACK: [
    {
      key: 'A', label: 'NOVIDADE',
      intent: 'Apresentar novidade real desde a última compra.',
      guidance: 'Apresente uma novidade real desde a última compra, citando o produto candidato fornecido no input.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produto candidato real fornecido, não afirme ter uma novidade para compartilhar. Reabra contato de forma genérica, deixando claro que ainda não há novidade específica de produto.',
      fallbackWarning: 'Direção A (novidade) degradada: nenhum produto candidato real foi fornecido — a variação gerada reabre contato sem afirmar novidade específica.',
    },
    {
      key: 'B', label: 'AFINIDADE DE CATEGORIA',
      intent: 'Reconectar com base na categoria de interesse real do histórico.',
      guidance: 'Reconecte com base na categoria de interesse real do histórico do cliente, citando a evidência de categoria fornecida no input.',
      requires: 'hasCategoryEvidence',
      fallbackGuidance: 'Sem evidência real de categoria de interesse, não afirme lembrar a categoria que o cliente costumava explorar. Baseie a reativação apenas no fato comprovado de inatividade, sem citar uma categoria específica.',
      fallbackWarning: 'Direção B (afinidade de categoria) degradada: nenhuma evidência real de categoria está disponível — a variação gerada se baseia apenas no tempo de inatividade, sem citar categoria.',
    },
    {
      key: 'C', label: 'REDESCOBERTA / RELACIONAMENTO',
      intent: 'Reabrir o relacionamento sem pressão comercial.',
      guidance: 'Reabra o relacionamento com tom de reconexão genuína. Nunca ofereça desconto ou outro benefício não comprovado no input.',
    },
  ],
  REPEAT_PURCHASE: [
    {
      key: 'A', label: 'COMPLEMENTO DA COMPRA ANTERIOR',
      intent: 'Sugerir um complemento real da compra anterior.',
      guidance: 'Sugira um complemento real da compra anterior, citando o produto candidato fornecido no input.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produto candidato real fornecido, não afirme ter um complemento que combina. Retome o relacionamento reconhecendo o tempo desde a última compra, sem afirmar uma combinação específica.',
      fallbackWarning: 'Direção A (complemento da compra anterior) degradada: nenhum produto candidato real foi fornecido — a variação gerada retoma o relacionamento, sem afirmar um complemento específico.',
    },
    {
      key: 'B', label: 'RENOVAÇÃO DE LOOK',
      intent: 'Sugerir renovação específica com base no padrão de compra real.',
      guidance: 'Sugira renovar especificamente o que já foi comprado, usando só atributos reais fornecidos no input.',
      requires: 'hasCandidateProducts',
      fallbackGuidance: 'Sem produto candidato real fornecido, não afirme conhecer peças específicas para combinar. Ofereça inspiração geral de novo look, sem afirmar uma combinação específica com o que foi comprado.',
      fallbackWarning: 'Direção B (renovação de look) degradada: nenhum produto candidato real foi fornecido — a variação gerada oferece inspiração geral, sem afirmar combinação específica.',
    },
    {
      key: 'C', label: 'NOVIDADES DA CATEGORIA DE AFINIDADE',
      intent: 'Apresentar novidades reais da categoria de afinidade do cliente.',
      guidance: 'Apresente novidades reais da categoria de afinidade do cliente, citando a evidência de categoria fornecida no input.',
      requires: 'hasCategoryEvidence',
      fallbackGuidance: 'Sem evidência real de categoria de afinidade, não afirme que há novidades na categoria que o cliente costuma comprar. Convide o cliente a ver o catálogo atual, sem prometer relação com compras anteriores.',
      fallbackWarning: 'Direção C (novidades da categoria de afinidade) degradada: nenhuma evidência real de categoria está disponível — a variação gerada convida a ver o catálogo atual, sem afirmar relação com a categoria de afinidade.',
    },
  ],
}

export interface DirectionFinding {
  strategyIndex: number
  expected: StrategyDirectionKey
  actual: string
  reason: string
}

// Confere que a IA respeitou a ordem/mapeamento A→0, B→1, C→2 pedido no
// prompt — não confia que "a ordem em que a IA respondeu" é a ordem certa.
export function auditDirectionAdherence(strategies: Array<{ direction: string }>, playbook: ResolvedDirection[]): DirectionFinding[] {
  const findings: DirectionFinding[] = []
  playbook.forEach((direction, index) => {
    const strategy = strategies[index]
    const actual = strategy?.direction ?? 'ausente'
    if (actual !== direction.key) {
      findings.push({
        strategyIndex: index,
        expected: direction.key,
        actual,
        reason: `Estratégia no índice ${index} deveria seguir a direção ${direction.key} (${direction.label}), mas veio marcada como "${actual}".`,
      })
    }
  })
  return findings
}

export function resolveStrategyDirections(type: OpportunityType, evidence: EvidenceFlags): ResolvedDirection[] {
  const definitions = PLAYBOOKS[type]
  return definitions.map(def => {
    const degraded = Boolean(def.requires) && !evidence[def.requires as keyof EvidenceFlags]
    return {
      key: def.key,
      label: def.label,
      intent: def.intent,
      guidance: degraded ? (def.fallbackGuidance ?? def.guidance) : def.guidance,
      degraded,
      requiredWarning: degraded ? (def.fallbackWarning ?? null) : null,
    }
  })
}
