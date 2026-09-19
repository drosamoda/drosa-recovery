import type { EmailOpportunity } from './aiOpportunityEngine'
import { EMAIL_COOLDOWN_STATUS, EmailAudienceSnapshot, EmailSegmentSummary, getEmailAudienceSnapshot } from './emailAudienceEngine'
import {
  SEGMENT_TO_OPPORTUNITY_TYPE,
  buildEmailRecommendations,
  emailOpportunityId,
  isTargetableSegment,
  parseEmailOpportunityId,
} from './emailCampaignRecommendationService'

// Oportunidades de e-mail — determinísticas, uma por segmento com público real.
// NÃO são misturadas com as de WhatsApp: carregam channel='email' e nunca
// passam por remarketingPreview()/consentimento de WhatsApp.

function confidenceOf(segment: EmailSegmentSummary): EmailOpportunity['confidence'] {
  if (!segment.audienceCount) return 'low'
  const invalid = segment.audienceCount - (segment.withValidEmailCount ?? segment.audienceCount)
  return invalid / segment.audienceCount > 0.1 ? 'low' : 'medium'
}

export function buildEmailOpportunities(snapshot: EmailAudienceSnapshot): EmailOpportunity[] {
  const recommendations = buildEmailRecommendations(snapshot).recommendations
  const opportunities: EmailOpportunity[] = []
  for (const segment of snapshot.segments) {
    if (segment.status !== 'READY' || !isTargetableSegment(segment.segmentKey) || !segment.audienceCount) continue
    const recommendedCampaignKeys = recommendations.filter(r => r.segmentKey === segment.segmentKey && r.actionable).map(r => r.campaignKey)
    opportunities.push({
      id: emailOpportunityId(segment.segmentKey, snapshot.generatedAt),
      channel: 'email',
      type: SEGMENT_TO_OPPORTUNITY_TYPE[segment.segmentKey],
      segmentKey: segment.segmentKey,
      title: `${segment.audienceCount} clientes: ${segment.name}`,
      reason: segment.description,
      audienceCount: segment.audienceCount,
      withValidEmailCount: segment.withValidEmailCount ?? 0,
      // Nunca um número de "prontos para enviar" sem fonte comprovada de consentimento.
      sendEligibleCount: null,
      eligibleCount: null,
      blockedCount: segment.blockedCount ?? 0,
      eligibilityStatus: segment.eligibilityStatus,
      recommendedTiming: 'Sem janela recomendada: não existe provedor nem histórico de envio de e-mail.',
      recommendedChannel: 'email',
      recommendedProduct: null,
      confidence: confidenceOf(segment),
      recommendedCampaignKeys,
      cooldown: { days: segment.recommendedCooldownDays, status: EMAIL_COOLDOWN_STATUS },
      evidence: {
        topBlockers: segment.exclusions.map(e => ({ reason: e.reason, count: e.count })),
        dataQuality: { level: segment.dataQuality.level, notes: segment.dataQuality.notes, consentSourceConfigured: snapshot.consentSource === 'CONFIGURED' },
      },
      generatedAt: snapshot.generatedAt,
    })
  }
  return opportunities
}

export async function generateEmailOpportunities(): Promise<EmailOpportunity[]> {
  return buildEmailOpportunities(await getEmailAudienceSnapshot())
}

export async function getEmailOpportunityById(id: string): Promise<EmailOpportunity | null> {
  const parsed = parseEmailOpportunityId(id)
  if (!parsed) return null
  const opportunities = await generateEmailOpportunities()
  // O id carrega a data do dia (mesmo contrato das oportunidades de WhatsApp):
  // uma oportunidade de outro dia não é reaproveitada — o snapshot mudou.
  return opportunities.find(o => o.id === id) ?? null
}
