import { describe, expect, it, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createHmac } from 'crypto'

const state = vi.hoisted(() => ({
  statements: [] as string[],
  rows: [] as unknown[],
  fail: false,
  writes: vi.fn(),
}))

vi.mock('../../config/prisma', () => {
  const prisma = {
    $executeRawUnsafe: (sql: string) => {
      state.statements.push(sql)
      return Promise.resolve(0)
    },
    $queryRawUnsafe: (sql: string, ...params: unknown[]) => {
      state.statements.push(`${sql} :: ${JSON.stringify(params)}`)
      return state.fail ? Promise.reject(new Error('connect ECONNREFUSED db.internal.host:5432 relation "bi_x"')) : Promise.resolve(state.rows)
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  }
  return { prisma }
})

const SECRET = 'test_crm_read_secret'
const METABASE_KEY = 'metabase_test_key_0123456789abcdef'

async function app() {
  return (await import('../../index')).default
}

describe('GET /crm-api/bi/* — somente leitura, allowlist server-side', () => {
  beforeEach(() => {
    state.statements = []
    state.rows = []
    state.fail = false
  })

  it('401 sem x-crm-read-secret', async () => {
    const res = await request(await app()).get('/crm-api/bi/data/messageDaily')
    expect(res.status).toBe(401)
    expect(state.statements).toHaveLength(0)
  })

  it('dataset fora da allowlist => 404 sem tocar no banco', async () => {
    const res = await request(await app()).get('/crm-api/bi/data/orders; drop table x').set('x-crm-read-secret', SECRET)
    expect(res.status).toBe(404)
    expect(state.statements).toHaveLength(0)
  })

  it('lê view bi_* dentro de SET TRANSACTION READ ONLY, com days limitado a 90', async () => {
    state.rows = [{ day: '2026-09-26', status: 'delivered', count: 3 }]
    const res = await request(await app()).get('/crm-api/bi/data/messageDaily?days=9999').set('x-crm-read-secret', SECRET)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ data: state.rows, days: 90, datasource: 'service_readonly_tx' })
    expect(state.statements[0]).toBe('SET TRANSACTION READ ONLY')
    expect(state.statements[1]).toMatch(/from bi_message_daily_stats/)
    expect(state.statements[1]).toContain('[90]')
    expect(state.statements.join(' ')).not.toMatch(/\b(insert|update|delete|create|alter|drop)\b/i)
  })

  it('falha do banco vira 502 genérico, sem vazar host/schema', async () => {
    state.fail = true
    const res = await request(await app()).get('/crm-api/bi/data/systemPulse').set('x-crm-read-secret', SECRET)
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('BI_QUERY_FAILED')
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|internal|relation|5432/)
  })

  it('embed: módulo fora da allowlist => 404 (browser não escolhe dashboard ID)', async () => {
    const res = await request(await app()).get('/crm-api/bi/embed/42').set('x-crm-read-secret', SECRET)
    expect(res.status).toBe(404)
  })

  it('embed sem Metabase configurado => 503 METABASE_NOT_CONFIGURED', async () => {
    const res = await request(await app()).get('/crm-api/bi/embed/integrations').set('x-crm-read-secret', SECRET)
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('METABASE_NOT_CONFIGURED')
  })

  it('embed configurado: JWT HS256 válido para o ID da allowlist, sem expor a chave', async () => {
    vi.resetModules()
    process.env.METABASE_SITE_URL = 'https://metabase.example.test/'
    process.env.METABASE_SECRET_KEY = METABASE_KEY
    try {
      const res = await request(await app()).get('/crm-api/bi/embed/integrations').set('x-crm-read-secret', SECRET)
      expect(res.status).toBe(200)
      expect(JSON.stringify(res.body)).not.toContain(METABASE_KEY)
      const token = String(res.body.url).match(/\/embed\/dashboard\/([^#]+)/)?.[1] ?? ''
      const [h, p, sig] = token.split('.')
      expect(createHmac('sha256', METABASE_KEY).update(`${h}.${p}`).digest('base64url')).toBe(sig)
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
      expect(payload.resource).toEqual({ dashboard: 8 })
      expect(payload.exp - Math.round(Date.now() / 1000)).toBeLessThanOrEqual(600)
      expect(res.body.url.startsWith('https://metabase.example.test/embed/dashboard/')).toBe(true)
      // aliases com KPIs reprovados na auditoria semântica: bloqueados no servidor
      for (const alias of ['executive', 'recovery', 'messages', 'consents', 'orders']) {
        const r = await request(await app()).get(`/crm-api/bi/embed/${alias}`).set('x-crm-read-secret', SECRET)
        expect(r.status).toBe(503)
        expect(r.body.code).toBe('METABASE_SEMANTIC_REVIEW_PENDING')
        expect(JSON.stringify(r.body)).not.toContain('embed/dashboard')
      }
      // alias inexistente e ID numérico não escolhem dashboard
      for (const path of ['/crm-api/bi/embed/nope', '/crm-api/bi/embed/8']) {
        expect((await request(await app()).get(path).set('x-crm-read-secret', SECRET)).status).toBe(404)
      }
      // query string não muda o dashboard
      const q = await request(await app()).get('/crm-api/bi/embed/integrations?dashboard=1').set('x-crm-read-secret', SECRET)
      expect(JSON.parse(Buffer.from(String(q.body.url).match(/\/embed\/dashboard\/([^#]+)/)![1].split('.')[1], 'base64url').toString()).resource).toEqual({ dashboard: 8 })
      // sem sessão/segredo: 401, sem URL assinada
      const anon = await request(await app()).get('/crm-api/bi/embed/integrations')
      expect(anon.status).toBe(401)
      expect(JSON.stringify(anon.body)).not.toContain('embed/dashboard')
    } finally {
      delete process.env.METABASE_SITE_URL
      delete process.env.METABASE_SECRET_KEY
      vi.resetModules()
    }
  })

  it('não existe nenhuma rota de escrita em /crm-api/bi', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(await app())[method]('/crm-api/bi/data/messageDaily').set('x-crm-read-secret', SECRET)
      expect(res.status).toBe(404)
    }
    expect(state.statements).toHaveLength(0)
  })
})
