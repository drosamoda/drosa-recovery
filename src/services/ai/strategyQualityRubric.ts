import { EmailStrategy, Strategy, WhatsappStrategy, isEmailStrategy, strategyText } from './aiProvider'
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

// Limites de e-mail: sinais de deliverabilidade/legibilidade, não regras de
// estilo. Assunto longo é cortado pela maioria dos clientes de e-mail.
const EMAIL_SUBJECT_MAX_LENGTH = 70
const EMAIL_BODY_MIN_WORDS = 30
const EMAIL_BODY_MAX_WORDS = 250

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function normalizeForCompare(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function productTruthResult(strategy: Strategy, context: RubricContext): RubricResult {
  return {
    criterion: 'Product Truth',
    score: strategy.productId === null ? 2 : context.product ? 2 : 0,
    notes: strategy.productId === null
      ? 'Nenhum produto citado — correto quando não há candidato real fornecido.'
      : context.product
        ? 'productId citado foi confirmado pela Nuvemshop.'
        : 'productId citado pela IA não foi confirmado — Product Truth reprovado.',
  }
}

function complianceResult(ownFindings: ComplianceFinding[]): RubricResult {
  return {
    criterion: 'Compliance',
    score: ownFindings.length === 0 ? 2 : 0,
    notes: ownFindings.length === 0
      ? 'Nenhuma alegação não comprovada detectada.'
      : `${ownFindings.length} alegação(ões) não comprovada(s) detectada(s): ${ownFindings.map(f => f.claim).join(', ')}.`,
  }
}

function differentiationResult(ownDistanceFindings: DistanceFinding[]): RubricResult {
  return {
    criterion: 'Strategic differentiation',
    score: ownDistanceFindings.length === 0 ? 2 : 0,
    notes: ownDistanceFindings.length === 0
      ? 'Nenhuma colisão de distância criativa com outra estratégia da mesma campanha.'
      : 'Texto muito parecido com o de outra estratégia gerada — ver Creative Distance.',
  }
}

function brandFitResult(ownFindings: ComplianceFinding[]): RubricResult {
  return {
    criterion: 'Brand fit',
    score: ownFindings.length === 0 ? 2 : 1,
    notes: 'Heurística: ausência de alegação não comprovada é o principal sinal de fit de marca disponível deterministicamente — não substitui revisão humana de tom.',
  }
}

function evaluateWhatsappQuality(strategy: WhatsappStrategy, context: RubricContext, ownComplianceFindings: ComplianceFinding[], ownDistanceFindings: DistanceFinding[]): RubricResult[] {
  const results: RubricResult[] = []

  results.push({
    criterion: 'Evidence adherence',
    score: strategy.message.trim().length === 0 ? 0 : strategy.warnings.length > 0 ? 1 : 2,
    notes: strategy.warnings.length > 0
      ? 'Estratégia registrou aviso(s) sobre dado insuficiente — aderência correta, não é penalizado por isso.'
      : 'Sem avisos registrados; assume-se que todo o conteúdo está apoiado nos dados fornecidos.',
  })

  results.push(productTruthResult(strategy, context))
  results.push(complianceResult(ownComplianceFindings))

  const words = wordCount(strategy.message)
  results.push({
    criterion: 'Specificity',
    score: words >= 8 ? 2 : words >= 4 ? 1 : 0,
    notes: `Mensagem com ${words} palavra(s).`,
  })

  results.push(differentiationResult(ownDistanceFindings))

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

  results.push(brandFitResult(ownComplianceFindings))
  return results
}

// Sinais de "assunto gritado": muitas letras em caixa alta ou várias
// exclamações. Determinístico; não julga tom, só deliverabilidade.
function subjectShoutingSignals(subject: string): string[] {
  const signals: string[] = []
  const letters = subject.replace(/[^A-Za-zÀ-ÿ]/g, '')
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, '')
  if (letters.length >= 8 && upper.length / letters.length > 0.6) signals.push('caixa alta')
  if ((subject.match(/!/g) ?? []).length > 1) signals.push('várias exclamações')
  if (EMOJI_RUN.test(subject)) signals.push('excesso de emojis')
  return signals
}

function emailSubjectNotes(subjectLength: number, shouting: string[]): string {
  const parts = [`Assunto com ${subjectLength} caractere(s)`]
  if (shouting.length) parts.push(`sinais de assunto "gritado": ${shouting.join(', ')}`)
  if (subjectLength > EMAIL_SUBJECT_MAX_LENGTH) parts.push(`acima de ${EMAIL_SUBJECT_MAX_LENGTH}, pode ser cortado`)
  return `${parts.join('; ')}.`
}

function evaluateEmailQuality(strategy: EmailStrategy, context: RubricContext, ownComplianceFindings: ComplianceFinding[], ownDistanceFindings: DistanceFinding[]): RubricResult[] {
  const results: RubricResult[] = []

  results.push({
    criterion: 'Evidence adherence',
    score: strategyText(strategy).trim().length === 0 ? 0 : strategy.warnings.length > 0 ? 1 : 2,
    notes: strategy.warnings.length > 0
      ? 'Estratégia registrou aviso(s) sobre dado insuficiente — aderência correta, não é penalizado por isso.'
      : 'Sem avisos registrados; assume-se que todo o conteúdo está apoiado nos dados fornecidos.',
  })

  results.push(productTruthResult(strategy, context))
  results.push(complianceResult(ownComplianceFindings))

  const bodyWords = wordCount(strategy.body)
  results.push({
    criterion: 'Specificity',
    score: bodyWords >= 30 ? 2 : bodyWords >= 12 ? 1 : 0,
    notes: `Corpo com ${bodyWords} palavra(s).`,
  })

  results.push(differentiationResult(ownDistanceFindings))

  const ctaWords = wordCount(strategy.cta)
  results.push({
    criterion: 'CTA clarity',
    score: strategy.cta.trim().length === 0 ? 0 : ctaWords <= 6 ? 2 : 1,
    notes: `CTA com ${ctaWords} palavra(s).`,
  })

  const subjectLength = strategy.subject.trim().length
  const shouting = subjectShoutingSignals(strategy.subject)
  results.push({
    criterion: 'Email subject',
    score: subjectLength === 0 || subjectLength > EMAIL_SUBJECT_MAX_LENGTH * 1.5
      ? 0
      : subjectLength > EMAIL_SUBJECT_MAX_LENGTH || shouting.length > 0
        ? 1
        : 2,
    notes: emailSubjectNotes(subjectLength, shouting),
  })

  const subjectNorm = normalizeForCompare(strategy.subject)
  const preheaderNorm = normalizeForCompare(strategy.preheader)
  const repeatsSubject = preheaderNorm.length === 0 || preheaderNorm === subjectNorm || preheaderNorm.includes(subjectNorm) || subjectNorm.includes(preheaderNorm)
  results.push({
    criterion: 'Email preheader',
    score: strategy.preheader.trim().length === 0 ? 0 : repeatsSubject ? 0 : 2,
    notes: repeatsSubject ? 'Preheader vazio ou apenas repete o assunto — não acrescenta informação.' : 'Preheader complementa o assunto sem repeti-lo.',
  })

  results.push({
    criterion: 'Email suitability',
    score: bodyWords === 0
      ? 0
      : bodyWords < EMAIL_BODY_MIN_WORDS / 2 || bodyWords > EMAIL_BODY_MAX_WORDS * 1.6
        ? 0
        : bodyWords < EMAIL_BODY_MIN_WORDS || bodyWords > EMAIL_BODY_MAX_WORDS || EMOJI_RUN.test(strategy.body)
          ? 1
          : 2,
    notes: `Corpo com ${bodyWords} palavra(s); faixa recomendada ${EMAIL_BODY_MIN_WORDS}–${EMAIL_BODY_MAX_WORDS}.`,
  })

  results.push(brandFitResult(ownComplianceFindings))
  return results
}

export function evaluateStrategyQuality(strategy: Strategy, context: RubricContext): RubricResult[] {
  const ownComplianceFindings = context.complianceFindings.filter(f => f.strategyIndex === context.strategyIndex)
  const ownDistanceFindings = context.distanceFindings.filter(f => f.strategyIndexA === context.strategyIndex || f.strategyIndexB === context.strategyIndex)
  return isEmailStrategy(strategy)
    ? evaluateEmailQuality(strategy, context, ownComplianceFindings, ownDistanceFindings)
    : evaluateWhatsappQuality(strategy, context, ownComplianceFindings, ownDistanceFindings)
}
