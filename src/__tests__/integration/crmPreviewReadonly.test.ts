import { describe, expect, it, vi, afterAll } from 'vitest'
import request from 'supertest'

// Isola de I/O real: /health/deep só precisa saber que o banco respondeu.
vi.mock('../../config/prisma', () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) },
}))

// crmReadService não é alterado por esta missão — mocado apenas para não
// depender de um Postgres real durante o teste de rota.
vi.mock('../../services/crmReadService', () => ({
  crmReadService: {
    health: vi.fn().mockResolvedValue({
      meta: { configured: false },
      nuvemshop: { configured: false },
    }),
  },
}))

const ORIGINAL_ENV = { ...process.env }

const READONLY_ENV: Record<string, string | undefined> = {
  CRM_PREVIEW_READONLY: 'true',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/drosa_test',
  DIRECT_URL: 'postgresql://test:test@localhost:5432/drosa_test_direct',
  CRM_READ_SECRET: 'readonly_secret',
  // Integrações operacionais explicitamente ausentes — devem ser dispensáveis.
  NUVEMSHOP_STORE_ID: undefined,
  NUVEMSHOP_ACCESS_TOKEN: undefined,
  META_ACCESS_TOKEN: undefined,
  META_PHONE_NUMBER_ID: undefined,
  ADMIN_SECRET: undefined,
  JOBS_SECRET: undefined,
  INBOX_ADMIN_SECRET: undefined,
  WEBHOOK_SECRET: undefined,
  META_APP_SECRET: undefined,
  META_VERIFY_TOKEN: undefined,
  // Mesmo que alguém configure isso por engano em Preview, deve ficar desligado.
  ENABLE_INTERNAL_CRON: 'true',
  ABANDONED_CART_ENABLED: 'true',
  REMARKETING_ENABLED: 'true',
  AUTOMATION_SEND_ENABLED: 'true',
}

async function bootApp(overrides: Record<string, string | undefined>) {
  vi.resetModules()
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, ORIGINAL_ENV)
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const mod = await import('../../index')
  return mod
}

afterAll(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, ORIGINAL_ENV)
})

describe('CRM_PREVIEW_READONLY', () => {
  it('modo normal (ausente/false) continua exigindo integrações operacionais e mantém rotas administrativas montadas', async () => {
    const { default: app } = await bootApp({ CRM_PREVIEW_READONLY: 'false' })
    const res = await request(app).get('/admin/health').set('x-admin-secret', 'secret-errado')
    // Rota existe (401 = negada por secret errado); em read-only ela nem existiria (404).
    expect(res.status).toBe(401)
  })

  it('inicia com sucesso apenas com DATABASE_URL + DIRECT_URL + CRM_READ_SECRET em modo read-only', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
  })

  it('mantém GET /crm-api disponível em modo read-only', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const res = await request(app).get('/crm-api/health').set('x-crm-read-secret', 'readonly_secret')
    expect(res.status).toBe(200)
    expect(res.body.meta.configured).toBe(false)
  })

  it('torna /admin indisponível em modo read-only', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const res = await request(app).get('/admin/health')
    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ error: 'Rota não encontrada' })
  })

  it('torna /jobs indisponível em modo read-only', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const res = await request(app).get('/jobs/automation-health')
    expect(res.status).toBe(404)
  })

  it('torna /inbox indisponível em modo read-only', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const res = await request(app).get('/inbox/conversations')
    expect(res.status).toBe(404)
  })

  it('torna webhooks indisponíveis em modo read-only', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const meta = await request(app).post('/webhooks/meta')
    const nuvemshop = await request(app).post('/webhooks/nuvemshop/orders')
    expect(meta.status).toBe(404)
    expect(nuvemshop.status).toBe(404)
  })

  it('bloqueia POST/PATCH/DELETE em modo read-only mesmo sobre rotas existentes', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const post = await request(app).post('/crm-api/health')
    const patch = await request(app).patch('/crm-api/health')
    const del = await request(app).delete('/crm-api/health')
    expect(post.status).toBe(404)
    expect(patch.status).toBe(404)
    expect(del.status).toBe(404)
  })

  it('/health/deep valida somente banco + DATABASE_URL/DIRECT_URL/CRM_READ_SECRET em modo read-only', async () => {
    const { default: app } = await bootApp(READONLY_ENV)
    const res = await request(app).get('/health/deep')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.readOnly).toBe(true)
    expect(res.body.checks.env_vars).toBe('ok')
  })

  it('nenhuma integração de envio é ativada em modo read-only, mesmo se as flags vierem true por engano', async () => {
    const { shouldStartInternalCron } = await bootApp(READONLY_ENV)
    expect(shouldStartInternalCron(true)).toBe(false)
  })
})
