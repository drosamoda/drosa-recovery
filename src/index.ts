import 'express-async-errors'
import express from 'express'
import { env } from './config/env'
import { initSentry } from './config/sentry'
import { logger } from './config/logger'
import { captureRawBody } from './middlewares/rawBody'
import { requestId } from './middlewares/requestId'

import healthRoutes from './routes/health.routes'
import docsRoutes from './routes/docs.routes'
import adminRoutes from './routes/admin.routes'
import jobsRoutes from './routes/jobs.routes'
import customersRoutes from './routes/customers.routes'
import nuvemshopWebhookRoutes from './routes/webhooks.nuvemshop.routes'
import metaWebhookRoutes from './routes/webhooks.meta.routes'

import { adminAuth } from './middlewares/adminAuth'
import { jobsAuth } from './middlewares/jobsAuth'

// Inicializa Sentry antes de qualquer rota (opcional — sem DSN não faz nada)
initSentry()

const app = express()

app.use(requestId)
app.use(express.json({ verify: captureRawBody }))

// ── Rotas públicas ─────────────────────────────────────────────────────
app.use('/health', healthRoutes)
app.use('/docs', docsRoutes)

// ── Webhooks (sem auth de usuário — validados por HMAC/assinatura) ─────
app.use('/webhooks/nuvemshop', nuvemshopWebhookRoutes)
app.use('/webhooks/meta', metaWebhookRoutes)

// ── Rotas protegidas ───────────────────────────────────────────────────
app.use('/admin', adminAuth, adminRoutes)
app.use('/jobs', jobsAuth, jobsRoutes)
app.use('/customers', adminAuth, customersRoutes)

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
  })
}

export default app
