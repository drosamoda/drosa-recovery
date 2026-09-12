import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import app from '../../index'
import { env } from '../../config/env'

// Mesmo mock hermético já usado por crmFrontend.test.ts — evita depender de um Postgres real
// disponível no ambiente de teste. crmReadService/crm.routes.ts não são tocados por esta missão.
vi.mock('../../services/crmReadService', () => ({
  crmReadService: { dashboard: vi.fn().mockResolvedValue({ messages: { total: 0 } }) },
}))

describe('CRM v2 operational UI (radical visual redesign, same read-only /crm-api)', () => {
  it('serves the public shell while keeping operational data behind authentication', async () => {
    const shell = await request(app).get('/crm-v2')
    const data = await request(app).get('/crm-api/dashboard')

    expect(shell.status).toBe(200)
    expect(shell.text).toContain("D'Rosa CRM")
    expect(shell.text).toContain('/crm-v2-assets/app.js')
    expect(data.status).toBe(401)
  })

  it('the original /crm shell is untouched and still served in parallel', async () => {
    const shell = await request(app).get('/crm')
    expect(shell.status).toBe(200)
    expect(shell.text).toContain('/crm-assets/app.js')
  })

  it('contains every required read-only operational area', () => {
    const js = fs.readFileSync(path.join(process.cwd(), 'public/crm-v2/app.js'), 'utf8')
    for (const area of ['dashboard', 'customers', 'conversations', 'messages', 'checkouts', 'pix', 'boleto', 'remarketing', 'automations', 'templates', 'consents', 'health', 'audit']) {
      expect(js).toContain(`${area}:`)
    }
    expect(js).toContain('pageSize')
    expect(js).toContain('x-crm-read-secret')
    expect(js).not.toContain('x-inbox-admin-secret')
    expect(js).toContain("sessionStorage.removeItem('crmV2Secret')")
    expect(js).not.toContain('localStorage')
    expect(js).not.toMatch(/[?&](?:secret|token|key)=/i)
    expect(js).not.toMatch(/console\.(?:log|info|warn|error)\([^)]*secret/i)
    expect(js).not.toMatch(/fetch\([^)]*,\s*\{[^}]*(method:\s*['"](?:POST|PATCH|PUT|DELETE))/s)
  })

  it('never renders raw JSON in the main UI — only inside a collapsed "dados técnicos" section', () => {
    const js = fs.readFileSync(path.join(process.cwd(), 'public/crm-v2/app.js'), 'utf8')
    expect(js).not.toMatch(/JSON\.stringify/)
  })

  it.each(['post', 'put', 'patch', 'delete'] as const)('does not expose authenticated %s operations', async method => {
    const response = await request(app)[method]('/crm-api/messages/example')
      .set('x-crm-read-secret', env.CRM_READ_SECRET)

    expect(response.status).toBe(404)
  })

  it('accepts only the dedicated CRM read secret (same middleware as /crm, untouched)', async () => {
    expect((await request(app).get('/crm-api/dashboard').set('x-crm-read-secret', env.CRM_READ_SECRET)).status).toBe(200)
    expect((await request(app).get('/crm-api/dashboard').set('x-crm-read-secret', env.INBOX_ADMIN_SECRET)).status).toBe(401)
    expect((await request(app).get('/crm-api/dashboard').set('x-crm-read-secret', env.ADMIN_SECRET)).status).toBe(401)
  })
})
