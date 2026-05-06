import { describe, expect, it } from 'vitest'
import request from 'supertest'
import fs from 'fs'
import path from 'path'
import app from '../../index'

describe('GET /inbox', () => {
  it('serve a tela web da inbox sem exigir segredo no carregamento inicial', async () => {
    const res = await request(app).get('/inbox')

    expect(res.status).toBe(200)
    expect(res.text).toContain('Inbox WhatsApp DRosa')
    expect(res.text).toContain('/inbox-assets/app.js')
  })

  it('mantem a lista de mensagens como o container scrollavel real', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'public/inbox/index.html'), 'utf8')
    const css = fs.readFileSync(path.join(process.cwd(), 'public/inbox/app.css'), 'utf8')
    const js = fs.readFileSync(path.join(process.cwd(), 'public/inbox/app.js'), 'utf8')

    expect(html).toContain('id="messageList"')
    expect(html).toContain('class="message-list"')
    expect(html).toContain('data-messages-list')

    expect(css).toMatch(/body\s*{[^}]*max-height:\s*100vh;[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\.app-shell\s*{[^}]*height:\s*100vh;[^}]*max-height:\s*100vh;[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\.chat-area\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\.chat-view\s*{[^}]*flex:\s*1[^;]*;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\.chat-body\s*{[^}]*flex:\s*1[^;]*;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s)
    expect(css).toMatch(/\.message-list\s*{[^}]*flex:\s*1[^;]*;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s)
    expect(css).toMatch(/\.reply-box\s*{[^}]*position:\s*relative;[^}]*flex-shrink:\s*0;/s)
    expect(css).not.toMatch(/\.reply-box\s*{[^}]*(position:\s*absolute|position:\s*fixed)/s)

    expect(js).toContain('function getMessagesContainer()')
    expect(js).toContain('function scrollMessagesToBottom(force = false)')
    expect(js).toContain("console.log('[inbox scroll]'")
  })
})
