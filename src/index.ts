import 'express-async-errors'
import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import cron from 'node-cron'
import path from 'path'
import { env } from './config/env'
import { initSentry } from './config/sentry'
import { logger } from './config/logger'
import { captureRawBody } from './middlewares/rawBody'
import { requestId } from './middlewares/requestId'
import { runProcessMessages } from './jobs/processMessages'
import { runSyncAbandonedCheckouts } from './jobs/syncAbandonedCheckouts'
import { runSyncBoletoExpiring } from './jobs/syncBoletoExpiring'

import healthRoutes from './routes/health.routes'
import docsRoutes from './routes/docs.routes'
import adminRoutes from './routes/admin.routes'
import jobsRoutes from './routes/jobs.routes'
import customersRoutes from './routes/customers.routes'
import inboxRoutes from './routes/inbox.routes'
import crmRoutes from './routes/crm.routes'
import aiCampaignsRoutes from './routes/aiCampaigns.routes'
import emailIntelligenceRoutes from './routes/emailIntelligence.routes'
import nuvemshopWebhookRoutes from './routes/webhooks.nuvemshop.routes'
import metaWebhookRoutes from './routes/webhooks.meta.routes'
import emailUnsubscribeRoutes from './routes/emailUnsubscribe.routes'

import { adminAuth } from './middlewares/adminAuth'
import { jobsAuth } from './middlewares/jobsAuth'
import { inboxAuth } from './middlewares/inboxAuth'
import { crmAuth } from './middlewares/crmAuth'

// Inicializa Sentry antes de qualquer rota (opcional — sem DSN não faz nada)
initSentry()

const app = express()

export function shouldStartInternalCron(enabled: boolean = env.ENABLE_INTERNAL_CRON): boolean {
  if (env.CRM_PREVIEW_READONLY) return false
  return enabled
}

const ALLOWED_ORIGINS = [
  'https://drosa-recovery-production.up.railway.app',
  'https://drosa-recovery-production-bcfa.up.railway.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  env.APP_BASE_URL,
].filter(Boolean).map(normalizeOrigin)

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, '')
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  return ALLOWED_ORIGINS.includes(normalizeOrigin(origin))
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Permite requisições sem origin (ex: curl, Postman, Railway health check)
    if (!origin) return callback(null, true)
    callback(null, isAllowedOrigin(origin))
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-inbox-admin-secret', 'x-crm-read-secret'],
}

// CORS — aceita qualquer subdomínio *.lovable.app e localhost
// Explicit OPTIONS handler must come before all other routes
//
// Same-origin sempre passa, mesmo fora de ALLOWED_ORIGINS: browsers enviam o
// header Origin em POST/PATCH/DELETE mesmo quando a chamada é para o próprio
// host da página (fetch() dentro do crm-v2 chamando /crm-api/ai/*), o que
// GET nunca fazia — por isso nenhuma escrita do crm-v2 tinha exercitado este
// bloqueio antes de existir a primeira. Cada deploy do Preview recebe um
// subdomínio novo (nunca listável em ALLOWED_ORIGINS de antemão), então a
// checagem correta aqui é "a origem é o próprio host da requisição", não uma
// lista estática.
function isSameOrigin(origin: string, req: Request): boolean {
  try {
    return new URL(origin).host === req.get('host')
  } catch {
    return false
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && !isAllowedOrigin(origin) && !isSameOrigin(origin, req)) {
    res.status(403).json({ error: 'CORS bloqueado' })
    return
  }
  next()
})
app.options('*', cors(corsOptions))
app.use(cors(corsOptions))

app.use(requestId)
app.use(express.json({ verify: captureRawBody }))
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/webhooks/nuvemshop/orders') {
    logger.warn('[webhook/nuvemshop] payload invalido', {
      nuvemshopOrderId: undefined,
      details: err.message,
      rawBodyLength: req.rawBody?.length ?? 0,
    })
    res.status(400).json({ error: 'Payload inválido', details: err.message })
    return
  }

  next(err)
})
app.use('/inbox-assets', express.static(path.join(process.cwd(), 'public', 'inbox')))
app.use('/crm-assets', express.static(path.join(process.cwd(), 'public', 'crm')))
app.use('/crm-v2-assets', express.static(path.join(process.cwd(), 'public', 'crm-v2')))

// ── Modo Preview somente-leitura: nenhuma mutação, sem envio real ──────
// Sem integrações operacionais nem rotas administrativas/webhooks montadas.
//
// Única exceção: /crm-api/ai/campaigns (rascunhos de campanha + aprovação
// humana). Isso NUNCA envia WhatsApp de verdade (WHATSAPP_DRY_RUN continua
// true), não toca Nuvemshop, não toca dado de cliente existente — só cria
// linhas nas tabelas novas e isoladas campaign_drafts/ai_runs. Continua
// exigindo o mesmo x-crm-read-secret já obrigatório em todo /crm-api (via
// crmAuth em index.ts), então um preview sem CRM_READ_SECRET configurado
// permanece 100% bloqueado como antes.
if (env.CRM_PREVIEW_READONLY) {
  app.use((req, res, next) => {
    const isAiCampaignWrite = req.path.startsWith('/crm-api/ai/campaigns')
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !isAiCampaignWrite) {
      res.status(404).json({ error: 'Rota não encontrada' })
      return
    }
    next()
  })
}

// ── Rotas públicas ─────────────────────────────────────────────────────
app.use('/health', healthRoutes)
app.use('/docs', docsRoutes)

// ── Webhooks (sem auth de usuário — validados por HMAC/assinatura) ─────
if (!env.CRM_PREVIEW_READONLY) {
  app.use('/webhooks/nuvemshop', nuvemshopWebhookRoutes)
  app.use('/webhooks/meta', metaWebhookRoutes)
  // Descadastro de e-mail: público por natureza (o destinatário não tem login),
  // validado pela assinatura do token. Sem EMAIL_UNSUBSCRIBE_SECRET responde 503.
  app.use('/unsubscribe/email', emailUnsubscribeRoutes)
}

app.get('/inbox', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'inbox', 'index.html'))
})
app.get('/crm', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'crm', 'index.html'))
})
// Piloto visual isolado (redesign radical de interface) — reaproveita EXATAMENTE o mesmo /crm-api
// e o mesmo crmAuth já usados por /crm; nenhuma lógica de negócio, dado ou regra nova. /crm
// permanece intocado e servido em paralelo até aprovação humana visual do /crm-v2.
app.get('/crm-v2', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'crm-v2', 'index.html'))
})

// ── Rotas protegidas ───────────────────────────────────────────────────
if (!env.CRM_PREVIEW_READONLY) {
  app.use('/admin', adminAuth, adminRoutes)
  app.use('/jobs', jobsAuth, jobsRoutes)
  app.use('/customers', customersRoutes)
  app.use('/inbox', inboxAuth, inboxRoutes)
}
app.use('/crm-api', crmAuth, crmRoutes)
app.use('/crm-api/ai', crmAuth, aiCampaignsRoutes)
// Inteligência de e-mail: somente leitura (GET). Nenhum envio de e-mail existe.
app.use('/crm-api/email', crmAuth, emailIntelligenceRoutes)

// ── 404 ────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

if (env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    logger.info(`D'Rosa Recovery iniciado`, {
      port: env.PORT,
      environment: env.NODE_ENV,
    })

    if (!shouldStartInternalCron()) {
      logger.info('[cron] jobs internos desabilitados', { enabled: false })
      return
    }

    // ── Cron jobs internos ────────────────────────────────────────────
    // process-messages: a cada 1 minuto
    if (env.CRON_PROCESS_MESSAGES_ENABLED) cron.schedule(`*/${env.CRON_PROCESS_MESSAGES_INTERVAL} * * * *`, async () => {
      try {
        const result = await runProcessMessages()
        if (result.found > 0) {
          logger.info('[cron] process-messages', result)
        }
      } catch (err) {
        logger.error('[cron] process-messages erro', { error: String(err) })
      }
    })

    // sync-abandoned-checkouts: a cada 15 minutos
    if (env.CRON_ABANDONED_CART_ENABLED) cron.schedule(`*/${env.CRON_ABANDONED_CART_INTERVAL} * * * *`, async () => {
      try {
        const result = await runSyncAbandonedCheckouts()
        if (result.found > 0) {
          logger.info('[cron] sync-abandoned-checkouts', result)
        }
      } catch (err) {
        logger.error('[cron] sync-abandoned-checkouts erro', { error: String(err) })
      }
    })

    // sync-boleto-expiring: a cada CRON_BOLETO_EXPIRING_INTERVAL minutos (padrão 60)
    if (env.CRON_BOLETO_EXPIRING_ENABLED) cron.schedule(`*/${env.CRON_BOLETO_EXPIRING_INTERVAL} * * * *`, async () => {
      try {
        const result = await runSyncBoletoExpiring()
        if (result.found > 0) {
          logger.info('[cron] sync-boleto-expiring', result)
        }
      } catch (err) {
        logger.error('[cron] sync-boleto-expiring erro', { error: String(err) })
      }
    })

    logger.info('[cron] jobs agendados', {
      processMessages: env.CRON_PROCESS_MESSAGES_ENABLED ? `a cada ${env.CRON_PROCESS_MESSAGES_INTERVAL} min` : false,
      syncAbandonedCheckouts: env.CRON_ABANDONED_CART_ENABLED ? `a cada ${env.CRON_ABANDONED_CART_INTERVAL} min` : false,
      syncBoletoExpiring: env.CRON_BOLETO_EXPIRING_ENABLED ? `a cada ${env.CRON_BOLETO_EXPIRING_INTERVAL} min` : false,
    })
  })
}

export default app
