import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import app from '../../index'
import { env } from '../../config/env'

vi.mock('../../services/crmReadService', () => ({
  crmReadService: { dashboard: vi.fn().mockResolvedValue({ messages: { total: 0 } }) },
}))

describe('CRM operational UI', () => {
  it('serves the public shell while keeping operational data behind authentication', async () => {
    const shell = await request(app).get('/crm')
    const data = await request(app).get('/crm-api/dashboard')

    expect(shell.status).toBe(200)
    expect(shell.text).toContain('CRM WhatsApp')
    expect(shell.text).toContain('/crm-assets/app.js')
    expect(data.status).toBe(401)
  })

  it('contains every required read-only operational area', () => {
    const js = fs.readFileSync(path.join(process.cwd(), 'public/crm/app.js'), 'utf8')
    for (const area of ['dashboard', 'customers', 'conversations', 'messages', 'checkouts', 'pix', 'boleto', 'remarketing', 'automations', 'templates', 'consents', 'health', 'audit']) {
      expect(js).toContain(`${area}:`)
    }
    expect(js).toContain('pageSize')
    expect(js).toContain('x-crm-read-secret')
    expect(js).not.toContain('x-inbox-admin-secret')
    expect(js).toContain("sessionStorage.removeItem('crmSecret')")
    expect(js).not.toContain('localStorage')
    expect(js).not.toMatch(/[?&](?:secret|token|key)=/i)
    expect(js).not.toMatch(/console\.(?:log|info|warn|error)\([^)]*secret/i)
    expect(js).not.toMatch(/fetch\([^)]*,\s*\{[^}]*(method:\s*['"](?:POST|PATCH|PUT|DELETE))/s)
  })

  it.each(['post', 'put', 'patch', 'delete'] as const)('does not expose authenticated %s operations', async method => {
    const response = await request(app)[method]('/crm-api/messages/example')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)

    expect(response.status).toBe(404)
  })

  it('accepts only the dedicated CRM read secret', async () => {
    expect((await request(app).get('/crm-api/dashboard').set('x-crm-read-secret', env.CRM_READ_SECRET)).status).toBe(200)
    expect((await request(app).get('/crm-api/dashboard').set('x-crm-read-secret', env.INBOX_ADMIN_SECRET)).status).toBe(401)
    expect((await request(app).get('/crm-api/dashboard').set('x-crm-read-secret', env.ADMIN_SECRET)).status).toBe(401)
  })

  it('does not grant the CRM read secret access to write-capable route groups', async () => {
    const header = { 'x-crm-read-secret': env.CRM_READ_SECRET }
    expect((await request(app).post('/jobs/process-messages').set(header)).status).toBe(401)
    expect((await request(app).post('/admin/automation-rules').set(header)).status).toBe(401)
    expect((await request(app).post('/inbox/conversations/example/messages').set(header).send({ text: 'test' })).status).toBe(401)
    expect((await request(app).patch('/inbox/conversations/example').set(header).send({ status: 'closed' })).status).toBe(401)
    expect((await request(app).put('/admin/automation-rules/example').set(header)).status).toBe(401)
    expect((await request(app).delete('/admin/automation-rules/example').set(header)).status).toBe(401)
  })
})
