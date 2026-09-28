import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'

vi.mock('../../config/prisma', () => {
  const prisma = {
    $executeRawUnsafe: () => Promise.resolve(0),
    $queryRawUnsafe: () => Promise.resolve([{ ok: 1 }]),
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    // qualquer acesso operacional local denunciaria que o proxy foi furado
    messageLog: new Proxy({}, { get: () => () => { throw new Error('LOCAL_DB_TOUCHED') } }),
  }
  return { prisma }
})

const LOCAL_SECRET = 'test_crm_read_secret'
const UPSTREAM_SECRET = 'upstream_read_secret_value_9f8e7d6c5b4a'
const calls: { url: string; init?: RequestInit }[] = []
let upstreamStatus = 200
let upstreamBody: unknown = { data: [{ id: 'm1' }], pagination: { page: 1, pageSize: 25, total: 1 } }

describe('Preview: proxy GET read-only para a API oficial', () => {
  const realFetch = globalThis.fetch
  beforeAll(() => {
    process.env.CRM_UPSTREAM_URL = 'https://upstream.example.test'
    process.env.CRM_UPSTREAM_READ_SECRET = UPSTREAM_SECRET
    process.env.CRM_PREVIEW_READONLY = 'true'
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify(upstreamBody), { status: upstreamStatus, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
  })
  afterAll(() => {
    globalThis.fetch = realFetch
    delete process.env.CRM_UPSTREAM_URL
    delete process.env.CRM_UPSTREAM_READ_SECRET
    delete process.env.CRM_PREVIEW_READONLY
    vi.resetModules()
  })
  beforeEach(() => {
    calls.length = 0
    upstreamStatus = 200
    upstreamBody = { data: [{ id: 'm1' }], pagination: { page: 1, pageSize: 25, total: 1 } }
    vi.resetModules()
  })
  const app = async () => (await import('../../index')).default

  it('GET_ALLOWED: encaminha rota da allowlist com query, injeta o segredo do upstream e não repassa header do cliente', async () => {
    const res = await request(await app()).get('/crm-api/messages?status=skipped&page=2').set('x-crm-read-secret', LOCAL_SECRET).set('Cookie', 'x=y')
    expect(res.status).toBe(200)
    expect(res.body.data[0].id).toBe('m1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://upstream.example.test/crm-api/messages?status=skipped&page=2')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['x-crm-read-secret']).toBe(UPSTREAM_SECRET)
    expect(headers.Cookie ?? headers.cookie).toBeUndefined()
  })

  it('SECRET_NOT_EXPOSED: resposta ao browser não contém o segredo do upstream', async () => {
    const res = await request(await app()).get('/crm-api/dashboard?period=7d').set('x-crm-read-secret', LOCAL_SECRET)
    expect(JSON.stringify(res.headers)).not.toContain(UPSTREAM_SECRET)
    expect(res.text).not.toContain(UPSTREAM_SECRET)
  })

  it.each(['post', 'put', 'patch', 'delete'] as const)('%s em /crm-api => 405 sem chamar o upstream', async (method) => {
    for (const path of ['/crm-api/messages', '/crm-api/ai/campaigns', '/crm-api/bi/data/systemPulse']) {
      const res = await request(await app())[method](path).set('x-crm-read-secret', LOCAL_SECRET).send({})
      expect(res.status).toBe(405)
    }
    expect(calls).toHaveLength(0)
  })

  it('rota fora da allowlist / tentativa de URL arbitrária => 404 sem upstream', async () => {
    for (const path of ['/crm-api/admin', '/crm-api/..%2F..%2Fjobs', '/crm-api/messages/1/extra', '/crm-api/https:%2F%2Fevil.test']) {
      const res = await request(await app()).get(path).set('x-crm-read-secret', LOCAL_SECRET)
      expect(res.status).toBe(404)
    }
    expect(calls).toHaveLength(0)
  })

  it('sem credencial local => 401 antes de qualquer proxy', async () => {
    expect((await request(await app()).get('/crm-api/messages')).status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('401 do upstream vira 502 (não derruba a sessão do usuário); 404/503 passam', async () => {
    upstreamStatus = 401
    expect((await request(await app()).get('/crm-api/messages').set('x-crm-read-secret', LOCAL_SECRET)).status).toBe(502)
    upstreamStatus = 404
    expect((await request(await app()).get('/crm-api/customers/nope').set('x-crm-read-secret', LOCAL_SECRET)).status).toBe(404)
    upstreamStatus = 503
    upstreamBody = { error: 'x', code: 'AI_DATABASE_NOT_CONFIGURED' }
    const r = await request(await app()).get('/crm-api/ai/learning').set('x-crm-read-secret', LOCAL_SECRET)
    expect(r.status).toBe(503)
    expect(r.body.code).toBe('AI_DATABASE_NOT_CONFIGURED')
  })

  it('BI continua local (não vai ao upstream) e o banco operacional local nunca é tocado', async () => {
    const res = await request(await app()).get('/crm-api/bi/data/systemPulse').set('x-crm-read-secret', LOCAL_SECRET)
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(0)
  })
})
