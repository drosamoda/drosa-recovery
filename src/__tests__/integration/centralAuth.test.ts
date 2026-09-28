import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'

vi.mock('../../config/prisma', () => {
  const rows = { $executeRawUnsafe: () => Promise.resolve(0), $queryRawUnsafe: () => Promise.resolve([{ ok: 1 }]) }
  return { prisma: { ...rows, $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops) } }
})

const READ_SECRET = 'test_crm_read_secret'
const SESSION_SECRET = 'central_session_test_secret_0123456789abcdef'
const PASSWORD = 'senha-de-teste-local'

async function loadApp() {
  return (await import('../../index')).default
}

function cookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  return (raw?.[0] ?? '').split(';')[0]
}

describe('Sessão da Central — flag DESLIGADA (padrão): comportamento legado idêntico', () => {
  it('/central-auth não existe e /crm-api segue exigindo x-crm-read-secret', async () => {
    vi.resetModules()
    const app = await loadApp()
    expect((await request(app).post('/central-auth/login').send({ email: 'a@b.c', password: 'x' })).status).toBe(404)
    expect((await request(app).get('/crm-api/bi/data/systemPulse')).status).toBe(401)
    expect((await request(app).get('/crm-api/bi/data/systemPulse').set('x-crm-read-secret', READ_SECRET)).status).toBe(200)
    // cookie forjado não vale nada com a flag desligada
    expect((await request(app).get('/crm-api/bi/data/systemPulse').set('Cookie', 'central_session=v1.x.y')).status).toBe(401)
  })
})

describe('Sessão da Central — flag LIGADA', () => {
  const saved: Record<string, string | undefined> = {}
  const vars = ['CENTRAL_SESSION_ENABLED', 'CENTRAL_AUTH_USERS', 'CENTRAL_SESSION_SECRET', 'CENTRAL_ADMIN_EMAILS', 'CENTRAL_SESSION_TTL_HOURS']

  beforeAll(async () => {
    for (const v of vars) saved[v] = process.env[v]
    process.env.CENTRAL_SESSION_ENABLED = 'true'
    process.env.CENTRAL_AUTH_USERS = `peter@example.test:${await bcrypt.hash(PASSWORD, 4)},leitor@example.test:${await bcrypt.hash(PASSWORD, 4)}`
    process.env.CENTRAL_SESSION_SECRET = SESSION_SECRET
    process.env.CENTRAL_ADMIN_EMAILS = 'peter@example.test'
    process.env.CENTRAL_SESSION_TTL_HOURS = '12'
  })
  afterAll(() => {
    for (const v of vars) {
      if (saved[v] === undefined) delete process.env[v]
      else process.env[v] = saved[v]
    }
    vi.resetModules()
  })
  beforeEach(() => {
    vi.resetModules()
  })

  it('login válido emite cookie httpOnly/SameSite=Strict com expiração, sem credencial no corpo', async () => {
    const app = await loadApp()
    const res = await request(app).post('/central-auth/login').send({ email: 'Peter@Example.test', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ email: 'peter@example.test', role: 'admin' })
    const header = (res.headers['set-cookie'] as unknown as string[])[0]
    expect(header).toMatch(/^central_session=v1\./)
    expect(header).toMatch(/HttpOnly/)
    expect(header).toMatch(/SameSite=Strict/)
    expect(header).toMatch(/Max-Age=43200/)
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD)
  })

  it('cookie de sessão dá acesso a /crm-api sem x-crm-read-secret; papel read para não-admin', async () => {
    const app = await loadApp()
    const login = await request(app).post('/central-auth/login').send({ email: 'leitor@example.test', password: PASSWORD })
    expect(login.body.role).toBe('read')
    const cookie = cookieFrom(login)
    expect((await request(app).get('/crm-api/bi/data/systemPulse').set('Cookie', cookie)).status).toBe(200)
    expect((await request(app).get('/central-auth/me').set('Cookie', cookie)).body).toMatchObject({ email: 'leitor@example.test', role: 'read' })
  })

  it('x-crm-read-secret continua funcionando com a flag ligada (legado preservado)', async () => {
    const app = await loadApp()
    expect((await request(app).get('/crm-api/bi/data/systemPulse').set('x-crm-read-secret', READ_SECRET)).status).toBe(200)
  })

  it('senha errada => 401; cookie adulterado/expirado => 401', async () => {
    const app = await loadApp()
    expect((await request(app).post('/central-auth/login').send({ email: 'peter@example.test', password: 'errada' })).status).toBe(401)
    const cookie = cookieFrom(await request(app).post('/central-auth/login').send({ email: 'peter@example.test', password: PASSWORD }))
    const tampered = cookie.replace(/\.([^.]+)$/, '.AAAA')
    expect((await request(app).get('/crm-api/bi/data/systemPulse').set('Cookie', tampered)).status).toBe(401)
    const { createSessionToken } = await import('../../services/centralSession')
    const expired = createSessionToken('peter@example.test', 'admin', Date.now() - 13 * 3600 * 1000).token
    expect((await request(app).get('/central-auth/me').set('Cookie', `central_session=${expired}`)).status).toBe(401)
  })

  it('logout limpa o cookie', async () => {
    const app = await loadApp()
    const res = await request(app).post('/central-auth/logout')
    expect(res.status).toBe(200)
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^central_session=;.*Max-Age=0/)
  })

  it('rate limit: 6ª tentativa é barrada ANTES de verificar a senha (nem a correta passa)', async () => {
    const app = await loadApp()
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/central-auth/login').send({ email: 'leitor@example.test', password: `errada${i}` })).status).toBe(401)
    }
    const blocked = await request(app).post('/central-auth/login').send({ email: 'leitor@example.test', password: PASSWORD })
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('LOGIN_RATE_LIMITED')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect(blocked.headers['set-cookie']).toBeUndefined()
  })

  it('atrás do proxy (hops=1): falhas de um cliente não bloqueiam outro; spoof de XFF não troca de chave', async () => {
    process.env.CENTRAL_TRUSTED_PROXY_HOPS = '1'
    vi.resetModules()
    try {
      const app = await loadApp()
      for (let i = 0; i < 5; i++) {
        // atacante tenta variar o XFF a cada tentativa: a última entrada (do proxy) não muda
        await request(app).post('/central-auth/login').set('X-Forwarded-For', `6.6.6.${i}, 200.0.0.1`).send({ email: 'peter@example.test', password: 'errada' })
      }
      const attacker = await request(app).post('/central-auth/login').set('X-Forwarded-For', '7.7.7.7, 200.0.0.1').send({ email: 'peter@example.test', password: PASSWORD })
      expect(attacker.status).toBe(429)
      // outro usuário, outro IP real: entra normalmente
      const legit = await request(app).post('/central-auth/login').set('X-Forwarded-For', '189.40.50.60').send({ email: 'peter@example.test', password: PASSWORD })
      expect(legit.status).toBe(200)
    } finally {
      delete process.env.CENTRAL_TRUSTED_PROXY_HOPS
    }
  })

  it('login exige JSON (form cross-site simples não dispara login)', async () => {
    const app = await loadApp()
    const res = await request(app).post('/central-auth/login').type('form').send({ email: 'peter@example.test', password: PASSWORD })
    expect(res.status).toBe(415)
  })

  it('CRM_PREVIEW_READONLY: login/logout permitidos, demais escritas continuam 404', async () => {
    process.env.CRM_PREVIEW_READONLY = 'true'
    // preview read-only exige DIRECT_URL; o CI não tem .env — definir aqui
    process.env.DIRECT_URL = process.env.DIRECT_URL || 'postgresql://test:test@localhost:5432/drosa_test'
    vi.resetModules()
    try {
      const app = await loadApp()
      expect((await request(app).post('/central-auth/login').send({ email: 'peter@example.test', password: PASSWORD })).status).toBe(200)
      expect((await request(app).post('/central-auth/logout')).status).toBe(200)
      expect((await request(app).post('/jobs/process-messages')).status).toBe(404)
      expect((await request(app).post('/crm-api/bi/data/systemPulse').set('x-crm-read-secret', READ_SECRET)).status).toBe(404)
    } finally {
      delete process.env.CRM_PREVIEW_READONLY
    }
  })

  it('usuário removido da lista perde a sessão existente', async () => {
    const app = await loadApp()
    const cookie = cookieFrom(await request(app).post('/central-auth/login').send({ email: 'peter@example.test', password: PASSWORD }))
    const users = process.env.CENTRAL_AUTH_USERS
    process.env.CENTRAL_AUTH_USERS = users?.split(',').filter((u) => !u.startsWith('peter@')).join(',')
    vi.resetModules()
    try {
      expect((await request(await loadApp()).get('/central-auth/me').set('Cookie', cookie)).status).toBe(401)
    } finally {
      process.env.CENTRAL_AUTH_USERS = users
    }
  })
})
