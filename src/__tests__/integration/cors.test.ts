import { describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../../index'
import { env } from '../../config/env'

describe('CORS', () => {
  it('permite a origem configurada para a aplicacao', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://drosa-recovery.example.test')

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://drosa-recovery.example.test'
    )
  })

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

  // Reproduzido ao vivo: o Vercel Preview dá um subdomínio novo a cada deploy
  // (nunca listável em ALLOWED_ORIGINS de antemão), e o navegador manda o
  // header Origin em POST mesmo quando é o crm-v2 chamando o próprio host —
  // GET nunca manda, por isso esse bloqueio nunca tinha sido exercitado antes
  // da primeira escrita real do frontend (Campanhas & IA).
  it('permite Origin que é o próprio host da requisição, mesmo fora de ALLOWED_ORIGINS (same-origin real)', async () => {
    const res = await request(app)
      .post('/crm-api/ai/campaigns')
      .set('Host', 'drosa-recovery-99ysbkobq-drosamoda-6608s-projects.vercel.app')
      .set('Origin', 'https://drosa-recovery-99ysbkobq-drosamoda-6608s-projects.vercel.app')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .send({ opportunityId: 'x' })

    expect(res.status).not.toBe(403)
  })

  it('continua bloqueando uma Origin de host diferente do requisitado (não é um bypass geral)', async () => {
    const res = await request(app)
      .post('/crm-api/ai/campaigns')
      .set('Host', 'drosa-recovery-99ysbkobq-drosamoda-6608s-projects.vercel.app')
      .set('Origin', 'https://attacker.example.com')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)
      .send({ opportunityId: 'x' })

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ error: 'CORS bloqueado' })
  })
})
