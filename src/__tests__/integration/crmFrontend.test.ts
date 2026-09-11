import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../../index'

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
    expect(js).toContain('x-inbox-admin-secret')
    expect(js).not.toMatch(/fetch\([^)]*,\s*\{[^}]*(method:\s*['"](?:POST|PATCH|PUT|DELETE))/s)
  })
})
