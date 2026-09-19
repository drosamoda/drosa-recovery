import {
  EMAIL_COOLDOWN_STATUS,
  EmailAudienceSnapshot,
  EmailSegmentKey,
  EmailSegmentSummary,
  getEmailAudienceSnapshot,
} from './emailAudienceEngine'
import {
  CampaignRequirement,
  DataCapability,
  EMAIL_DATA_CAPABILITIES,
  EmailCampaignDefinition,
  RequirementKey,
  evaluateCampaignReadiness,
  listEmailCampaigns,
} from './emailCampaignLibrary'

// Motor de recomendação de e-mail: cruza AUDIÊNCIA determinística (snapshot) +
// BIBLIOTECA de campanhas + REQUISITOS de dado + PRIORIDADE + COOLDOWN +
// QUALIDADE DOS DADOS. A IA não participa daqui — ela só gera copy depois que
// o backend já decidiu qual campanha vai para qual segmento.

// Um segmento só vira "oportunidade" (e portanto só pode gerar um
// CampaignDraft) se existir um valor de OpportunityType para ele. Segmentos de
// diagnóstico (UNDATED_BUYERS) e os NEEDS_DATA não são públicos de campanha.
export const SEGMENT_TO_OPPORTUNITY_TYPE = {
  ALL_EMAIL_CUSTOMERS: 'EMAIL_ALL_CUSTOMERS',
  ONE_TIME_BUYERS: 'EMAIL_ONE_TIME_BUYERS',
  REPEAT_BUYERS: 'EMAIL_REPEAT_BUYERS',
  VIP_CUSTOMERS: 'EMAIL_VIP',
  RECENT_BUYERS_0_30D: 'EMAIL_RECENT_BUYERS',
  LAPSED_31_60D: 'EMAIL_LAPSED_31_60',
  LAPSED_61_90D: 'EMAIL_LAPSED_61_90',
  LAPSED_91_180D: 'EMAIL_LAPSED_91_180',
  LAPSED_181_365D: 'EMAIL_LAPSED_181_365',
  DORMANT_365D_PLUS: 'EMAIL_DORMANT_365_PLUS',
  NO_PURCHASE_CUSTOMERS: 'EMAIL_NO_PURCHASE',
  HIGH_VALUE_NON_VIP: 'EMAIL_HIGH_VALUE_NON_VIP',
  RECENT_CART_ABANDONER: 'EMAIL_CART_ABANDONERS',
} as const satisfies Partial<Record<EmailSegmentKey, string>>
export type TargetableEmailSegmentKey = keyof typeof SEGMENT_TO_OPPORTUNITY_TYPE
export type EmailOpportunityTypeValue = typeof SEGMENT_TO_OPPORTUNITY_TYPE[TargetableEmailSegmentKey]

export function isTargetableSegment(key: EmailSegmentKey): key is TargetableEmailSegmentKey {
  return key in SEGMENT_TO_OPPORTUNITY_TYPE
}

export function emailOpportunityId(segmentKey: EmailSegmentKey, generatedAt: string): string {
  return `opp_email_${segmentKey.toLowerCase()}_${generatedAt.slice(0, 10)}`
}

export function parseEmailOpportunityId(id: string): { segmentKey: TargetableEmailSegmentKey; date: string } | null {
  const match = /^opp_email_([a-z0-9_]+)_(\d{4}-\d{2}-\d{2})$/.exec(id)
  if (!match) return null
  const segmentKey = match[1].toUpperCase() as EmailSegmentKey
  return isTargetableSegment(segmentKey) ? { segmentKey, date: match[2] } : null
}

export type RecommendationConfidence = 'low' | 'medium' | 'high'

export interface EmailRecommendation {
  campaignKey: string
  campaignName: string
  category: string
  segmentKey: EmailSegmentKey
  segmentName: string
  opportunityId: string | null
  audienceCount: number | null
  withValidEmailCount: number | null
  // Reach depois que campanhas de MAIOR prioridade reivindicam seus clientes
  // (uma pessoa nunca recebe duas campanhas contraditórias na mesma rodada).
  exclusiveAudienceCount: number | null
  // Campanhas gerais (prioridade mais baixa) não subtraem audiência: só avisam.
  exclusivityApplies: boolean
  sendEligibleCount: null
  whyNow: string
  objective: string
  priority: number
  cooldown: { days: number; status: typeof EMAIL_COOLDOWN_STATUS }
  requirementsStatus: 'READY' | 'NEEDS_DATA'
  missingRequirements: Array<Pick<CampaignRequirement, 'key' | 'description'> & { evidence: string }>
  degradedRequirements: Array<Pick<CampaignRequirement, 'key' | 'description'>>
  // Impedem GERAR a campanha (planejamento/IA).
  blockedReasons: string[]
  // Impedem ENVIAR — sempre presentes enquanto envio de e-mail não existir.
  sendBlockers: string[]
  sendEligibility: 'SEND_ELIGIBILITY_UNVERIFIED'
  actionable: boolean
  confidence: RecommendationConfidence
}

export interface EmailRecommendationsResult {
  generatedAt: string
  consentSource: EmailAudienceSnapshot['consentSource']
  sendEligibility: EmailAudienceSnapshot['sendEligibility']
  cooldownStatus: typeof EMAIL_COOLDOWN_STATUS
  recommendations: EmailRecommendation[]
  summary: { total: number; actionable: number; needsData: number; superseded: number }
}

const SEND_BLOCKERS = ['EMAIL_CONSENT_SOURCE_NOT_CONFIGURED', 'NO_EMAIL_PROVIDER_CONFIGURED', 'EMAIL_SEND_DISABLED', 'NO_UNSUBSCRIBE_OR_SUPPRESSION_LIST', 'HUMAN_APPROVAL_REQUIRED'] as const

function confidenceFor(segment: EmailSegmentSummary, actionable: boolean, consentConfigured: boolean): RecommendationConfidence {
  if (!actionable || !segment.audienceCount) return 'low'
  const uncertain = segment.dataQuality.notes.length > 0 && segment.dataQuality.level === 'PARTIAL'
  if (uncertain && (segment.audienceCount ?? 0) > 0) {
    // Timing incerto/e-mail inválido relevante reduz a confiança; ruído pequeno não.
    const invalid = segment.audienceCount - (segment.withValidEmailCount ?? segment.audienceCount)
    if (invalid / segment.audienceCount > 0.1) return 'low'
  }
  return consentConfigured && segment.dataQuality.level === 'OK' ? 'high' : 'medium'
}

export function buildEmailRecommendations(
  snapshot: EmailAudienceSnapshot,
  capabilities: Record<RequirementKey, DataCapability> = EMAIL_DATA_CAPABILITIES,
  campaigns: EmailCampaignDefinition[] = listEmailCampaigns(),
): EmailRecommendationsResult {
  const bySegment = new Map<EmailSegmentKey, EmailSegmentSummary>(snapshot.segments.map(s => [s.segmentKey, s]))
  const consentConfigured = snapshot.consentSource === 'CONFIGURED'
  const ranked: Array<{ rec: EmailRecommendation; order: number }> = []

  campaigns.forEach((campaign, order) => {
    const readiness = evaluateCampaignReadiness(campaign, capabilities)
    for (const segmentKey of campaign.allowedSegments) {
      const segment = bySegment.get(segmentKey)
      if (!segment) continue
      const exclusivityApplies = campaign.track !== 'GENERAL'
      const exclusive = segment.status === 'READY' ? segment.trackBreakdown[campaign.track] : null
      const blockedReasons: string[] = []
      if (readiness.status === 'NEEDS_DATA') for (const m of readiness.missingHard) blockedReasons.push(`CAMPAIGN_NEEDS_DATA:${m.key}`)
      if (segment.status === 'NEEDS_DATA') blockedReasons.push('SEGMENT_NEEDS_DATA')
      if (!isTargetableSegment(segmentKey)) blockedReasons.push('SEGMENT_NOT_TARGETABLE')
      if (segment.status === 'READY' && (segment.audienceCount ?? 0) === 0) blockedReasons.push('EMPTY_AUDIENCE')
      const superseded = segment.status === 'READY' && exclusivityApplies && (segment.audienceCount ?? 0) > 0 && exclusive === 0
      if (superseded) blockedReasons.push('SUPERSEDED_BY_HIGHER_PRIORITY')
      const actionable = blockedReasons.length === 0
      ranked.push({ order, rec: {
        campaignKey: campaign.key,
        campaignName: campaign.name,
        category: campaign.category,
        segmentKey,
        segmentName: segment.name,
        opportunityId: isTargetableSegment(segmentKey) ? emailOpportunityId(segmentKey, snapshot.generatedAt) : null,
        audienceCount: segment.audienceCount,
        withValidEmailCount: segment.withValidEmailCount,
        exclusiveAudienceCount: exclusive,
        exclusivityApplies,
        sendEligibleCount: null,
        whyNow: campaign.whyNow,
        objective: campaign.objective,
        priority: campaign.priority,
        cooldown: { days: campaign.recommendedCooldownDays, status: EMAIL_COOLDOWN_STATUS },
        requirementsStatus: readiness.status,
        missingRequirements: readiness.missingHard.map(r => ({ key: r.key, description: r.description, evidence: capabilities[r.key]?.evidence ?? '' })),
        degradedRequirements: readiness.missingSoft.map(r => ({ key: r.key, description: r.description })),
        blockedReasons,
        sendBlockers: [...SEND_BLOCKERS],
        sendEligibility: 'SEND_ELIGIBILITY_UNVERIFIED',
        actionable,
        confidence: confidenceFor(segment, actionable, consentConfigured),
      } })
    }
  })

  // Ordem de definição na biblioteca desempata o ranking de forma estável.
  ranked.sort((x, y) => {
    const a = x.rec
    const b = y.rec
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1
    if (a.priority !== b.priority) return a.priority - b.priority
    const reachA = (a.exclusivityApplies ? a.exclusiveAudienceCount : a.audienceCount) ?? 0
    const reachB = (b.exclusivityApplies ? b.exclusiveAudienceCount : b.audienceCount) ?? 0
    if (reachA !== reachB) return reachB - reachA
    return x.order - y.order
  })
  const recommendations = ranked.map(item => item.rec)

  return {
    generatedAt: snapshot.generatedAt,
    consentSource: snapshot.consentSource,
    sendEligibility: snapshot.sendEligibility,
    cooldownStatus: EMAIL_COOLDOWN_STATUS,
    recommendations,
    summary: {
      total: recommendations.length,
      actionable: recommendations.filter(r => r.actionable).length,
      needsData: recommendations.filter(r => r.requirementsStatus === 'NEEDS_DATA' || r.blockedReasons.includes('SEGMENT_NEEDS_DATA')).length,
      superseded: recommendations.filter(r => r.blockedReasons.includes('SUPERSEDED_BY_HIGHER_PRIORITY')).length,
    },
  }
}

export async function getEmailRecommendations(): Promise<EmailRecommendationsResult> {
  return buildEmailRecommendations(await getEmailAudienceSnapshot())
}

// Campanhas por segmento (para a tabela "Segmentos → campanhas disponíveis").
export function campaignsForSegment(segmentKey: EmailSegmentKey, campaigns: EmailCampaignDefinition[] = listEmailCampaigns()): EmailCampaignDefinition[] {
  return campaigns.filter(c => c.allowedSegments.includes(segmentKey))
}
