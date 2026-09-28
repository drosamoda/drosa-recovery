import { describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../../index'

describe('/crm-next assets', () => {
  it('asset inexistente (build antigo) responde 404, não o index.html do SPA', async () => {
    const res = await request(app).get('/crm-next/assets/DashboardPage-hashantigo.js')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).not.toMatch(/html/)
  })
})
