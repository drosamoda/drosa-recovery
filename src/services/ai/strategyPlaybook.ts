import { OpportunityType } from '../aiOpportunityEngine'

export type StrategyDirectionKey = 'A' | 'B' | 'C'

// Nenhuma dessas fontes existe hoje no modelo de dados real: Order/Opportunity
// não carregam prazo de pagamento nem indicação de segunda via de boleto —
// por isso campaignService.ts sempre passa as duas como false. Existem como
// parâmetro explícito (em vez de hardcoded dentro deste arquivo) para o dia em
// que uma fonte real desses dados existir, e para o resolver ser testável nos
// dois caminhos sem fingir que o dado existe agora.
export interface EvidenceFlags {
  hasVerifiedPaymentDeadline: boolean
  hasVerifiedSecondCopySupport: boolean
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
// dependem não está comprovado, em vez de a IA inventar o dado.
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
      guidance: 'Reforce o valor do produto que já está no carrinho usando só atributos reais fornecidos no input. Nunca use um adjetivo de desempenho ou benefício não comprovado.',
    },
  ],
  PIX_PENDING: [
    {
      key: 'A', label: 'LEMBRETE DE PAGAMENTO',
      intent: 'Lembrar que o Pix está aguardando pagamento.',
      guidance: 'Lembre objetivamente que o pagamento via Pix está pendente e ainda pode ser concluído.',
    },
    {
      key: 'B', label: 'ASSISTÊNCIA DE PAGAMENTO',
      intent: 'Oferecer ajuda para concluir um pagamento que não foi finalizado.',
      guidance: 'Ofereça ajuda caso o cliente tenha tido dificuldade para pagar (QR code, app do banco). Pergunte — nunca assuma qual foi a causa.',
    },
    {
      key: 'C', label: 'PRAZO REAL',
      intent: 'Comunicar um prazo real de expiração do Pix, se comprovado.',
      guidance: 'Informe o prazo real de expiração do Pix, citando apenas o dado de prazo fornecido no input.',
      requires: 'hasVerifiedPaymentDeadline',
      fallbackGuidance: 'Sem um prazo real comprovado no input, não mencione vencimento nem urgência de tempo. Gere uma variação da estratégia A com um ângulo diferente (ex.: reforçar a simplicidade de pagar via Pix), sem inventar prazo.',
      fallbackWarning: 'Direção C (prazo real) degradada: nenhum prazo de expiração comprovado está disponível para este Pix — a variação gerada evita menção a prazo.',
    },
  ],
  BOLETO_PENDING: [
    {
      key: 'A', label: 'LEMBRETE',
      intent: 'Lembrar que o boleto está pendente de pagamento.',
      guidance: 'Lembre objetivamente que o boleto está pendente de pagamento.',
    },
    {
      key: 'B', label: 'FACILITAÇÃO / SEGUNDA VIA',
      intent: 'Facilitar a reemissão do boleto, se disponível.',
      guidance: 'Ofereça a segunda via do boleto usando exclusivamente o link/dado real fornecido no input.',
      requires: 'hasVerifiedSecondCopySupport',
      fallbackGuidance: 'Sem confirmação de que uma segunda via está disponível, não ofereça reemissão. Ofereça ajuda humana geral para resolver o pagamento pendente.',
      fallbackWarning: 'Direção B (segunda via) degradada: não há confirmação de que a reemissão do boleto está disponível para este pedido — a variação gerada oferece assistência geral no lugar.',
    },
    {
      key: 'C', label: 'PRAZO REAL',
      intent: 'Comunicar o vencimento real do boleto, se comprovado.',
      guidance: 'Informe o vencimento real do boleto, citando apenas o dado de prazo fornecido no input.',
      requires: 'hasVerifiedPaymentDeadline',
      fallbackGuidance: 'Sem um vencimento real comprovado no input, não mencione data limite nem urgência de tempo. Gere uma variação com ângulo diferente (ex.: facilidade de pagar em qualquer banco/lotérica), sem inventar prazo.',
      fallbackWarning: 'Direção C (prazo real) degradada: nenhum vencimento comprovado está disponível para este boleto — a variação gerada evita menção a prazo.',
    },
  ],
  VIP: [
    {
      key: 'A', label: 'CURADORIA PERSONALIZADA',
      intent: 'Oferecer uma seleção pensada com base no histórico real do cliente.',
      guidance: 'Proponha uma curadoria com base no histórico real de compras do cliente. Nunca invente itens específicos que não vieram no input.',
    },
    {
      key: 'B', label: 'RELACIONAMENTO',
      intent: 'Reconhecer o cliente como frequente/VIP, sem oferecer benefício não comprovado.',
      guidance: 'Reconheça o histórico de compras do cliente com tom de relacionamento. Nunca ofereça desconto, brinde ou outro benefício não comprovado no input.',
    },
    {
      key: 'C', label: 'NOVIDADE / AFINIDADE DE CATEGORIA',
      intent: 'Apresentar novidade relacionada ao interesse real do cliente.',
      guidance: 'Apresente uma novidade relacionada à categoria de interesse do cliente, somente se um produto candidato real for fornecido no input — senão, diga explicitamente que ainda não há recomendação de produto.',
    },
  ],
  RECENT_CUSTOMER: [
    {
      key: 'A', label: 'CROSS-SELL COMPLEMENTAR',
      intent: 'Sugerir um complemento real da compra recente.',
      guidance: 'Sugira um produto complementar à compra recente, somente se um produto candidato real for fornecido no input.',
    },
    {
      key: 'B', label: 'STYLE GUIDANCE / COMO COMBINAR',
      intent: 'Orientar como usar ou combinar o que já foi comprado.',
      guidance: 'Ofereça orientação de como combinar ou aproveitar melhor o que foi comprado recentemente, usando só atributos reais fornecidos no input.',
    },
    {
      key: 'C', label: 'NOVIDADES RELACIONADAS',
      intent: 'Apresentar novidades relacionadas à categoria da compra.',
      guidance: 'Apresente novidades relacionadas à categoria da compra recente, somente se um produto candidato real for fornecido no input.',
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
      intent: 'Apresentar opções relevantes ao que foi conversado.',
      guidance: 'Apresente opções relevantes, somente se produtos candidatos reais forem fornecidos no input.',
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
      intent: 'Apresentar novidade desde a última compra.',
      guidance: 'Apresente uma novidade desde a última compra, somente se um produto candidato real for fornecido no input.',
    },
    {
      key: 'B', label: 'AFINIDADE DE CATEGORIA',
      intent: 'Reconectar com base na categoria de interesse do histórico real.',
      guidance: 'Reconecte com base na categoria de interesse do histórico real do cliente fornecido no input.',
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
      guidance: 'Sugira um complemento da compra anterior, somente se um produto candidato real for fornecido no input.',
    },
    {
      key: 'B', label: 'RENOVAÇÃO DE LOOK',
      intent: 'Sugerir renovação com base no padrão de compra real.',
      guidance: 'Sugira renovar o que já foi comprado, usando só atributos reais fornecidos no input.',
    },
    {
      key: 'C', label: 'NOVIDADES DA CATEGORIA DE AFINIDADE',
      intent: 'Apresentar novidades da categoria de afinidade do cliente.',
      guidance: 'Apresente novidades da categoria de afinidade do cliente, somente se um produto candidato real for fornecido no input.',
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
