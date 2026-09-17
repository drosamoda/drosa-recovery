import { Request, Response, Router } from 'express'
import { generateOpportunities } from '../services/aiOpportunityEngine'
import { campaignService, CampaignNotFoundError, InvalidCampaignStateError } from '../services/ai/campaignService'
import { getLearningSummary } from '../services/ai/learningService'
import { AiProviderConfigError, AiProviderResponseError, AiProviderTimeoutError } from '../services/ai/aiProvider'
import { logger } from '../config/logger'
import { adminAuth } from '../middlewares/adminAuth'

const router = Router()

// Erros conhecidos (estado de negócio / IA) são seguros para expor ao cliente.
// Qualquer outro erro (ex.: falha do Prisma expondo nome de tabela/schema) é
// logado com detalhe completo no servidor e nunca repassado cru na resposta —
// reproduzido ao vivo: uma falha de banco (migration pendente) vazava a
// mensagem interna do Prisma ("table public.campaign_drafts does not exist")
// direto no JSON de erro.
function handleError(res: Response, error: unknown) {
  if (error instanceof CampaignNotFoundError) return res.status(404).json({ error: error.message })
  if (error instanceof InvalidCampaignStateError) return res.status(409).json({ error: error.message })
  if (error instanceof AiProviderConfigError) return res.status(503).json({ error: error.message, code: 'AI_PROVIDER_NOT_CONFIGURED' })
  if (error instanceof AiProviderTimeoutError) return res.status(504).json({ error: error.message })
  if (error instanceof AiProviderResponseError) return res.status(502).json({ error: error.message })
  logger.error('[ai/campaigns] erro inesperado', error)
  return res.status(500).json({ error: 'Erro inesperado ao processar a campanha' })
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
// adminAuth (mesmo middleware já usado por /admin) é exigido aqui porque
// aprovar é o ato que autoriza a campanha a avançar rumo ao agendamento —
// o crmAuth (x-crm-read-secret) sozinho não é suficiente para uma ação
// administrativa dessas.
router.post('/campaigns/:id/approve', adminAuth, async (req: Request, res: Response) => {
  const approvedBy = String(req.body?.approvedBy ?? '')
  if (!approvedBy) return res.status(400).json({ error: 'approvedBy é obrigatório (identifique quem aprovou)' })
  try {
    res.json(await campaignService.approve(req.params.id, approvedBy))
  } catch (error) {
    handleError(res, error)
  }
})

router.post('/campaigns/:id/schedule', adminAuth, async (req: Request, res: Response) => {
  try {
    res.json(await campaignService.schedule(req.params.id))
  } catch (error) {
    handleError(res, error)
  }
})

// Cancelamento também é administrativo: uma campanha aprovada/agendada tem
// impacto operacional, e não exigir o mesmo gate aqui abriria um atalho para
// desfazer uma decisão humana sem outra autorização humana equivalente.
router.post('/campaigns/:id/cancel', adminAuth, async (req: Request, res: Response) => {
  try {
    res.json(await campaignService.cancel(req.params.id))
  } catch (error) {
    handleError(res, error)
  }
})

export default router
