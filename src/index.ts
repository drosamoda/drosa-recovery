import 'express-async-errors'
import express from 'express'
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
import nuvemshopWebhookRoutes from './routes/webhooks.nuvemshop.routes'
import metaWebhookRoutes from './routes/webhooks.meta.routes'

import { adminAuth } from './middlewares/adminAuth'
import { jobsAuth } from './middlewares/jobsAuth'
import { inboxAuth } from './middlewares/inboxAuth'

// Inicializa Sentry antes de qualquer rota (opcional — sem DSN não faz nada)
initSentry()

const app = express()

const ALLOWED_ORIGINS = [
  /^https:\/\/[\w-]+\.lovable\.app$/,
  /^http:\/\/localhost:\d+$/,
]

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Permite requisições sem origin (ex: curl, Postman, Railway health check)
    if (!origin) return callback(null, true)
    const allowed = ALLOWED_ORIGINS.some((pattern) => pattern.test(origin))
    callback(allowed ? null : new Error('CORS bloqueado'), allowed)
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-secret', 'x-jobs-secret', 'x-inbox-admin-secret'],
}

// CORS — aceita qualquer subdomínio *.lovable.app e localhost
// Explicit OPTIONS handler must come before all other routes
app.options('*', cors(corsOptions))
app.use(cors(corsOptions))

app.use(requestId)
app.use(express.json({ verify: captureRawBody }))
app.use('/inbox-assets', express.static(path.join(process.cwd(), 'public', 'inbox')))

// ── Rotas públicas ─────────────────────────────────────────────────────
app.use('/health', healthRoutes)
app.use('/docs', docsRoutes)

// ── Webhooks (sem auth de usuário — validados por HMAC/assinatura) ─────
app.use('/webhooks/nuvemshop', nuvemshopWebhookRoutes)
app.use('/webhooks/meta', metaWebhookRoutes)

app.get('/inbox', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'inbox', 'index.html'))
})

// ── Rotas protegidas ───────────────────────────────────────────────────
app.use('/admin', adminRoutes)
app.use('/jobs', jobsAuth, jobsRoutes)
app.use('/customers', customersRoutes)
app.use('/inbox', inboxAuth, inboxRoutes)

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

    // ── Cron jobs internos ────────────────────────────────────────────
    // process-messages: a cada 1 minuto
    cron.schedule(`*/${env.CRON_PROCESS_MESSAGES_INTERVAL} * * * *`, async () => {
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
    cron.schedule(`*/${env.CRON_ABANDONED_CART_INTERVAL} * * * *`, async () => {
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
    cron.schedule(`*/${env.CRON_BOLETO_EXPIRING_INTERVAL} * * * *`, async () => {
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
      processMessages: `a cada ${env.CRON_PROCESS_MESSAGES_INTERVAL} min`,
      syncAbandonedCheckouts: `a cada ${env.CRON_ABANDONED_CART_INTERVAL} min`,
      syncBoletoExpiring: `a cada ${env.CRON_BOLETO_EXPIRING_INTERVAL} min`,
    })
  })
}

export default app
