import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { EMAIL_HASH_PEPPER_MIN_LENGTH, InvalidConsentEmailError, hashEmail } from './emailConsentService'

// Email Audience Engine — segmentação DETERMINÍSTICA de clientes por e-mail.
// A IA nunca participa daqui: todo número deste arquivo vem de agregação real
// no PostgreSQL + regras de classificação em TypeScript puro (testáveis sem
// banco). A IA só recebe o resultado depois (contagens agregadas, nunca
// e-mail/nome/telefone/pedido).
//
// Identidade = e-mail normalizado (lower + trim) — Order.customerEmail, com
// fallback para o e-mail do Customer ligado ao pedido. Cliente/pedido sem
// nenhum e-mail fica FORA do universo de e-mail e só aparece em `base`
// (dataQuality). A query devolve UMA linha compacta por identidade (contagens
// e datas, nunca o e-mail) — sem LIMIT: a base pode passar de 50 mil.
//
// Compra válida = paymentStatus 'paid' e status fora de cancelled/canceled/
// refunded (mesma definição de remarketingService). Data da compra =
// Order.sourceCreatedAt, SEM fallback para createdAt (createdAt é o instante
// da gravação no nosso banco, não a data real do pedido — mesmo padrão já
// adotado por remarketingService/aiOpportunityEngine). Pedido pago sem data
// nunca é datado por chute: marca `undatedPaidOrders`.

// Fonte de consentimento de e-mail. O ledger/projeção já existe; produção só
// declara CONFIGURED depois do backfill/reconciliação validados. Em qualquer
// outro ambiente o default é NOT_CONFIGURED, mantendo o sistema fail-closed.
// WhatsappConsent e Customer.optOut continuam exclusivos de WhatsApp.
export const EMAIL_MARKETING_CONSENT_SOURCE: 'NOT_CONFIGURED' | 'CONFIGURED' = env.EMAIL_MARKETING_CONSENT_SOURCE
// Não existe log/histórico de envio de e-mail — cooldown não é aplicável.
export const EMAIL_COOLDOWN_STATUS = 'NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY' as const

// Janela de "carrinho abandonado recente" para e-mail. Constante nomeada, não
// heurística escondida: um checkout com e-mail só entra no segmento se foi
// abandonado dentro desta janela e ainda não virou pedido.
export const EMAIL_CART_WINDOW_DAYS = 7
// Janela em que uma campanha de CICLO DE VIDA (pós-compra, segunda compra,
// recorrente, VIP) tem prioridade sobre reativação. Depois disso o cliente
// passa a ser tratado como "a reativar" — evita a mesma pessoa aparecer como
// "recente" e "inativa" ao mesmo tempo.
export const EMAIL_LIFECYCLE_WINDOW_DAYS = 60

export const EMAIL_SEGMENT_KEYS = [
  'ALL_EMAIL_CUSTOMERS',
  'ONE_TIME_BUYERS',
  'REPEAT_BUYERS',
  'VIP_CUSTOMERS',
  'RECENT_BUYERS_0_30D',
  'LAPSED_31_60D',
  'LAPSED_61_90D',
  'LAPSED_91_180D',
  'LAPSED_181_365D',
  'DORMANT_365D_PLUS',
  'NO_PURCHASE_CUSTOMERS',
  'HIGH_VALUE_NON_VIP',
  'RECENT_CART_ABANDONER',
  'UNDATED_BUYERS',
  'CATEGORY_AFFINITY',
  'ENGAGED_EMAIL_NO_PURCHASE',
  'BROWSE_NO_PURCHASE',
] as const
export type EmailSegmentKey = typeof EMAIL_SEGMENT_KEYS[number]

// Buckets de última compra — MUTUAMENTE EXCLUSIVOS por construção (cada
// cliente cai em exatamente um, decidido por faixa de dias inteiros).
export const RECENCY_BUCKETS = ['0_30', '31_60', '61_90', '91_180', '181_365', '365_PLUS'] as const
export type RecencyBucket = typeof RECENCY_BUCKETS[number]
export type CustomerRecency = RecencyBucket | 'UNDATED' | 'NO_PURCHASE'

// Trilhas de prioridade (Fase 6). Um cliente é "reivindicado" por exatamente
// UMA trilha — a de maior prioridade cujo predicado ele satisfaz — para que
// duas campanhas contraditórias nunca disputem a mesma pessoa na mesma janela.
// Ordem pedida: transacionais > abandono > pós-compra > segunda compra >
// recorrente > VIP > reativação > geral. (Transacionais são eventos que já
// existem fora deste módulo — não fazem parte do universo de campanha.)
export const TRACKS = ['CART_RECOVERY', 'POST_PURCHASE', 'SECOND_PURCHASE', 'REPEAT_ACTIVE', 'VIP_RELATIONSHIP', 'REACTIVATION', 'FIRST_PURCHASE', 'GENERAL'] as const
export type EmailTrack = typeof TRACKS[number]
export const TRACK_PRIORITY: Record<EmailTrack, number> = {
  CART_RECOVERY: 2,
  POST_PURCHASE: 3,
  SECOND_PURCHASE: 4,
  REPEAT_ACTIVE: 5,
  VIP_RELATIONSHIP: 6,
  REACTIVATION: 7,
  FIRST_PURCHASE: 7,
  GENERAL: 8,
}

// Linha compacta por identidade (e-mail). Nunca contém o e-mail em si.
export interface EmailIdentityRow {
  validEmail: boolean
  paidOrderCount: number
  paidTotal: number
  lastPaidAt: Date | null
  undatedPaidOrders: number
  recentAbandonedCart: boolean
  whatsappOptOut: boolean
}

export interface EmailBaseQuality {
  totalCustomers: number
  customersWithoutEmail: number
  paidOrders: number
  paidOrdersWithoutEmail: number
  paidOrdersWithoutDate: number
}

export type EmailSegmentStatus = 'READY' | 'NEEDS_DATA'
export type EmailEligibilityStatus = 'EMAIL_CONSENT_SOURCE_NOT_CONFIGURED' | 'ELIGIBLE_VERIFIED' | 'NEEDS_DATA'

export interface EmailSegmentExclusion { reason: string; count: number; note: string }

export interface EmailSegmentSummary {
  segmentKey: EmailSegmentKey
  name: string
  description: string
  objective: string
  status: EmailSegmentStatus
  // null quando o dado necessário não existe (NEEDS_DATA) — nunca um 0 inventado.
  audienceCount: number | null
  withValidEmailCount: number | null
  // SEMPRE null enquanto EMAIL_MARKETING_CONSENT_SOURCE = NOT_CONFIGURED.
  sendEligibleCount: number | null
  // Excluídos por motivo COMPROVADO (e-mail inválido). Não inclui "sem
  // consentimento verificado" — isso é elegibilidade não validada, não bloqueio.
  blockedCount: number | null
  eligibilityStatus: EmailEligibilityStatus
  dataQuality: { level: 'OK' | 'PARTIAL' | 'NEEDS_DATA'; notes: string[] }
  lastPurchaseRange: string | null
  priority: number
  recommendedCooldownDays: number
  cooldownStatus: typeof EMAIL_COOLDOWN_STATUS
  exclusions: EmailSegmentExclusion[]
  // Quantos membros deste segmento cada trilha reivindica (soma = audienceCount).
  trackBreakdown: Record<EmailTrack, number>
  missingData: string | null
}

// Estado do filtro de supressão neste snapshot.
//   APPLIED     → e-mails suprimidos foram EXCLUÍDOS de base e segmentos
//                 (`excludedCount` diz quantos; 0 = lista vazia ou nenhum deles no pool).
//   UNAVAILABLE → o filtro NÃO pôde ser aplicado (pepper ausente, tabela ainda
//                 não migrada, falha na leitura) e as contagens podem incluir
//                 suprimidos. É só informativo: nenhuma contagem daqui autoriza
//                 envio (sendEligibleCount é null) e o gate por destinatário
//                 continua a barreira real.
export type EmailSuppressionFilterReason = 'PEPPER_NOT_CONFIGURED' | 'LOOKUP_FAILED' | 'NOT_EVALUATED'
export interface EmailSuppressionFilterInfo {
  status: 'APPLIED' | 'UNAVAILABLE'
  excludedCount: number
  reason: EmailSuppressionFilterReason | null
}

export interface EmailAudienceSnapshot {
  generatedAt: string
  consentSource: 'NOT_CONFIGURED' | 'CONFIGURED'
  suppression: EmailSuppressionFilterInfo
  sendEligibility: 'NOT_READY' | 'READY'
  cooldownStatus: typeof EMAIL_COOLDOWN_STATUS
  base: EmailBaseQuality & { emailKnown: number; emailValid: number; emailInvalid: number; buyers: number; buyersWithUndatedOrders: number }
  segments: EmailSegmentSummary[]
  // Prova numérica de que os buckets de recência não se sobrepõem.
  recencyCheck: { bucketsSum: number; datedBuyers: number; undatedBuyers: number; buyers: number; overlapFree: boolean }
  vipThresholds: { minimumOrders: number; minimumSpend: number }
  windows: { cartWindowDays: number; lifecycleWindowDays: number }
}

interface SegmentMeta {
  name: string
  description: string
  objective: string
  lastPurchaseRange: string | null
  priority: number
  recommendedCooldownDays: number
  missingData?: string
}

const DAY_MS = 86_400_000

// priority aqui é a prioridade DO SEGMENTO como alvo (1 = mais urgente),
// alinhada às trilhas acima: carrinho 2, pós-compra 3, segunda compra 4,
// recorrente 5, VIP 6, reativação 7, geral 8.
export const SEGMENT_META: Record<EmailSegmentKey, SegmentMeta> = {
  ALL_EMAIL_CUSTOMERS: { name: 'Toda a base com e-mail', description: 'Todos os clientes com e-mail cadastrado (válido ou não).', objective: 'Relacionamento e descoberta do catálogo', lastPurchaseRange: null, priority: 8, recommendedCooldownDays: 7 },
  ONE_TIME_BUYERS: { name: 'Comprou 1 vez', description: 'Exatamente 1 compra paga válida.', objective: 'Gerar a segunda compra', lastPurchaseRange: null, priority: 4, recommendedCooldownDays: 14 },
  REPEAT_BUYERS: { name: 'Comprou 2+ vezes', description: '2 ou mais compras pagas válidas.', objective: 'Relacionamento e recompra', lastPurchaseRange: null, priority: 5, recommendedCooldownDays: 14 },
  VIP_CUSTOMERS: { name: 'Clientes VIP', description: 'Atingem os limites VIP já configurados (pedidos pagos e valor gasto).', objective: 'Relacionamento sem benefício inventado', lastPurchaseRange: null, priority: 6, recommendedCooldownDays: 21 },
  RECENT_BUYERS_0_30D: { name: 'Compraram há 0–30 dias', description: 'Última compra paga válida entre 0 e 30 dias.', objective: 'Pós-compra e satisfação', lastPurchaseRange: '0–30 dias', priority: 3, recommendedCooldownDays: 14 },
  LAPSED_31_60D: { name: 'Sem comprar há 31–60 dias', description: 'Última compra paga válida entre 31 e 60 dias.', objective: 'Reativação leve', lastPurchaseRange: '31–60 dias', priority: 7, recommendedCooldownDays: 21 },
  LAPSED_61_90D: { name: 'Sem comprar há 61–90 dias', description: 'Última compra paga válida entre 61 e 90 dias.', objective: 'Reativar com novidades desde a última compra', lastPurchaseRange: '61–90 dias', priority: 7, recommendedCooldownDays: 21 },
  LAPSED_91_180D: { name: 'Sem comprar há 91–180 dias', description: 'Última compra paga válida entre 91 e 180 dias.', objective: 'Reconquistar', lastPurchaseRange: '91–180 dias', priority: 7, recommendedCooldownDays: 30 },
  LAPSED_181_365D: { name: 'Sem comprar há 181–365 dias', description: 'Última compra paga válida entre 181 e 365 dias.', objective: 'Reativação forte', lastPurchaseRange: '181–365 dias', priority: 7, recommendedCooldownDays: 45 },
  DORMANT_365D_PLUS: { name: 'Inativos há mais de 365 dias', description: 'Última compra paga válida há mais de 365 dias.', objective: 'Reabrir o relacionamento', lastPurchaseRange: 'mais de 365 dias', priority: 7, recommendedCooldownDays: 60 },
  NO_PURCHASE_CUSTOMERS: { name: 'Nunca comprou', description: 'Cliente conhecido com e-mail, mas nenhuma compra paga válida.', objective: 'Gerar a primeira compra', lastPurchaseRange: null, priority: 7, recommendedCooldownDays: 21 },
  HIGH_VALUE_NON_VIP: { name: 'Alto valor, ainda não VIP', description: 'Valor gasto já atinge o limite VIP, mas o número de pedidos ainda não.', objective: 'Levar ao próximo pedido / relacionamento', lastPurchaseRange: null, priority: 6, recommendedCooldownDays: 21 },
  RECENT_CART_ABANDONER: { name: 'Carrinho abandonado recente', description: `Checkout com e-mail abandonado nos últimos ${EMAIL_CART_WINDOW_DAYS} dias, sem pedido pago depois.`, objective: 'Recuperar o carrinho', lastPurchaseRange: null, priority: 2, recommendedCooldownDays: 3 },
  UNDATED_BUYERS: { name: 'Compradores sem data confiável', description: 'Têm compra paga válida, mas nenhuma com data de origem confiável — não entram em nenhum bucket de recência.', objective: 'Qualidade de dados (não é público de campanha)', lastPurchaseRange: null, priority: 8, recommendedCooldownDays: 30 },
  CATEGORY_AFFINITY: { name: 'Afinidade de categoria', description: 'Clientes agrupados pela categoria de produto que mais compram.', objective: 'Campanhas por categoria de interesse', lastPurchaseRange: null, priority: 5, recommendedCooldownDays: 21, missingData: 'Dados necessários ainda não são coletados: nenhum pedido/produto armazenado tem categoria.' },
  ENGAGED_EMAIL_NO_PURCHASE: { name: 'Engajou por e-mail e não comprou', description: 'Abriu/clicou em e-mails e ainda não comprou.', objective: 'Converter interesse demonstrado', lastPurchaseRange: null, priority: 7, recommendedCooldownDays: 14, missingData: 'Dados necessários ainda não são coletados: não existe rastreamento de abertura/clique de e-mail.' },
  BROWSE_NO_PURCHASE: { name: 'Navegou e não comprou', description: 'Visitou produtos no site e não comprou.', objective: 'Recuperar interesse de navegação', lastPurchaseRange: null, priority: 2, recommendedCooldownDays: 7, missingData: 'Dados necessários ainda não são coletados: não existe rastreamento de navegação por cliente.' },
}

export const NEEDS_DATA_SEGMENTS: ReadonlySet<EmailSegmentKey> = new Set<EmailSegmentKey>(['CATEGORY_AFFINITY', 'ENGAGED_EMAIL_NO_PURCHASE', 'BROWSE_NO_PURCHASE'])

// ── Classificação pura (sem I/O) ──────────────────────────────────────────────────────────────

export function ageInDays(lastPaidAt: Date, now: Date): number {
  return Math.floor((now.getTime() - lastPaidAt.getTime()) / DAY_MS)
}

export function bucketForAge(age: number): RecencyBucket {
  if (age <= 30) return '0_30'
  if (age <= 60) return '31_60'
  if (age <= 90) return '61_90'
  if (age <= 180) return '91_180'
  if (age <= 365) return '181_365'
  return '365_PLUS'
}

export function classifyRecency(row: Pick<EmailIdentityRow, 'paidOrderCount' | 'lastPaidAt'>, now: Date): CustomerRecency {
  if (row.paidOrderCount <= 0) return 'NO_PURCHASE'
  if (!row.lastPaidAt) return 'UNDATED'
  const age = ageInDays(row.lastPaidAt, now)
  // Data no futuro é anomalia de dado, não "compra muito recente".
  if (age < 0) return 'UNDATED'
  return bucketForAge(age)
}

export function isVip(row: Pick<EmailIdentityRow, 'paidOrderCount' | 'paidTotal'>): boolean {
  return row.paidOrderCount >= env.VIP_MIN_ORDERS && row.paidTotal >= env.VIP_MIN_SPEND
}

export function isHighValueNonVip(row: Pick<EmailIdentityRow, 'paidOrderCount' | 'paidTotal'>): boolean {
  return row.paidTotal >= env.VIP_MIN_SPEND && row.paidOrderCount < env.VIP_MIN_ORDERS
}

const LIFECYCLE_BUCKETS: ReadonlySet<CustomerRecency> = new Set<CustomerRecency>(['0_30', '31_60'])
const LAPSED_BUCKETS: ReadonlySet<CustomerRecency> = new Set<CustomerRecency>(['61_90', '91_180', '181_365', '365_PLUS'])

// Regra de prioridade/conflito: a PRIMEIRA trilha cujo predicado o cliente
// satisfaz o reivindica. Compra nova muda paidOrderCount/lastPaidAt e portanto
// tira o cliente de REACTIVATION automaticamente no próximo cálculo.
export function assignPrimaryTrack(row: EmailIdentityRow, recency: CustomerRecency): EmailTrack {
  if (row.recentAbandonedCart) return 'CART_RECOVERY'
  if (row.paidOrderCount === 1 && recency === '0_30') return 'POST_PURCHASE'
  if (row.paidOrderCount === 1 && recency === '31_60') return 'SECOND_PURCHASE'
  if (row.paidOrderCount >= 2 && !isVip(row) && LIFECYCLE_BUCKETS.has(recency)) return 'REPEAT_ACTIVE'
  if (isVip(row) && LIFECYCLE_BUCKETS.has(recency)) return 'VIP_RELATIONSHIP'
  if (LAPSED_BUCKETS.has(recency)) return 'REACTIVATION'
  if (recency === 'NO_PURCHASE') return 'FIRST_PURCHASE'
  return 'GENERAL'
}

const RECENCY_TO_SEGMENT: Partial<Record<CustomerRecency, EmailSegmentKey>> = {
  '0_30': 'RECENT_BUYERS_0_30D',
  '31_60': 'LAPSED_31_60D',
  '61_90': 'LAPSED_61_90D',
  '91_180': 'LAPSED_91_180D',
  '181_365': 'LAPSED_181_365D',
  '365_PLUS': 'DORMANT_365D_PLUS',
  UNDATED: 'UNDATED_BUYERS',
  NO_PURCHASE: 'NO_PURCHASE_CUSTOMERS',
}

export function segmentsForRow(row: EmailIdentityRow, recency: CustomerRecency): EmailSegmentKey[] {
  const segments: EmailSegmentKey[] = ['ALL_EMAIL_CUSTOMERS']
  if (row.paidOrderCount === 1) segments.push('ONE_TIME_BUYERS')
  if (row.paidOrderCount >= 2) segments.push('REPEAT_BUYERS')
  if (isVip(row)) segments.push('VIP_CUSTOMERS')
  if (isHighValueNonVip(row)) segments.push('HIGH_VALUE_NON_VIP')
  if (row.recentAbandonedCart) segments.push('RECENT_CART_ABANDONER')
  const recencySegment = RECENCY_TO_SEGMENT[recency]
  if (recencySegment) segments.push(recencySegment)
  return segments
}

function emptyTrackBreakdown(): Record<EmailTrack, number> {
  return { CART_RECOVERY: 0, POST_PURCHASE: 0, SECOND_PURCHASE: 0, REPEAT_ACTIVE: 0, VIP_RELATIONSHIP: 0, REACTIVATION: 0, FIRST_PURCHASE: 0, GENERAL: 0 }
}

interface Accumulator { audience: number; valid: number; whatsappOptOut: number; timingUncertain: number; tracks: Record<EmailTrack, number> }

// ── Snapshot puro: linhas por identidade → resumo de segmentos ────────────────────────────────

// `suppression` descreve o que já foi feito com `rows` ANTES de chegarem aqui
// (a exclusão dos suprimidos acontece na leitura, ver
// loadEmailIdentityRowsExcludingSuppressed). O construtor puro não filtra nada:
// sem esse argumento declara honestamente que o filtro não foi avaliado.
const SUPPRESSION_NOT_EVALUATED: EmailSuppressionFilterInfo = { status: 'UNAVAILABLE', excludedCount: 0, reason: 'NOT_EVALUATED' }

export function buildEmailAudienceSnapshot(
  rows: EmailIdentityRow[],
  quality: EmailBaseQuality,
  now: Date,
  suppression: EmailSuppressionFilterInfo = SUPPRESSION_NOT_EVALUATED,
): EmailAudienceSnapshot {
  const acc = new Map<EmailSegmentKey, Accumulator>()
  for (const key of EMAIL_SEGMENT_KEYS) acc.set(key, { audience: 0, valid: 0, whatsappOptOut: 0, timingUncertain: 0, tracks: emptyTrackBreakdown() })

  let emailValid = 0
  let buyers = 0
  let buyersWithUndatedOrders = 0
  let datedBuyers = 0
  let undatedBuyers = 0
  const bucketTotals: Record<RecencyBucket, number> = { '0_30': 0, '31_60': 0, '61_90': 0, '91_180': 0, '181_365': 0, '365_PLUS': 0 }

  for (const row of rows) {
    const recency = classifyRecency(row, now)
    const track = assignPrimaryTrack(row, recency)
    if (row.validEmail) emailValid++
    if (row.paidOrderCount > 0) {
      buyers++
      if (row.undatedPaidOrders > 0) buyersWithUndatedOrders++
      if (recency === 'UNDATED') undatedBuyers++
      else { datedBuyers++; bucketTotals[recency as RecencyBucket]++ }
    }
    for (const key of segmentsForRow(row, recency)) {
      const a = acc.get(key) as Accumulator
      a.audience++
      if (row.validEmail) a.valid++
      if (row.whatsappOptOut) a.whatsappOptOut++
      if (row.paidOrderCount > 0 && row.undatedPaidOrders > 0) a.timingUncertain++
      a.tracks[track]++
    }
  }

  const bucketsSum = RECENCY_BUCKETS.reduce((sum, b) => sum + bucketTotals[b], 0)
  const consentConfigured = EMAIL_MARKETING_CONSENT_SOURCE === 'CONFIGURED'

  const segments: EmailSegmentSummary[] = EMAIL_SEGMENT_KEYS.map(key => {
    const meta = SEGMENT_META[key]
    const a = acc.get(key) as Accumulator
    if (NEEDS_DATA_SEGMENTS.has(key)) {
      return {
        segmentKey: key, name: meta.name, description: meta.description, objective: meta.objective, status: 'NEEDS_DATA' as const,
        audienceCount: null, withValidEmailCount: null, sendEligibleCount: null, blockedCount: null,
        eligibilityStatus: 'NEEDS_DATA' as const,
        dataQuality: { level: 'NEEDS_DATA' as const, notes: [meta.missingData ?? 'Dados necessários ainda não são coletados.'] },
        lastPurchaseRange: meta.lastPurchaseRange, priority: meta.priority, recommendedCooldownDays: meta.recommendedCooldownDays,
        cooldownStatus: EMAIL_COOLDOWN_STATUS, exclusions: [], trackBreakdown: emptyTrackBreakdown(), missingData: meta.missingData ?? null,
      }
    }
    const invalidEmail = a.audience - a.valid
    const notes: string[] = []
    if (invalidEmail > 0) notes.push(`${invalidEmail} com e-mail em formato inválido.`)
    if (a.timingUncertain > 0) notes.push(`${a.timingUncertain} têm ao menos um pedido pago sem data de origem — a última compra pode estar subestimada.`)
    if (key === 'UNDATED_BUYERS') notes.push('Diagnóstico: excluídos dos buckets de recência de propósito (fail-closed).')
    const exclusions: EmailSegmentExclusion[] = []
    if (invalidEmail > 0) exclusions.push({ reason: 'INVALID_EMAIL', count: invalidEmail, note: 'E-mail em formato inválido — não recebe campanha.' })
    if (a.whatsappOptOut > 0) exclusions.push({ reason: 'WHATSAPP_OPT_OUT_REVIEW', count: a.whatsappOptOut, note: 'Pediram opt-out no WhatsApp. Isso NÃO é opt-out de e-mail, mas é sinal de cautela — decisão humana antes de qualquer envio.' })
    return {
      segmentKey: key, name: meta.name, description: meta.description, objective: meta.objective, status: 'READY' as const,
      audienceCount: a.audience,
      withValidEmailCount: a.valid,
      // Sem fonte comprovada de consentimento: nunca um número de "prontos para
      // enviar". Mesmo com uma fonte configurada no futuro, este contador só
      // passa a existir quando a regra de elegibilidade for implementada junto
      // dela — não é inferido aqui.
      sendEligibleCount: null,
      blockedCount: invalidEmail,
      eligibilityStatus: consentConfigured ? 'ELIGIBLE_VERIFIED' as const : 'EMAIL_CONSENT_SOURCE_NOT_CONFIGURED' as const,
      dataQuality: { level: notes.length ? 'PARTIAL' as const : 'OK' as const, notes },
      lastPurchaseRange: meta.lastPurchaseRange, priority: meta.priority, recommendedCooldownDays: meta.recommendedCooldownDays,
      cooldownStatus: EMAIL_COOLDOWN_STATUS, exclusions, trackBreakdown: a.tracks, missingData: null,
    }
  })

  return {
    generatedAt: now.toISOString(),
    consentSource: EMAIL_MARKETING_CONSENT_SOURCE,
    suppression: { ...suppression },
    sendEligibility: consentConfigured ? 'READY' : 'NOT_READY',
    cooldownStatus: EMAIL_COOLDOWN_STATUS,
    base: { ...quality, emailKnown: rows.length, emailValid, emailInvalid: rows.length - emailValid, buyers, buyersWithUndatedOrders },
    segments,
    recencyCheck: { bucketsSum, datedBuyers, undatedBuyers, buyers, overlapFree: bucketsSum === datedBuyers && datedBuyers + undatedBuyers === buyers },
    vipThresholds: { minimumOrders: env.VIP_MIN_ORDERS, minimumSpend: env.VIP_MIN_SPEND },
    windows: { cartWindowDays: EMAIL_CART_WINDOW_DAYS, lifecycleWindowDays: EMAIL_LIFECYCLE_WINDOW_DAYS },
  }
}

// ── Acesso a dados (agregação no PostgreSQL) ──────────────────────────────────────────────────

// POSIX ARE (operador ~ do Postgres). Sintaxe mínima e conservadora: algo@algo.tld,
// sem espaços, ≤254 caracteres. Não tenta validar entregabilidade.
const EMAIL_SQL_REGEX = '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]{2,}$'

interface RawIdentityRow { validEmail: boolean; paidOrderCount: number; paidTotal: number; lastPaidAt: Date | null; undatedPaidOrders: number; recentAbandonedCart: boolean; whatsappOptOut: boolean }

// CTEs compartilhadas pelas duas leituras (com e sem e-mail): a definição de
// identidade, compra válida e carrinho recente vive num lugar só.
function identityCtes(cartCutoff: Date): Prisma.Sql {
  return Prisma.sql`
    WITH cust AS (
      SELECT c.id, NULLIF(lower(btrim(c.email)), '') AS em, c."optOut" AS optout
      FROM customers c
    ),
    ord AS (
      SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"), ''), c.email))), '') AS em,
             o.total AS total, o."sourceCreatedAt" AS at
      FROM orders o
      LEFT JOIN customers c ON c.id = o."customerId"
      WHERE o."paymentStatus" = 'paid' AND lower(o.status) NOT IN ('cancelled', 'canceled', 'refunded')
    ),
    pool AS (
      SELECT em FROM cust WHERE em IS NOT NULL
      UNION
      SELECT em FROM ord WHERE em IS NOT NULL
    ),
    agg AS (
      SELECT em, count(*)::int AS n, COALESCE(sum(total), 0)::float8 AS spend, max(at) AS last_at,
             (count(*) FILTER (WHERE at IS NULL))::int AS undated
      FROM ord WHERE em IS NOT NULL GROUP BY em
    ),
    cart AS (
      SELECT DISTINCT NULLIF(lower(btrim(a."customerEmail")), '') AS em
      FROM abandoned_checkouts a
      WHERE a.status = 'abandoned' AND a."convertedAt" IS NULL AND NULLIF(btrim(a."customerEmail"), '') IS NOT NULL
        AND COALESCE(a."abandonedAt", a."sourceCreatedAt", a."firstSeenAt") >= (${cartCutoff}::timestamptz AT TIME ZONE 'UTC')
        AND NOT EXISTS (
          SELECT 1 FROM ord
          WHERE ord.em = NULLIF(lower(btrim(a."customerEmail")), '')
            AND ord.at IS NOT NULL AND ord.at >= COALESCE(a."abandonedAt", a."sourceCreatedAt", a."firstSeenAt")
        )
    ),
    optout AS (SELECT DISTINCT em FROM cust WHERE optout AND em IS NOT NULL)
  `
}

// Leitura PADRÃO: uma linha compacta por identidade, SEM o e-mail (contagens e
// datas). É a única usada enquanto não houver e-mail suprimido a excluir.
export async function queryEmailIdentityRows(now: Date): Promise<EmailIdentityRow[]> {
  const cartCutoff = new Date(now.getTime() - EMAIL_CART_WINDOW_DAYS * DAY_MS)
  const rows = await prisma.$queryRaw<RawIdentityRow[]>(Prisma.sql`
    ${identityCtes(cartCutoff)}
    SELECT (length(p.em) <= 254 AND p.em ~ ${EMAIL_SQL_REGEX}) AS "validEmail",
           COALESCE(a.n, 0)::int AS "paidOrderCount",
           COALESCE(a.spend, 0)::float8 AS "paidTotal",
           a.last_at AS "lastPaidAt",
           COALESCE(a.undated, 0)::int AS "undatedPaidOrders",
           (c.em IS NOT NULL) AS "recentAbandonedCart",
           (o.em IS NOT NULL) AS "whatsappOptOut"
    FROM pool p
    LEFT JOIN agg a ON a.em = p.em
    LEFT JOIN cart c ON c.em = p.em
    LEFT JOIN optout o ON o.em = p.em
  `)
  return rows.map(r => ({
    validEmail: Boolean(r.validEmail),
    paidOrderCount: Number(r.paidOrderCount),
    paidTotal: Number(r.paidTotal),
    lastPaidAt: r.lastPaidAt ? new Date(r.lastPaidAt) : null,
    undatedPaidOrders: Number(r.undatedPaidOrders),
    recentAbandonedCart: Boolean(r.recentAbandonedCart),
    whatsappOptOut: Boolean(r.whatsappOptOut),
  }))
}

// ── Exclusão de e-mails suprimidos ────────────────────────────────────────────────────────────
//
// Por que NÃO é um filtro dentro do SQL: a lista de supressão é chaveada por
// HMAC-SHA256(e-mail, EMAIL_HASH_PEPPER) e o pepper só existe no app. Calcular
// o HMAC no Postgres exigiria mandar o pepper ao banco (parâmetro de consulta,
// possível de aparecer em log de consulta lenta) e depender de pgcrypto — o que
// desfaz o propósito do pepper. Então a exclusão acontece ainda na leitura, ANTES
// da agregação em segmentos, e o e-mail só sai do banco quando existe pelo menos
// um suprimido a excluir. Nada de e-mail entra em snapshot, cache ou log.
//
// Nunca inventa um snapshot: erro de banco nas consultas de identidade propaga.
// O que degrada (sem quebrar o painel) é só o FILTRO: pepper ausente ou lista
// ilegível → contagens sem exclusão, declaradas como UNAVAILABLE.

export interface EmailIdentityRowWithEmail extends EmailIdentityRow {
  // Existe só entre a consulta e o filtro; é descartado antes de qualquer agregação.
  email: string
}

interface RawIdentityRowWithEmail extends RawIdentityRow { email: string }

// Mesma leitura, com o e-mail normalizado de cada identidade (uma linha por e-mail).
export async function queryEmailIdentityRowsWithEmail(now: Date): Promise<EmailIdentityRowWithEmail[]> {
  const cartCutoff = new Date(now.getTime() - EMAIL_CART_WINDOW_DAYS * DAY_MS)
  const rows = await prisma.$queryRaw<RawIdentityRowWithEmail[]>(Prisma.sql`
    ${identityCtes(cartCutoff)}
    SELECT p.em AS "email",
           (length(p.em) <= 254 AND p.em ~ ${EMAIL_SQL_REGEX}) AS "validEmail",
           COALESCE(a.n, 0)::int AS "paidOrderCount",
           COALESCE(a.spend, 0)::float8 AS "paidTotal",
           a.last_at AS "lastPaidAt",
           COALESCE(a.undated, 0)::int AS "undatedPaidOrders",
           (c.em IS NOT NULL) AS "recentAbandonedCart",
           (o.em IS NOT NULL) AS "whatsappOptOut"
    FROM pool p
    LEFT JOIN agg a ON a.em = p.em
    LEFT JOIN cart c ON c.em = p.em
    LEFT JOIN optout o ON o.em = p.em
  `)
  return rows.map(r => ({
    email: String(r.email),
    validEmail: Boolean(r.validEmail),
    paidOrderCount: Number(r.paidOrderCount),
    paidTotal: Number(r.paidTotal),
    lastPaidAt: r.lastPaidAt ? new Date(r.lastPaidAt) : null,
    undatedPaidOrders: Number(r.undatedPaidOrders),
    recentAbandonedCart: Boolean(r.recentAbandonedCart),
    whatsappOptOut: Boolean(r.whatsappOptOut),
  }))
}

export interface SuppressionFilterDeps {
  pepperConfigured: () => boolean
  // Todos os hashes suprimidos numa consulta só (a lista é ordens de grandeza menor
  // que a base; reavaliar com paginação se passar de ~100 mil linhas).
  loadSuppressedHashes: () => Promise<Set<string>>
  queryRows: (now: Date) => Promise<EmailIdentityRow[]>
  queryRowsWithEmail: (now: Date) => Promise<EmailIdentityRowWithEmail[]>
  // null = e-mail inválido (nunca foi suprimido, pois só e-mail válido gera hash).
  hash: (email: string) => string | null
}

const defaultSuppressionDeps: SuppressionFilterDeps = {
  pepperConfigured: () => env.EMAIL_HASH_PEPPER.length >= EMAIL_HASH_PEPPER_MIN_LENGTH,
  loadSuppressedHashes: async () => {
    const found = await prisma.emailSuppression.findMany({ select: { emailHash: true } })
    return new Set(found.map(row => row.emailHash))
  },
  queryRows: queryEmailIdentityRows,
  queryRowsWithEmail: queryEmailIdentityRowsWithEmail,
  hash: (email) => {
    try {
      return hashEmail(email)
    } catch (error) {
      if (error instanceof InvalidConsentEmailError) return null
      throw error
    }
  },
}

export interface IdentityRowsResult {
  rows: EmailIdentityRow[]
  suppression: EmailSuppressionFilterInfo
}

function unavailable(reason: EmailSuppressionFilterReason): EmailSuppressionFilterInfo {
  return { status: 'UNAVAILABLE', excludedCount: 0, reason }
}

function withoutEmail(rows: readonly EmailIdentityRowWithEmail[]): EmailIdentityRow[] {
  return rows.map(({ email: _email, ...rest }) => rest)
}

export async function loadEmailIdentityRowsExcludingSuppressed(
  now: Date,
  deps: SuppressionFilterDeps = defaultSuppressionDeps,
): Promise<IdentityRowsResult> {
  if (!deps.pepperConfigured()) {
    return { rows: await deps.queryRows(now), suppression: unavailable('PEPPER_NOT_CONFIGURED') }
  }

  let suppressed: Set<string>
  try {
    suppressed = await deps.loadSuppressedHashes()
  } catch {
    // Tabela ainda não migrada, banco sem permissão ou falha de rede: só o filtro
    // degrada. A causa não vai adiante de propósito (pode carregar detalhe do banco).
    return { rows: await deps.queryRows(now), suppression: unavailable('LOOKUP_FAILED') }
  }

  // Lista vazia: nada a excluir, então o e-mail nem precisa sair do banco.
  if (suppressed.size === 0) {
    return { rows: await deps.queryRows(now), suppression: { status: 'APPLIED', excludedCount: 0, reason: null } }
  }

  const identities = await deps.queryRowsWithEmail(now)
  const kept: EmailIdentityRowWithEmail[] = []
  let excluded = 0
  try {
    for (const identity of identities) {
      const hash = deps.hash(identity.email)
      if (hash !== null && suppressed.has(hash)) excluded++
      else kept.push(identity)
    }
  } catch {
    // Falha ao calcular o hash no meio do lote: não usa um filtro pela metade.
    return { rows: withoutEmail(identities), suppression: unavailable('LOOKUP_FAILED') }
  }
  return { rows: withoutEmail(kept), suppression: { status: 'APPLIED', excludedCount: excluded, reason: null } }
}

export interface EmailSegmentRecipient {
  email: string
  recentAbandonedCart: boolean
}

// Resolve a audiência REAL somente no instante da execução. O e-mail em texto
// nunca é persistido em CampaignDraft/EmailSend/EventLog; ele existe apenas em
// memória durante a seleção e passa novamente pelos gates de consentimento,
// supressão e cooldown antes de qualquer envio.
export async function queryEmailRecipientsForSegment(
  segmentKey: EmailSegmentKey,
  now: Date = new Date(),
): Promise<EmailSegmentRecipient[]> {
  if (NEEDS_DATA_SEGMENTS.has(segmentKey)) return []
  const rows = await queryEmailIdentityRowsWithEmail(now)
  return rows.flatMap((row) => {
    if (!row.validEmail) return []
    const recency = classifyRecency(row, now)
    if (!segmentsForRow(row, recency).includes(segmentKey)) return []
    return [{ email: row.email, recentAbandonedCart: row.recentAbandonedCart }]
  })
}

export async function queryEmailBaseQuality(): Promise<EmailBaseQuality> {
  const [row] = await prisma.$queryRaw<Array<Record<keyof EmailBaseQuality, number>>>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM customers)::int AS "totalCustomers",
      (SELECT count(*) FROM customers WHERE NULLIF(btrim(email), '') IS NULL)::int AS "customersWithoutEmail",
      (SELECT count(*) FROM orders WHERE "paymentStatus" = 'paid' AND lower(status) NOT IN ('cancelled', 'canceled', 'refunded'))::int AS "paidOrders",
      (SELECT count(*) FROM orders o LEFT JOIN customers c ON c.id = o."customerId"
        WHERE o."paymentStatus" = 'paid' AND lower(o.status) NOT IN ('cancelled', 'canceled', 'refunded')
          AND NULLIF(btrim(COALESCE(NULLIF(btrim(o."customerEmail"), ''), c.email)), '') IS NULL)::int AS "paidOrdersWithoutEmail",
      (SELECT count(*) FROM orders WHERE "paymentStatus" = 'paid' AND lower(status) NOT IN ('cancelled', 'canceled', 'refunded') AND "sourceCreatedAt" IS NULL)::int AS "paidOrdersWithoutDate"
  `)
  return {
    totalCustomers: Number(row?.totalCustomers ?? 0),
    customersWithoutEmail: Number(row?.customersWithoutEmail ?? 0),
    paidOrders: Number(row?.paidOrders ?? 0),
    paidOrdersWithoutEmail: Number(row?.paidOrdersWithoutEmail ?? 0),
    paidOrdersWithoutDate: Number(row?.paidOrdersWithoutDate ?? 0),
  }
}

// Cache curto: 3 endpoints + a geração de oportunidades consultam o mesmo
// snapshot; sob connection_limit=2 do Preview não vale repetir a agregação a
// cada clique. Desligado em NODE_ENV=test (testes nunca compartilham estado).
const CACHE_TTL_MS = 60_000
let cache: { at: number; snapshot: EmailAudienceSnapshot } | null = null
let inflight: Promise<EmailAudienceSnapshot> | null = null

export function resetEmailAudienceCache(): void { cache = null; inflight = null }

export async function getEmailAudienceSnapshot(options: { now?: Date; force?: boolean } = {}): Promise<EmailAudienceSnapshot> {
  const useCache = env.NODE_ENV !== 'test' && !options.now && !options.force
  if (useCache && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.snapshot
  if (useCache && inflight) return inflight
  const run = (async () => {
    const now = options.now ?? new Date()
    // Sequencial de propósito (não Promise.all): connection_limit=2 no Preview.
    const { rows, suppression } = await loadEmailIdentityRowsExcludingSuppressed(now)
    const quality = await queryEmailBaseQuality()
    return buildEmailAudienceSnapshot(rows, quality, now, suppression)
  })()
  if (!useCache) return run
  inflight = run
  try {
    const snapshot = await run
    cache = { at: Date.now(), snapshot }
    return snapshot
  } finally {
    inflight = null
  }
}
