import { Strategy } from './aiProvider'
import { ProductTruth } from '../productTruthService'
import { ComplianceFinding } from './complianceService'
import { DistanceFinding } from './strategyDistanceService'

// Avaliador determinístico para DIAGNÓSTICO de qualidade — nunca para prever
// conversão, receita ou "qual estratégia vende mais". Cada critério é uma
// heurística verificável a partir do próprio texto gerado e dos achados já
// calculados por Product Truth / Compliance / Creative Distance, nunca um
// palpite novo sobre desempenho futuro.
export type RubricScore = 0 | 1 | 2

export interface RubricResult {
  criterion: string
  score: RubricScore
  notes: string
}

export interface RubricContext {
  product: ProductTruth | null
  complianceFindings: ComplianceFinding[]
  distanceFindings: DistanceFinding[]
  strategyIndex: number
}

const WHATSAPP_MAX_MESSAGE_LENGTH = 700
// Presença de 3+ emojis seguidos é o sinal mais comum de mensagem promocional
// "gritada" — não é uma regra de estilo, é heurística de adequação ao canal.
const EMOJI_RUN = /(\p{Emoji_Presentation}){3,}/u

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function evaluateStrategyQuality(strategy: Strategy, context: RubricContext): RubricResult[] {
  const ownComplianceFindings = context.complianceFindings.filter(f => f.strategyIndex === context.strategyIndex)
  const ownDistanceFindings = context.distanceFindings.filter(f => f.strategyIndexA === context.strategyIndex || f.strategyIndexB === context.strategyIndex)

  const results: RubricResult[] = []

  results.push({
    criterion: 'Evidence adherence',
    score: strategy.message.trim().length === 0 ? 0 : strategy.warnings.length > 0 ? 1 : 2,
    notes: strategy.warnings.length > 0
      ? 'Estratégia registrou aviso(s) sobre dado insuficiente — aderência correta, não é penalizado por isso.'
      : 'Sem avisos registrados; assume-se que todo o conteúdo está apoiado nos dados fornecidos.',
  })

  results.push({
    criterion: 'Product Truth',
    score: strategy.productId === null ? 2 : context.product ? 2 : 0,
    notes: strategy.productId === null
      ? 'Nenhum produto citado — correto quando não há candidato real fornecido.'
      : context.product
        ? 'productId citado foi confirmado pela Nuvemshop.'
        : 'productId citado pela IA não foi confirmado — Product Truth reprovado.',
  })

  results.push({
    criterion: 'Compliance',
    score: ownComplianceFindings.length === 0 ? 2 : 0,
    notes: ownComplianceFindings.length === 0
      ? 'Nenhuma alegação não comprovada detectada.'
      : `${ownComplianceFindings.length} alegação(ões) não comprovada(s) detectada(s): ${ownComplianceFindings.map(f => f.claim).join(', ')}.`,
  })

  const words = wordCount(strategy.message)
  results.push({
    criterion: 'Specificity',
    score: words >= 8 ? 2 : words >= 4 ? 1 : 0,
    notes: `Mensagem com ${words} palavra(s).`,
  })

  results.push({
    criterion: 'Strategic differentiation',
    score: ownDistanceFindings.length === 0 ? 2 : 0,
    notes: ownDistanceFindings.length === 0
      ? 'Nenhuma colisão de distância criativa com outra estratégia da mesma campanha.'
      : 'Texto muito parecido com o de outra estratégia gerada — ver Creative Distance.',
  })

  const ctaWords = wordCount(strategy.cta)
  results.push({
    criterion: 'CTA clarity',
    score: strategy.cta.trim().length === 0 ? 0 : ctaWords <= 8 ? 2 : 1,
    notes: `CTA com ${ctaWords} palavra(s).`,
  })

  const messageLength = strategy.message.length
  results.push({
    criterion: 'WhatsApp suitability',
    score: messageLength === 0
      ? 0
      : messageLength > WHATSAPP_MAX_MESSAGE_LENGTH
        ? 0
        : EMOJI_RUN.test(strategy.message)
          ? 1
          : 2,
    notes: messageLength > WHATSAPP_MAX_MESSAGE_LENGTH
      ? `Mensagem com ${messageLength} caracteres — longa demais para WhatsApp.`
      : `Mensagem com ${messageLength} caractere(s).`,
  })

  results.push({
    criterion: 'Brand fit',
    score: ownComplianceFindings.length === 0 ? 2 : 1,
    notes: 'Heurística: ausência de alegação não comprovada é o principal sinal de fit de marca disponível deterministicamente — não substitui revisão humana de tom.',
  })

  return results
}
