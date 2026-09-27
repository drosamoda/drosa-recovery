import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import bcrypt from 'bcryptjs'
import { env } from '../config/env'
import { createFailureRateLimiter } from '../helpers/failureRateLimiter'

// Sessão única da Central (Fase G). Coexiste com x-crm-read-secret — não o
// substitui nesta rodada. Formato de usuários idêntico ao DASHBOARD_AUTH_USERS
// do app BI ("email:hashBcrypt,..."), para migrar a lista sem recriar senhas.
// Nenhuma credencial vai para localStorage: o browser só recebe um cookie
// httpOnly com um token assinado (HMAC-SHA256), sem dado sensível.

export const SESSION_COOKIE = 'central_session'
const MIN_SECRET_LENGTH = 32

export type CentralRole = 'admin' | 'read'

export interface CentralSession {
  email: string
  role: CentralRole
  exp: number
}

export function isCentralSessionConfigured(): boolean {
  return env.CENTRAL_SESSION_SECRET.length >= MIN_SECRET_LENGTH && parseUsers().length > 0
}

function parseUsers(): { email: string; hash: string }[] {
  return env.CENTRAL_AUTH_USERS.split(',')
    .map((entry) => entry.trim())
    .map((entry) => {
      const i = entry.indexOf(':')
      return i > 0 ? { email: entry.slice(0, i).trim().toLowerCase(), hash: entry.slice(i + 1).trim() } : null
    })
    .filter((u): u is { email: string; hash: string } => Boolean(u && u.email && u.hash))
}

function roleFor(email: string): CentralRole {
  const admins = env.CENTRAL_ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  return admins.includes(email) ? 'admin' : 'read'
}

// Hash fixo válido para gastar o mesmo custo de bcrypt quando o e-mail não
// existe (não revela, por tempo de resposta, quais e-mails são usuários).
let dummyHash: string | null = null

export async function verifyCredentials(email: string, password: string): Promise<CentralRole | null> {
  const normalized = email.trim().toLowerCase()
  const user = parseUsers().find((u) => u.email === normalized)
  dummyHash ??= await bcrypt.hash(randomBytes(16).toString('hex'), 10)
  const ok = await bcrypt.compare(password, user?.hash ?? dummyHash).catch(() => false)
  return user && ok ? roleFor(normalized) : null
}

const sign = (data: string) => createHmac('sha256', env.CENTRAL_SESSION_SECRET).update(data).digest('base64url')

export function createSessionToken(email: string, role: CentralRole, now = Date.now()): { token: string; session: CentralSession } {
  const session: CentralSession = { email, role, exp: Math.floor(now / 1000) + env.CENTRAL_SESSION_TTL_HOURS * 3600 }
  const body = Buffer.from(JSON.stringify({ ...session, sid: randomBytes(8).toString('hex') })).toString('base64url')
  return { token: `v1.${body}.${sign(`v1.${body}`)}`, session }
}

export function verifySessionToken(token: string | undefined, now = Date.now()): CentralSession | null {
  if (!token || !isCentralSessionConfigured()) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const expected = Buffer.from(sign(`v1.${parts[1]}`))
  const given = Buffer.from(parts[2])
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Partial<CentralSession>
    if (typeof payload.email !== 'string' || (payload.role !== 'admin' && payload.role !== 'read') || typeof payload.exp !== 'number') return null
    if (payload.exp <= Math.floor(now / 1000)) return null
    // usuário removido da lista perde a sessão na próxima requisição
    if (!parseUsers().some((u) => u.email === payload.email)) return null
    return { email: payload.email, role: payload.role, exp: payload.exp }
  } catch {
    return null
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`
}

export function clearedSessionCookie(): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
}

// Rate limit de login: mesmo helper do descadastro (failureRateLimiter), em
// memória por instância. 5 falhas por IP+e-mail ou 20 por IP em 15 min =>
// 429 ANTES de verificar a senha (um palpite certo durante o bloqueio também
// é barrado). Atrás de balanceador sem `trust proxy`, req.ip é o do proxy e o
// teto por IP vira global — ver PREVIEW_READINESS.
const WINDOW_MS = 15 * 60 * 1000
const byEmail = createFailureRateLimiter({ maxFailures: 5, windowMs: WINDOW_MS })
const byIp = createFailureRateLimiter({ maxFailures: 20, windowMs: WINDOW_MS })
const emailKey = (ip: string, email: string) => `${ip}|${email.trim().toLowerCase()}`

export function loginBlockedFor(ip: string, email: string): number {
  const a = byIp.check(ip), b = byEmail.check(emailKey(ip, email))
  return a.limited || b.limited ? Math.max(a.retryAfterSeconds, b.retryAfterSeconds) : 0
}

export function registerLoginFailure(ip: string, email: string): void {
  byIp.hit(ip)
  byEmail.hit(emailKey(ip, email))
}

export function registerLoginSuccess(ip: string, email: string): void {
  byEmail.clear(emailKey(ip, email))
}

export function resetLoginLimiter(): void {
  byEmail.reset()
  byIp.reset()
}
