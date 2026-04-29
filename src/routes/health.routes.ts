import { Router, Request, Response } from 'express'
import { prisma } from '../config/prisma'
import { env } from '../config/env'

const router = Router()

// GET /health — resposta rápida, sem I/O
router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'drosa-recovery',
    timestamp: new Date().toISOString(),
  })
})

// GET /health/deep — verifica banco + variáveis obrigatórias
router.get('/deep', async (_req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error'> = {}
  let overall: 'ok' | 'degraded' = 'ok'

  // Verificar conexão com banco
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
    overall = 'degraded'
  }

  // Verificar variáveis obrigatórias
  const requiredVars = [
    'DATABASE_URL',
    'NUVEMSHOP_STORE_ID',
    'NUVEMSHOP_ACCESS_TOKEN',
    'META_ACCESS_TOKEN',
    'META_PHONE_NUMBER_ID',
    'ADMIN_SECRET',
    'JOBS_SECRET',
  ]
  const missingVars = requiredVars.filter((v) => !process.env[v])
  checks.env_vars = missingVars.length === 0 ? 'ok' : 'error'
  if (missingVars.length > 0) overall = 'degraded'

  const statusCode = overall === 'ok' ? 200 : 503
  res.status(statusCode).json({
    status: overall,
    service: 'drosa-recovery',
    version: '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    checks,
  })
})

export default router
