import { Router, Request, Response } from 'express'
import { logger } from '../config/logger'
import { biDatasource, clampDays, isBiDataset, readBiDataset } from '../services/biReadService'
import { buildEmbedUrl, isMetabaseModule, metabaseStatus, MetabaseNotConfiguredError, MetabaseSemanticReviewPendingError } from '../services/metabaseEmbed'

// /crm-api/bi — somente GET, montado atrás do mesmo crmAuth de /crm-api.
const router = Router()

router.get('/metabase-status', async (_req: Request, res: Response) => {
  res.json(await metabaseStatus())
})

router.get('/embed/:module', (req: Request, res: Response) => {
  const { module } = req.params
  if (!isMetabaseModule(module)) return res.status(404).json({ error: 'Módulo não autorizado.' })
  try {
    return res.json(buildEmbedUrl(module))
  } catch (error) {
    if (error instanceof MetabaseSemanticReviewPendingError) {
      return res.status(503).json({ error: 'Painel Metabase em revisão semântica; indicadores nativos da Central valem.', code: error.code })
    }
    if (error instanceof MetabaseNotConfiguredError) {
      return res.status(503).json({ error: 'Metabase não configurado neste ambiente.', code: error.code })
    }
    throw error
  }
})

router.get('/data/:dataset', async (req: Request, res: Response) => {
  const { dataset } = req.params
  if (!isBiDataset(dataset)) return res.status(404).json({ error: 'Dataset não autorizado.' })
  const days = clampDays(req.query.days)
  try {
    const rows = await readBiDataset(dataset, days)
    return res.json({ data: rows, days, datasource: biDatasource() })
  } catch (error) {
    // Nunca devolver mensagem do driver (pode citar host/schema).
    logger.error('[bi] falha ao ler dataset', { dataset, error: error instanceof Error ? error.name : 'unknown' })
    return res.status(502).json({ error: 'Falha ao consultar as views de BI.', code: 'BI_QUERY_FAILED' })
  }
})

export default router
