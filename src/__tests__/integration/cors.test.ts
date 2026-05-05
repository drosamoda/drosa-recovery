import { describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../../index'

describe('CORS', () => {
  it('permite a origem principal do Railway', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://drosa-recovery-production.up.railway.app')

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://drosa-recovery-production.up.railway.app'
    )
  })

  it('permite preflight da inbox com x-inbox-admin-secret', async () => {
    const res = await request(app)
      .options('/inbox/conversations')
      .set('Origin', 'https://drosa-recovery-production-bcfa.up.railway.app')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type,x-inbox-admin-secret')

    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://drosa-recovery-production-bcfa.up.railway.app'
    )
    expect(res.headers['access-control-allow-headers']).toContain('x-inbox-admin-secret')
  })

  it('bloqueia origem externa com erro JSON controlado', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://example.com')

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({
      error: 'CORS bloqueado',
    })
  })
})
