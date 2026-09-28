import { describe, expect, it, vi, afterAll } from 'vitest'
import request from 'supertest'

vi.mock('../../config/prisma', () => ({ prisma: {} }))
const load = async () => (await import('../../index')).default

describe('Rota canônica da Central (CENTRAL_REACT_CANONICAL)', () => {
  afterAll(() => {
    delete process.env.CENTRAL_REACT_CANONICAL
    vi.resetModules()
  })

  it('flag desligada (padrão): /crm e /crm-v2 continuam servindo as UIs antigas', async () => {
    vi.resetModules()
    const app = await load()
    for (const p of ['/crm', '/crm-v2', '/crm-legacy', '/crm-v2-legacy']) {
      const r = await request(app).get(p)
      expect(r.status).toBe(200)
      expect(r.headers['content-type']).toMatch(/html/)
    }
  })

  it('flag ligada: /crm e /crm-v2 redirecionam para /crm-next/; legados seguem em URL explícita', async () => {
    process.env.CENTRAL_REACT_CANONICAL = 'true'
    vi.resetModules()
    const app = await load()
    for (const p of ['/crm', '/crm-v2']) {
      const r = await request(app).get(p)
      expect(r.status).toBe(302)
      expect(r.headers.location).toBe('/crm-next/')
    }
    expect((await request(app).get('/crm-legacy')).status).toBe(200)
    expect((await request(app).get('/crm-v2-legacy')).status).toBe(200)
  })
})
