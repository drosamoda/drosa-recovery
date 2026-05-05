import { describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '../../index'

describe('GET /inbox', () => {
  it('serve a tela web da inbox sem exigir segredo no carregamento inicial', async () => {
    const res = await request(app).get('/inbox')

    expect(res.status).toBe(200)
    expect(res.text).toContain('Inbox WhatsApp DRosa')
    expect(res.text).toContain('/inbox-assets/app.js')
  })
})
