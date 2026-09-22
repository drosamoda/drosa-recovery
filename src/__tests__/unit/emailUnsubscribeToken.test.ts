import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  buildListUnsubscribeHeaders,
  buildUnsubscribeUrl,
  EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH,
  EmailUnsubscribeSecretNotConfiguredError,
  InsecureUnsubscribeBaseUrlError,
  signUnsubscribeToken,
  UNSUBSCRIBE_PATH,
  unsubscribeVerificationSecrets,
  verifyUnsubscribeToken,
} from '../../services/emailUnsubscribeToken'

const SECRET = 'segredo-de-teste-A-0123456789-abcdefghij'
const OTHER_SECRET = 'segredo-de-teste-B-0123456789-abcdefghij'
const HASH = 'ab'.repeat(32)
const OTHER_HASH = 'cd'.repeat(32)
const ISSUED_AT = new Date('2026-09-22T10:00:00.000Z')

function craft(payload: unknown, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const input = `v1.${encoded}`
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`
}

describe('signUnsubscribeToken / verifyUnsubscribeToken', () => {
  it('faz o round-trip do hash, do sendId e da data de emissão (em segundos)', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, sendId: 'send_123', issuedAt: ISSUED_AT }, SECRET)
    const result = verifyUnsubscribeToken(token, [SECRET])
    expect(result).toEqual({ ok: true, payload: { emailHash: HASH, sendId: 'send_123', issuedAt: ISSUED_AT } })
  })

  it('sendId é opcional', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, issuedAt: ISSUED_AT }, SECRET)
    const result = verifyUnsubscribeToken(token, [SECRET])
    expect(result.ok && result.payload.sendId).toBeNull()
  })

  it('tem o formato v1.<payload>.<assinatura> e não carrega e-mail em claro', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, sendId: 'abc', issuedAt: ISSUED_AT }, SECRET)
    const [version, payload, signature] = token.split('.')
    expect(version).toBe('v1')
    expect(signature.length).toBeGreaterThan(0)
    expect(Buffer.from(payload, 'base64url').toString('utf8')).not.toContain('@')
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/) // seguro em URL sem escape
  })

  it('não expira: um token emitido há anos continua válido (o descadastro precisa funcionar para sempre)', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, issuedAt: new Date('2020-01-01T00:00:00Z') }, SECRET)
    expect(verifyUnsubscribeToken(token, [SECRET]).ok).toBe(true)
  })

  it('rejeita assinatura de outra chave', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, issuedAt: ISSUED_AT }, OTHER_SECRET)
    expect(verifyUnsubscribeToken(token, [SECRET])).toEqual({ ok: false, reason: 'BAD_SIGNATURE' })
  })

  it('rejeita payload adulterado mantendo a assinatura original', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, issuedAt: ISSUED_AT }, SECRET)
    const forged = signUnsubscribeToken({ emailHash: OTHER_HASH, issuedAt: ISSUED_AT }, SECRET)
    const [version, , signature] = token.split('.')
    const [, forgedPayload] = forged.split('.')
    expect(verifyUnsubscribeToken(`${version}.${forgedPayload}.${signature}`, [SECRET])).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    })
  })

  it('rejeita assinatura truncada ou de tamanho errado sem lançar exceção', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, issuedAt: ISSUED_AT }, SECRET)
    const [version, payload, signature] = token.split('.')
    expect(verifyUnsubscribeToken(`${version}.${payload}.${signature.slice(0, 10)}`, [SECRET])).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    })
    expect(verifyUnsubscribeToken(`${version}.${payload}.`, [SECRET])).toEqual({ ok: false, reason: 'BAD_SIGNATURE' })
  })

  it.each([
    ['vazio', ''],
    ['sem pontos', 'abc'],
    ['versão desconhecida', 'v2.abc.def'],
    ['partes demais', 'v1.a.b.c'],
    ['undefined', undefined],
    ['número', 42],
    ['objeto', { t: 'x' }],
    ['longo demais', `v1.${'a'.repeat(600)}.x`],
  ])('rejeita token malformado: %s', (_label, token) => {
    expect(verifyUnsubscribeToken(token, [SECRET])).toEqual({ ok: false, reason: 'MALFORMED' })
  })

  it('assinatura válida mas payload inválido é MALFORMED (não vira supressão de hash lixo)', () => {
    expect(verifyUnsubscribeToken(craft({ h: 'nao-e-hash', i: 1 }, SECRET), [SECRET])).toEqual({ ok: false, reason: 'MALFORMED' })
    expect(verifyUnsubscribeToken(craft({ h: HASH, i: 'x' }, SECRET), [SECRET])).toEqual({ ok: false, reason: 'MALFORMED' })
    expect(verifyUnsubscribeToken(craft({ h: HASH, i: 1, s: 'tem espaço' }, SECRET), [SECRET])).toEqual({
      ok: false,
      reason: 'MALFORMED',
    })
    expect(verifyUnsubscribeToken(craft([HASH], SECRET), [SECRET])).toEqual({ ok: false, reason: 'MALFORMED' })
  })

  it('sem chave configurada devolve SECRET_NOT_CONFIGURED (fail-closed)', () => {
    const token = signUnsubscribeToken({ emailHash: HASH, issuedAt: ISSUED_AT }, SECRET)
    expect(verifyUnsubscribeToken(token, [])).toEqual({ ok: false, reason: 'SECRET_NOT_CONFIGURED' })
  })

  it('recusa emitir token com chave curta, hash inválido ou sendId inválido', () => {
    expect(() => signUnsubscribeToken({ emailHash: HASH }, 'curta')).toThrow(EmailUnsubscribeSecretNotConfiguredError)
    expect(() => signUnsubscribeToken({ emailHash: '' }, SECRET)).toThrow()
    expect(() => signUnsubscribeToken({ emailHash: 'zz'.repeat(32) }, SECRET)).toThrow()
    expect(() => signUnsubscribeToken({ emailHash: HASH, sendId: 'a b' }, SECRET)).toThrow()
    expect(() => signUnsubscribeToken({ emailHash: HASH, sendId: 'x'.repeat(65) }, SECRET)).toThrow()
  })
})

describe('rotação de chave', () => {
  it('link emitido com a chave antiga continua válido enquanto ela estiver em PREVIOUS', () => {
    const oldToken = signUnsubscribeToken({ emailHash: HASH, issuedAt: ISSUED_AT }, OTHER_SECRET)
    expect(verifyUnsubscribeToken(oldToken, [SECRET, OTHER_SECRET]).ok).toBe(true)
    expect(verifyUnsubscribeToken(oldToken, [SECRET])).toEqual({ ok: false, reason: 'BAD_SIGNATURE' })
  })

  it('unsubscribeVerificationSecrets descarta chaves curtas e vazias', () => {
    expect(unsubscribeVerificationSecrets(SECRET, OTHER_SECRET)).toEqual([SECRET, OTHER_SECRET])
    expect(unsubscribeVerificationSecrets(SECRET, '')).toEqual([SECRET])
    expect(unsubscribeVerificationSecrets('', '')).toEqual([])
    expect(unsubscribeVerificationSecrets('curta', 'x'.repeat(EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH - 1))).toEqual([])
  })
})

describe('buildUnsubscribeUrl / buildListUnsubscribeHeaders', () => {
  it('monta a URL https com o caminho público e o token', () => {
    const url = buildUnsubscribeUrl('v1.abc.def', 'https://crm.exemplo.test/')
    expect(url).toBe(`https://crm.exemplo.test${UNSUBSCRIBE_PATH}?t=v1.abc.def`)
  })

  it('recusa URL base que não seja https (One-Click exige HTTPS)', () => {
    expect(() => buildUnsubscribeUrl('t', 'http://crm.exemplo.test')).toThrow(InsecureUnsubscribeBaseUrlError)
    expect(() => buildUnsubscribeUrl('t', '')).toThrow(InsecureUnsubscribeBaseUrlError)
    expect(() => buildListUnsubscribeHeaders('http://x.test/u')).toThrow(InsecureUnsubscribeBaseUrlError)
  })

  it('gera os dois cabeçalhos exigidos (RFC 8058)', () => {
    expect(buildListUnsubscribeHeaders('https://crm.exemplo.test/unsubscribe/email?t=x')).toEqual({
      'List-Unsubscribe': '<https://crm.exemplo.test/unsubscribe/email?t=x>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
  })
})
