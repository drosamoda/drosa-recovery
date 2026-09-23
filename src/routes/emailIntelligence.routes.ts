import { Request, Response, Router } from 'express'
import { logger } from '../config/logger'
import { EMAIL_COOLDOWN_STATUS, SEGMENT_META, getEmailAudienceSnapshot } from '../services/emailAudienceEngine'
import {
  EMAIL_CAMPAIGN_LIBRARY_VERSION,
  EMAIL_DATA_CAPABILITIES,
  evaluateCampaignReadiness,
  listEmailCampaigns,
} from '../services/emailCampaignLibrary'
import { buildEmailRecommendations } from '../services/emailCampaignRecommendationService'
import { evaluateEmailSendGate } from '../services/emailSendGate'

// Leitura de inteligência de e-mail — SOMENTE GET, protegido pelo crmAuth já
// aplicado em index.ts (mesmo x-crm-read-secret das outras áreas). Nada aqui
// envia, agenda ou grava e-mail: só agregados calculados no backend. A
// geração de campanha com IA usa o mesmo POST /crm-api/ai/campaigns (mesmo
// pipeline de IA, mesma idempotencyKey obrigatória) — não existe um segundo
// sistema de IA nem um endpoint de envio.
const router = Router()

// Erros nunca vazam detalhe interno (nome de tabela/coluna, SQL): logados com
// contexto no servidor, resposta genérica ao cliente.
function fail(res: Response, error: unknown, what: string) {
  logger.error(`[email-intelligence] erro ao calcular ${what}`, error)
  res.status(500).json({ error: `Erro inesperado ao calcular ${what}` })
}

router.get('/audiences', async (_req: Request, res: Response) => {
  try {
    res.json(await getEmailAudienceSnapshot())
  } catch (error) {
    fail(res, error, 'as audiências de e-mail')
  }
})

router.get('/campaign-library', (_req: Request, res: Response) => {
  const campaigns = listEmailCampaigns().map(campaign => {
    const readiness = evaluateCampaignReadiness(campaign)
    return {
      key: campaign.key,
      name: campaign.name,
      category: campaign.category,
      objective: campaign.objective,
      description: campaign.description,
      allowedSegments: campaign.allowedSegments.map(key => ({ key, name: SEGMENT_META[key].name })),
      excludedSegments: campaign.excludedSegments.map(key => ({ key, name: SEGMENT_META[key].name })),
      track: campaign.track,
      priority: campaign.priority,
      recommendedCooldownDays: campaign.recommendedCooldownDays,
      recommendedCadence: campaign.recommendedCadence,
      cooldownStatus: EMAIL_COOLDOWN_STATUS,
      funnelStage: campaign.funnelStage,
      requirements: campaign.requirements.map(r => ({ key: r.key, hard: r.hard, description: r.description, available: EMAIL_DATA_CAPABILITIES[r.key].available, evidence: EMAIL_DATA_CAPABILITIES[r.key].evidence })),
      primaryMetric: campaign.primaryMetric,
      whyNow: campaign.whyNow,
      aiDirections: campaign.aiDirections.map(d => ({ key: d.key, label: d.label, intent: d.intent })),
      readiness: { status: readiness.status, missingHard: readiness.missingHard.map(r => r.key), missingSoft: readiness.missingSoft.map(r => r.key) },
      sendEligibility: 'SEND_ELIGIBILITY_UNVERIFIED',
    }
  })
  res.json({
    libraryVersion: EMAIL_CAMPAIGN_LIBRARY_VERSION,
    total: campaigns.length,
    ready: campaigns.filter(c => c.readiness.status === 'READY').length,
    needsData: campaigns.filter(c => c.readiness.status === 'NEEDS_DATA').length,
    sendGate: evaluateEmailSendGate(),
    data: campaigns,
  })
})

router.get('/recommendations', async (_req: Request, res: Response) => {
  try {
    res.json(buildEmailRecommendations(await getEmailAudienceSnapshot()))
  } catch (error) {
    fail(res, error, 'as recomendações de e-mail')
  }
})

export default router
