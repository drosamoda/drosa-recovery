import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { remarketingPreview, segmentContracts } from './remarketingService'
import type { EmailEligibilityStatus, EmailSegmentKey } from './emailAudienceEngine'
import type { EmailOpportunityTypeValue } from './emailCampaignRecommendationService'
import { getEmailOpportunityById } from './emailOpportunityService'

// Elegibilidade nunca é decidida aqui — vem inteiramente de remarketingPreview()
// (que já aplica consentimento, suppression, cooldown, fail-closed) ou de uma
// contagem determinística equivalente. Este arquivo só INTERPRETA os números
// reais em forma de oportunidade; nunca inventa uma oportunidade sem dado.

export type WhatsappOpportunityType =
  | 'ABANDONED_CART'
  | 'PIX_PENDING'
  | 'BOLETO_PENDING'
  | 'REPEAT_PURCHASE'
  | 'WINBACK'
  | 'VIP'
  | 'RECENT_CUSTOMER'
  | 'ENGAGED_NO_PURCHASE'

// Email Campaign Intelligence: oportunidades de e-mail têm tipos próprios
// (EMAIL_*), nunca reaproveitam os de WhatsApp.
export type EmailOpportunityType = EmailOpportunityTypeValue
export type OpportunityType = WhatsappOpportunityType | EmailOpportunityType
export type OpportunityChannel = 'whatsapp' | 'email'

export type WhatsappOpportunity = {
  id: string
  // Ausente = whatsapp (contrato anterior a esta rodada). generateOpportunities()
  // sempre preenche.
  channel?: 'whatsapp'
  type: WhatsappOpportunityType
  title: string
  reason: string
  audienceCount: number
  eligibleCount: number
  blockedCount: number
  recommendedTiming: string
  recommendedChannel: 'whatsapp'
  recommendedProduct: null
  confidence: 'low' | 'medium' | 'high'
  evidence: {
    topBlockers: Array<{ reason: string; count: number }>
    dataQuality: { historyTruncated: boolean; consentSourceConfigured: boolean; metaTemplatesVerified: boolean }
    template: string
  }
  generatedAt: string
}

// Oportunidade de e-mail (canal EMAIL). Difere da de WhatsApp de propósito:
// eligibleCount/sendEligibleCount são null enquanto não existir fonte
// comprovada de consentimento de e-mail — nunca um número inventado.
export type EmailOpportunity = {
  id: string
  channel: 'email'
  type: EmailOpportunityType
  segmentKey: EmailSegmentKey
  title: string
  reason: string
  audienceCount: number
  withValidEmailCount: number
  sendEligibleCount: null
  eligibleCount: null
  blockedCount: number
  eligibilityStatus: EmailEligibilityStatus
  recommendedTiming: string
  recommendedChannel: 'email'
  recommendedProduct: null
  confidence: 'low' | 'medium' | 'high'
  recommendedCampaignKeys: string[]
  cooldown: { days: number; status: string }
  evidence: {
    topBlockers: Array<{ reason: string; count: number }>
    dataQuality: { level: string; notes: string[]; consentSourceConfigured: boolean }
  }
  generatedAt: string
}

export type Opportunity = WhatsappOpportunity | EmailOpportunity

function confidenceFor(found: number, eligible: number, dataQuality: { historyTruncated: boolean; consentSourceConfigured: boolean; metaTemplatesVerified: boolean }): WhatsappOpportunity['confidence'] {
  if (found === 0) return 'low'
  if (dataQuality.historyTruncated || !dataQuality.consentSourceConfigured) return 'low'
  const eligibleRatio = eligible / found
  if (eligible > 0 && dataQuality.metaTemplatesVerified && eligibleRatio >= 0.3) return 'high'
  return 'medium'
}

function topBlockers(reasons: Record<string, number>, limit = 3): Array<{ reason: string; count: number }> {
  return Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([reason, count]) => ({ reason, count }))
}

const sendWindow = `Envio dentro do horário comercial configurado (${String(env.MARKETING_SEND_HOUR_START).padStart(2, '0')}h–${String(env.MARKETING_SEND_HOUR_END).padStart(2, '0')}h)`

// Recompra é a lacuna real entre "recente" e "inativo": pedido pago nessa
// janela e nenhum pedido pago depois. Usa os mesmos dois limiares já
// configurados no remarketing (nenhum limiar novo é inventado aqui).
export async function repeatPurchaseCandidates() {
  const now = Date.now()
  const day = 86400000
  // Filtra no banco pela janela que realmente importa (últimos INACTIVE_DAYS) em vez de
  // buscar todo o histórico de pedidos: remarketingPreview() já faz sua própria busca
  // completa internamente, e duplicar um fetch sem filtro aqui satura o connection_limit=2
  // do Preview (causa real de um hang de 20s+ reproduzido ao vivo). Qualquer telefone cujo
  // pedido mais recente esteja fora desta janela simplesmente não aparece — correto, porque
  // nesse caso ele já é RECENT_CUSTOMER (mais novo) ou candidato a WINBACK (mais velho que
  // INACTIVE_DAYS, logo nem estaria nesta busca de qualquer forma).
  const cutoff = new Date(now - env.REMARKETING_INACTIVE_DAYS * day)
  const orders = await prisma.order.findMany({
    where: { paymentStatus: 'paid', status: { notIn: ['cancelled', 'canceled', 'refunded'] }, sourceCreatedAt: { gte: cutoff } },
    select: { id: true, normalizedPhone: true, sourceCreatedAt: true },
    orderBy: { sourceCreatedAt: 'desc' },
    take: 10000,
  })
  const incomplete = orders.length === 10000
  const byPhone = new Map<string, typeof orders>()
  for (const order of orders) {
    if (!order.normalizedPhone) continue
    byPhone.set(order.normalizedPhone, [...(byPhone.get(order.normalizedPhone) ?? []), order])
  }
  const [suppressions, optedOut, consents] = await Promise.all([
    prisma.suppression.findMany({ select: { normalizedPhone: true } }),
    prisma.customer.findMany({ where: { optOut: true }, select: { normalizedPhone: true } }),
    prisma.whatsappConsent.findMany({ where: { consented: true, revokedAt: null, scope: 'marketing', consentedAt: { not: null } }, select: { normalizedPhone: true } }),
  ])
  const suppressed = new Set([...suppressions, ...optedOut].map(item => item.normalizedPhone))
  const consented = new Set(consents.map(item => item.normalizedPhone))
  const reasons: Record<string, number> = {}
  // eligibleOrderIds: mesma regra de elegibilidade acima (nunca duplicada,
  // só exposta), um Order.id por telefone elegível — a "própria compra mais
  // recente" desse cliente, nunca um pedido de outro cliente. Consumido por
  // campaignEvidenceService para escopar a evidência de REPEAT_PURCHASE à
  // audiência real desta oportunidade (nunca uma amostra global).
  const eligibleOrderIds: string[] = []
  let found = 0, eligible = 0
  for (const [phone, history] of byPhone) {
    const dated = history.filter(o => o.sourceCreatedAt).sort((a, b) => b.sourceCreatedAt!.getTime() - a.sourceCreatedAt!.getTime())
    if (!dated.length) continue
    const ageDays = (now - dated[0].sourceCreatedAt!.getTime()) / day
    if (ageDays < env.REMARKETING_RECENT_CUSTOMER_DAYS || ageDays >= env.REMARKETING_INACTIVE_DAYS) continue
    found++
    const rowReasons: string[] = []
    if (suppressed.has(phone)) rowReasons.push('opt_out')
    if (!consented.has(phone)) rowReasons.push('consent_unproven')
    if (incomplete) rowReasons.push('history_incomplete')
    for (const r of rowReasons) reasons[r] = (reasons[r] ?? 0) + 1
    if (rowReasons.length === 0) { eligible++; eligibleOrderIds.push(dated[0].id) }
  }
  return { found, eligible, reasons, eligibleOrderIds, dataQuality: { historyTruncated: incomplete, consentSourceConfigured: true, metaTemplatesVerified: true } }
}

export async function generateOpportunities(): Promise<WhatsappOpportunity[]> {
  const now = new Date().toISOString()
  const preview = await remarketingPreview('all')
  const opportunities: WhatsappOpportunity[] = []

  const fromSegment = (type: WhatsappOpportunityType, segmentKey: keyof typeof segmentContracts, title: string, reason: string, timing: string) => {
    const segment = preview.segments[segmentKey] as { found: number; eligible: number; data?: Array<{ reasons: string[] }> } | undefined
    if (!segment || segment.found === 0) return
    const reasons: Record<string, number> = {}
    for (const item of segment.data ?? []) for (const r of item.reasons) reasons[r] = (reasons[r] ?? 0) + 1
    opportunities.push({
      id: `opp_${type.toLowerCase()}_${now.slice(0, 10)}`,
      channel: 'whatsapp',
      type,
      title: title.replace('{n}', String(segment.eligible || segment.found)),
      reason,
      audienceCount: segment.found,
      eligibleCount: segment.eligible,
      blockedCount: segment.found - segment.eligible,
      recommendedTiming: timing,
      recommendedChannel: 'whatsapp',
      recommendedProduct: null,
      confidence: confidenceFor(segment.found, segment.eligible, preview.dataQuality),
      evidence: { topBlockers: topBlockers(reasons), dataQuality: preview.dataQuality, template: segmentContracts[segmentKey].template },
      generatedAt: now,
    })
  }

  fromSegment('ABANDONED_CART', 'abandoned_cart', '{n} carrinhos abandonados elegíveis', 'Checkout iniciado e não finalizado, dentro da janela de recuperação configurada.', 'Automação existente: 30 min após abandono (regra ativa em Automações)')
  fromSegment('PIX_PENDING', 'pix_pending', '{n} pedidos com Pix pendente', 'Pedido criado com Pix aguardando pagamento, sem cancelamento nem reembolso.', sendWindow)
  fromSegment('BOLETO_PENDING', 'boleto_pending', '{n} boletos pendentes', 'Pedido criado com boleto aguardando pagamento.', sendWindow)
  fromSegment('VIP', 'vip_customer', '{n} clientes VIP', `Critério documentado: ${env.VIP_MIN_ORDERS}+ pedidos pagos e R$ ${env.VIP_MIN_SPEND}+ em compras.`, sendWindow)
  fromSegment('RECENT_CUSTOMER', 'recent_customer', '{n} clientes recentes', `Última compra paga nos últimos ${env.REMARKETING_RECENT_CUSTOMER_DAYS} dias.`, sendWindow)
  fromSegment('ENGAGED_NO_PURCHASE', 'engaged_no_purchase', '{n} contatos engajados sem compra', 'Mensagem recebida via WhatsApp nos últimos 30 dias, sem pedido pago desde então.', sendWindow)

  const winback = preview.segments.inactive_customer as { found: number; eligible: number; data?: Array<{ reasons: string[] }> } | undefined
  if (winback && winback.found > 0) {
    const reasons: Record<string, number> = {}
    for (const item of winback.data ?? []) for (const r of item.reasons) reasons[r] = (reasons[r] ?? 0) + 1
    opportunities.push({
      id: `opp_winback_${now.slice(0, 10)}`,
      channel: 'whatsapp',
      type: 'WINBACK',
      title: `${winback.eligible || winback.found} clientes inativos para reativação`,
      reason: `Última compra paga há ${env.REMARKETING_INACTIVE_DAYS}+ dias e nenhum pedido posterior.`,
      audienceCount: winback.found,
      eligibleCount: winback.eligible,
      blockedCount: winback.found - winback.eligible,
      recommendedTiming: sendWindow,
      recommendedChannel: 'whatsapp',
      recommendedProduct: null,
      confidence: confidenceFor(winback.found, winback.eligible, preview.dataQuality),
      evidence: { topBlockers: topBlockers(reasons), dataQuality: preview.dataQuality, template: segmentContracts.inactive_customer.template },
      generatedAt: now,
    })
  }

  const repeat = await repeatPurchaseCandidates()
  if (repeat.found > 0) {
    opportunities.push({
      id: `opp_repeat_purchase_${now.slice(0, 10)}`,
      channel: 'whatsapp',
      type: 'REPEAT_PURCHASE',
      title: `${repeat.eligible || repeat.found} clientes prontos para recompra`,
      reason: `Última compra paga entre ${env.REMARKETING_RECENT_CUSTOMER_DAYS} e ${env.REMARKETING_INACTIVE_DAYS} dias atrás e nenhum pedido posterior.`,
      audienceCount: repeat.found,
      eligibleCount: repeat.eligible,
      blockedCount: repeat.found - repeat.eligible,
      recommendedTiming: sendWindow,
      recommendedChannel: 'whatsapp',
      recommendedProduct: null,
      confidence: confidenceFor(repeat.found, repeat.eligible, repeat.dataQuality),
      evidence: { topBlockers: topBlockers(repeat.reasons), dataQuality: repeat.dataQuality, template: segmentContracts.recent_customer.template },
      generatedAt: now,
    })
  }

  return opportunities
}

export async function getOpportunityById(id: string): Promise<Opportunity | null> {
  // Ids de e-mail (opp_email_*) nunca passam por remarketingPreview(): outro
  // canal, outra fonte de dados, outro cálculo de audiência.
  if (id.startsWith('opp_email_')) return getEmailOpportunityById(id)
  const all = await generateOpportunities()
  return all.find(o => o.id === id) ?? null
}
