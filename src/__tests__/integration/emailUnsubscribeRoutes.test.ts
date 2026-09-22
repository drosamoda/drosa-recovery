import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { emailDb } from '../fixtures/inMemoryEmailDb'

// Valores só deste arquivo de teste (env.ts lê process.env no import).
vi.hoisted(() => {
  process.env.EMAIL_HASH_PEPPER = 'pepper-de-teste-0123456789-abcdefghijklmnop'
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'segredo-de-teste-A-0123456789-abcdefghij'
})

vi.mock('../../config/prisma', async () => {
  const { emailDb: db } = await import('../fixtures/inMemoryEmailDb')
  return { prisma: db.prisma }
})

import app from '../../index'
import {
  resetUnsubscribeInvalidTokenLimiter,
  UNSUBSCRIBE_MAX_INVALID_PER_WINDOW,
} from '../../routes/emailUnsubscribe.routes'
import { hashEmail } from '../../services/emailConsentService'
import { issueUnsubscribeHeaders } from '../../services/emailDispatcher'
import { evaluateEmailRecipientGate } from '../../services/emailSendGate'
import { signUnsubscribeToken } from '../../services/emailUnsubscribeToken'

const EMAIL = 'cliente@example.com'
const HASH = hashEmail(EMAIL)

// Extrai path+query do List-Unsubscribe emitido, exatamente como o e-mail o levaria.
function unsubscribePathFor(email: string, sendId = 'send_1'): string {
  const url = new URL(issueUnsubscribeHeaders(email, { sendId, baseUrl: 'https://crm.exemplo.test' })['List-Unsubscribe'].slice(1, -1))
  return `${url.pathname}${url.search}`
}

beforeEach(() => {
  emailDb.reset()
  resetUnsubscribeInvalidTokenLimiter()
})

describe('GET /unsubscribe/email — confirmação, sem efeito colateral', () => {
  it('mostra a página de confirmação com formulário POST e NÃO altera nada', async () => {
    const res = await request(app).get(unsubscribePathFor(EMAIL))

    expect(res.status).toBe(200)
    expect(res.text).toContain('Confirmar descadastro')
    expect(res.text).toContain('method="post"')
    expect(emailDb.suppressions.size).toBe(0)
    expect(emailDb.events).toHaveLength(0)
  })

  it('envia cabeçalhos de página sensível: sem cache, sem indexação, sem referrer, CSP restritiva', async () => {
    const res = await request(app).get(unsubscribePathFor(EMAIL))
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-robots-tag']).toContain('noindex')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
  })

  it('nunca ecoa o e-mail nem o hash na página', async () => {
    const res = await request(app).get(unsubscribePathFor(EMAIL))
    expect(res.text.toLowerCase()).not.toContain('example.com')
    expect(res.text).not.toContain(HASH)
  })

  it.each([
    ['sem token', '/unsubscribe/email'],
    ['token vazio', '/unsubscribe/email?t='],
    ['token lixo', '/unsubscribe/email?t=lixo'],
    ['token duplicado (array)', '/unsubscribe/email?t=a&t=b'],
  ])('%s → 400 sem tocar no banco', async (_label, path) => {
    const res = await request(app).get(path)
    expect(res.status).toBe(400)
    expect(emailDb.suppressions.size).toBe(0)
  })
})

describe('POST /unsubscribe/email — executa o descadastro', () => {
  it('suprime o e-mail, registra OPT_OUT CRM_UNSUBSCRIBE e responde 200', async () => {
    const res = await request(app).post(unsubscribePathFor(EMAIL, 'send_7'))

    expect(res.status).toBe(200)
    expect(res.text).toContain('Descadastro confirmado')
    expect(emailDb.suppressions.get(HASH)).toMatchObject({ reason: 'UNSUBSCRIBE' })
    expect(emailDb.suppressions.get(HASH)?.evidenceRef).toMatch(/^unsubscribe-link:send_7:\d+$/)
    expect(emailDb.events.map((e) => [e.source, e.status])).toEqual([['CRM_UNSUBSCRIBE', 'OPT_OUT']])
    expect(emailDb.states.get(HASH)?.status).toBe('OPT_OUT')
  })

  it('aceita o One-Click dos clientes de e-mail (corpo "List-Unsubscribe=One-Click", sem página)', async () => {
    const res = await request(app)
      .post(unsubscribePathFor(EMAIL))
      .type('form')
      .send('List-Unsubscribe=One-Click')

    expect(res.status).toBe(200)
    expect(emailDb.suppressions.has(HASH)).toBe(true)
  })

  it('é idempotente: repetir (retentativa do cliente de e-mail) não duplica nada', async () => {
    const path = unsubscribePathFor(EMAIL)
    expect((await request(app).post(path)).status).toBe(200)
    expect((await request(app).post(path)).status).toBe(200)

    expect(emailDb.suppressions.size).toBe(1)
    expect(emailDb.events).toHaveLength(1)
  })

  it('token inválido, adulterado ou de outra chave → 400 e NADA gravado', async () => {
    const valid = unsubscribePathFor(EMAIL)
    const tampered = valid.slice(0, -3) + (valid.endsWith('AAA') ? 'BBB' : 'AAA')
    const foreign = `/unsubscribe/email?t=${signUnsubscribeToken({ emailHash: HASH }, 'chave-alheia-0123456789-abcdefghijklmnop')}`

    for (const path of ['/unsubscribe/email?t=lixo', tampered, foreign]) {
      const res = await request(app).post(path)
      expect(res.status).toBe(400)
    }
    expect(emailDb.suppressions.size).toBe(0)
    expect(emailDb.events).toHaveLength(0)
  })

  it('falha de banco → 500 sem vazar detalhes e sem gravação parcial (rollback)', async () => {
    emailDb.failNextLedgerWrite = true
    const res = await request(app).post(unsubscribePathFor(EMAIL))

    expect(res.status).toBe(500)
    expect(res.text).not.toContain('falha simulada')
    expect(emailDb.suppressions.size).toBe(0)
    expect(emailDb.events).toHaveLength(0)
  })

  it('não loga e-mail, hash nem token', async () => {
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const path = unsubscribePathFor(EMAIL)
    await request(app).post(path)

    const logged = infoSpy.mock.calls.map((call) => call.join(' ')).join('\n')
    infoSpy.mockRestore()
    expect(logged).toContain('descadastro registrado')
    expect(logged.toLowerCase()).not.toContain('example.com')
    expect(logged).not.toContain(HASH)
    expect(logged).not.toContain(path.split('t=')[1])
  })

  it('métodos fora de GET/POST não existem (404)', async () => {
    expect((await request(app).put(unsubscribePathFor(EMAIL))).status).toBe(404)
    expect((await request(app).delete(unsubscribePathFor(EMAIL))).status).toBe(404)
  })
})

describe('ponta a ponta: o descadastro fecha o gate por destinatário', () => {
  it('OPT_IN liberado → descadastra pelo link → gate passa a bloquear (suprimido + sem consentimento)', async () => {
    emailDb.seedConsent(HASH, 'OPT_IN')
    expect(await evaluateEmailRecipientGate(EMAIL)).toMatchObject({ allowed: true, blocks: [], consentState: 'CONFIRMED_OPT_IN' })

    expect((await request(app).post(unsubscribePathFor(EMAIL))).status).toBe(200)

    const after = await evaluateEmailRecipientGate(EMAIL)
    expect(after.allowed).toBe(false)
    expect(after.blocks).toEqual(['EMAIL_SUPPRESSED', 'EMAIL_CONSENT_NOT_OPT_IN'])
    expect(after.consentState).toBe('CONFIRMED_OPT_OUT')
  })

  it('descadastrar outra pessoa não afeta este destinatário', async () => {
    emailDb.seedConsent(HASH, 'OPT_IN')
    await request(app).post(unsubscribePathFor('outra.pessoa@example.com'))

    expect(await evaluateEmailRecipientGate(EMAIL)).toMatchObject({ allowed: true })
  })
})

describe('rate limit: só tentativas INVÁLIDAS contam; token válido nunca é barrado', () => {
  it(`as primeiras ${UNSUBSCRIBE_MAX_INVALID_PER_WINDOW} tentativas inválidas dão 400 e a seguinte dá 429 com Retry-After`, async () => {
    for (let i = 0; i < UNSUBSCRIBE_MAX_INVALID_PER_WINDOW; i++) {
      expect((await request(app).get('/unsubscribe/email?t=lixo')).status).toBe(400)
    }
    const blocked = await request(app).get('/unsubscribe/email?t=lixo')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect(blocked.headers['cache-control']).toBe('no-store')
    expect(emailDb.suppressions.size).toBe(0)
  })

  it('POST inválido também conta e também recebe 429', async () => {
    for (let i = 0; i < UNSUBSCRIBE_MAX_INVALID_PER_WINDOW; i++) await request(app).post('/unsubscribe/email?t=lixo')
    expect((await request(app).post('/unsubscribe/email?t=lixo')).status).toBe(429)
  })

  it('MESMO com o IP já bloqueado, um token VÁLIDO é atendido (GET e POST): descadastro é sempre honrado', async () => {
    for (let i = 0; i <= UNSUBSCRIBE_MAX_INVALID_PER_WINDOW; i++) await request(app).get('/unsubscribe/email?t=lixo')
    expect((await request(app).get('/unsubscribe/email?t=lixo')).status).toBe(429) // bloqueado de fato

    const path = unsubscribePathFor(EMAIL)
    expect((await request(app).get(path)).status).toBe(200)
    expect((await request(app).post(path)).status).toBe(200)
    expect(emailDb.suppressions.has(HASH)).toBe(true)
  })

  it('token válido não gasta o orçamento de falhas (rajada de descadastros legítimos não bloqueia ninguém)', async () => {
    const path = unsubscribePathFor(EMAIL)
    for (let i = 0; i < UNSUBSCRIBE_MAX_INVALID_PER_WINDOW * 3; i++) {
      expect((await request(app).post(path)).status).toBe(200)
    }
    // Ainda dentro do orçamento para um inválido ocasional.
    expect((await request(app).get('/unsubscribe/email?t=lixo')).status).toBe(400)
  })
})

describe('sem EMAIL_UNSUBSCRIBE_SECRET a rota responde 503 e nada é gravado', () => {
  const original = process.env.EMAIL_UNSUBSCRIBE_SECRET

  afterEach(() => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = original
    vi.resetModules()
  })

  it('GET e POST → 503', async () => {
    const path = unsubscribePathFor(EMAIL)
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET
    vi.resetModules()
    const { default: freshApp } = await import('../../index')

    expect((await request(freshApp).get(path)).status).toBe(503)
    expect((await request(freshApp).post(path)).status).toBe(503)
  })

  it('503 é falha nossa e NÃO conta como tentativa inválida (nunca vira 429)', async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET
    vi.resetModules()
    const { default: freshApp } = await import('../../index')

    for (let i = 0; i < UNSUBSCRIBE_MAX_INVALID_PER_WINDOW * 2; i++) {
      expect((await request(freshApp).get('/unsubscribe/email?t=qualquer')).status).toBe(503)
    }
  })
})
