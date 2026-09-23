import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '../config/env'

// Token assinado do link de descadastro (List-Unsubscribe / One-Click, RFC 8058).
//
// Formato: `v1.<payload base64url>.<assinatura base64url>`
//   payload   = JSON { h: emailHash, s?: sendId, i: emitido-em (epoch, segundos) }
//   assinatura = HMAC-SHA256(secret, "v1.<payload base64url>")
//
// O token carrega o emailHash (HMAC do e-mail com o pepper) — NUNCA o e-mail:
// quem interceptar o link não descobre o endereço, e a supressão é chaveada
// pelo mesmo hash. Não expira: o descadastro precisa funcionar para sempre
// (um link antigo recusado é infração, não segurança). `i` existe só para
// auditoria. A chave é distinta do pepper; a rotação usa EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS
// para os links já enviados continuarem válidos.

export const EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH = 32
export const UNSUBSCRIBE_TOKEN_VERSION = 'v1'
const MAX_TOKEN_LENGTH = 512
const EMAIL_HASH_FORMAT = /^[0-9a-f]{64}$/
const SEND_ID_FORMAT = /^[A-Za-z0-9_-]{1,64}$/

export const UNSUBSCRIBE_PATH = '/unsubscribe/email'
export const LIST_UNSUBSCRIBE_POST_VALUE = 'List-Unsubscribe=One-Click'

export class EmailUnsubscribeSecretNotConfiguredError extends Error {
  constructor() {
    super(`EMAIL_UNSUBSCRIBE_SECRET ausente ou curto demais (mínimo ${EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH} caracteres): links de descadastro indisponíveis.`)
  }
}

export class InsecureUnsubscribeBaseUrlError extends Error {
  constructor() {
    super('A URL base do descadastro precisa ser https (One-Click, RFC 8058).')
  }
}

export interface UnsubscribeTokenPayload {
  emailHash: string
  sendId: string | null
  issuedAt: Date
}

export type UnsubscribeTokenVerification =
  | { ok: true; payload: UnsubscribeTokenPayload }
  | { ok: false; reason: 'SECRET_NOT_CONFIGURED' | 'MALFORMED' | 'BAD_SIGNATURE' }

function toBase64Url(input: Buffer): string {
  return input.toString('base64url')
}

function sign(secret: string, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput).digest()
}

// Chaves aceitas na verificação: a principal e (durante rotação) a anterior.
// Só entram as que atendem ao tamanho mínimo.
export function unsubscribeVerificationSecrets(
  current: string = env.EMAIL_UNSUBSCRIBE_SECRET,
  previous: string = env.EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS,
): string[] {
  return [current, previous].filter((secret) => secret.length >= EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH)
}

export function signUnsubscribeToken(
  payload: { emailHash: string; sendId?: string | null; issuedAt?: Date },
  secret: string = env.EMAIL_UNSUBSCRIBE_SECRET,
): string {
  if (secret.length < EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH) throw new EmailUnsubscribeSecretNotConfiguredError()
  if (!EMAIL_HASH_FORMAT.test(payload.emailHash)) throw new Error('emailHash inválido para o token de descadastro.')
  const sendId = payload.sendId ?? null
  if (sendId !== null && !SEND_ID_FORMAT.test(sendId)) throw new Error('sendId inválido para o token de descadastro.')

  const body: { h: string; s?: string; i: number } = {
    h: payload.emailHash,
    i: Math.floor((payload.issuedAt ?? new Date()).getTime() / 1000),
  }
  if (sendId !== null) body.s = sendId
  const encoded = toBase64Url(Buffer.from(JSON.stringify(body), 'utf8'))
  const signingInput = `${UNSUBSCRIBE_TOKEN_VERSION}.${encoded}`
  return `${signingInput}.${toBase64Url(sign(secret, signingInput))}`
}

function parsePayload(encoded: string): UnsubscribeTokenPayload | null {
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const { h, s, i } = record
  if (typeof h !== 'string' || !EMAIL_HASH_FORMAT.test(h)) return null
  if (s !== undefined && (typeof s !== 'string' || !SEND_ID_FORMAT.test(s))) return null
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) return null
  return { emailHash: h, sendId: typeof s === 'string' ? s : null, issuedAt: new Date(i * 1000) }
}

export function verifyUnsubscribeToken(
  token: unknown,
  secrets: readonly string[] = unsubscribeVerificationSecrets(),
): UnsubscribeTokenVerification {
  if (secrets.length === 0) return { ok: false, reason: 'SECRET_NOT_CONFIGURED' }
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'MALFORMED' }
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== UNSUBSCRIBE_TOKEN_VERSION) return { ok: false, reason: 'MALFORMED' }
  const [version, encoded, signature] = parts
  const provided = Buffer.from(signature, 'base64url')
  const signingInput = `${version}.${encoded}`

  // Compara contra TODAS as chaves aceitas (sem curto-circuito por chave) e em
  // tempo constante; o tamanho é checado antes porque timingSafeEqual exige
  // buffers de mesmo comprimento.
  let matched = false
  for (const secret of secrets) {
    const expected = sign(secret, signingInput)
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) matched = true
  }
  if (!matched) return { ok: false, reason: 'BAD_SIGNATURE' }

  const payload = parsePayload(encoded)
  if (payload === null) return { ok: false, reason: 'MALFORMED' }
  return { ok: true, payload }
}

// One-Click exige HTTPS. A URL base normalmente é APP_BASE_URL.
export function buildUnsubscribeUrl(token: string, baseUrl: string = env.APP_BASE_URL): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed.toLowerCase().startsWith('https://')) throw new InsecureUnsubscribeBaseUrlError()
  return `${trimmed}${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(token)}`
}

// Cabeçalhos exigidos por Gmail/Yahoo para remetentes em massa (RFC 8058).
export function buildListUnsubscribeHeaders(unsubscribeUrl: string): Record<string, string> {
  if (!unsubscribeUrl.toLowerCase().startsWith('https://')) throw new InsecureUnsubscribeBaseUrlError()
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_POST_VALUE,
  }
}
