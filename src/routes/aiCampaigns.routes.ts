import { Request, Response, Router } from 'express'
import { generateOpportunities } from '../services/aiOpportunityEngine'
import { campaignService, CampaignNotFoundError, InvalidCampaignStateError } from '../services/ai/campaignService'
import { getLearningSummary } from '../services/ai/learningService'
import { AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError } from '../services/ai/aiProvider'

const router = Router()

function handleError(res: Response, error: unknown) {
  if (error instanceof CampaignNotFoundError) return res.status(404).json({ error: error.message })
  if (error instanceof InvalidCampaignStateError) return res.status(409).json({ error: error.message })
  if (error instanceof AiProviderConfigError) return res.status(503).json({ error: error.message, code: 'AI_PROVIDER_NOT_CONFIGURED' })
  if (error instanceof AiProviderTimeoutError) return res.status(504).json({ error: error.message })
  if (error instanceof AiProviderResponseError) return res.status(502).json({ error: error.message })
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Erro inesperado' })
}

// Leitura: protegida só pelo crmAuth já aplicado em /crm-api no index.ts
// (mesmo nível de acesso somente-leitura das outras 7 áreas).
router.get('/opportunities', async (_req: Request, res: Response) => {
  res.json({ data: await generateOpportunities() })
})

router.get('/campaigns', async (_req: Request, res: Response) => {
  res.json({ data: await campaignService.list() })
})

router.get('/campaigns/:id', async (req: Request, res: Response) => {
  try {
    res.json(await campaignService.getById(req.params.id))
  } catch (error) {
    handleError(res, error)
  }
})

router.get('/learning', async (_req: Request, res: Response) => {
  res.json(await getLearningSummary())
})

// Escrita: mesmo x-crm-read-secret do resto do preview (é o único segredo
// que a tela já coleta). Seguro porque estas rotas nunca tocam WhatsApp,
// Nuvemshop ou dado de cliente existente — só as tabelas novas e isoladas
// campaign_drafts/ai_runs, e só quando CRM_PREVIEW_READONLY libera a exceção
// de escrita em index.ts.
router.post('/campaigns', async (req: Request, res: Response) => {
  const opportunityId = String(req.body?.opportunityId ?? '')
  if (!opportunityId) return res.status(400).json({ error: 'opportunityId é obrigatório' })
  try {
    res.status(201).json(await campaignService.createFromOpportunity(opportunityId))
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/campaigns/:id/select', async (req: Request, res: Response) => {
  const strategyIndex = Number(req.body?.strategyIndex)
  if (!Number.isInteger(strategyIndex)) return res.status(400).json({ error: 'strategyIndex é obrigatório' })
  try {
    res.json(await campaignService.selectStrategy(req.params.id, strategyIndex))
  } catch (error) {
    handleError(res, error)
  }
})

// Único endpoint que pode levar um draft a APPROVED. A IA nunca chama esta
// rota — só um clique humano explícito na tela, com approvedBy preenchido.
router.post('/campaigns/:id/approve', async (req: Request, res: Response) => {
  const approvedBy = String(req.body?.approvedBy ?? '')
  if (!approvedBy) return res.status(400).json({ error: 'approvedBy é obrigatório (identifique quem aprovou)' })
  try {
    res.json(await campaignService.approve(req.params.id, approvedBy))
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/campaigns/:id/schedule', async (req: Request, res: Response) => {
  try {
    res.json(await campaignService.schedule(req.params.id))
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/campaigns/:id/cancel', async (req: Request, res: Response) => {
  try {
    res.json(await campaignService.cancel(req.params.id))
  } catch (error) {
    handleError(res, error)
  }
})

export default router
