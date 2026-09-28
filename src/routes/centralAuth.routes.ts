import { Router, Request, Response } from 'express'
import {
  clearedSessionCookie,
  createSessionToken,
  isCentralSessionConfigured,
  loginBlockedFor,
  readCookie,
  registerLoginFailure,
  registerLoginSuccess,
  SESSION_COOKIE,
  sessionCookie,
  verifyCredentials,
  verifySessionToken,
  trustedClientIp,
} from '../services/centralSession'
import { env } from '../config/env'
import { logger } from '../config/logger'

// /central-auth — só montado com CENTRAL_SESSION_ENABLED=true (index.ts).
// Login/logout não tocam banco. JSON obrigatório no POST: formulário
// cross-site simples (text/plain, urlencoded) não consegue disparar login.
const router = Router()

function notConfigured(res: Response) {
  return res.status(503).json({ error: 'Sessão da Central não configurada neste ambiente.', code: 'CENTRAL_SESSION_NOT_CONFIGURED' })
}

router.post('/login', async (req: Request, res: Response) => {
  if (!isCentralSessionConfigured()) return notConfigured(res)
  if (!req.is('application/json')) return res.status(415).json({ error: 'Envie JSON.' })
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' })

  const ip = trustedClientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress)
  const retryAfter = loginBlockedFor(ip, email)
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter))
    return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.', code: 'LOGIN_RATE_LIMITED' })
  }

  const role = await verifyCredentials(email, password)
  if (!role) {
    registerLoginFailure(ip, email)
    // Diagnóstico da cadeia de proxy sem PII: só o NÚMERO de entradas.
    const xff = req.headers['x-forwarded-for']
    logger.info('[central-auth] login falhou', { xffEntries: String(Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').filter((s) => s.trim()).length, hops: env.CENTRAL_TRUSTED_PROXY_HOPS })
    return res.status(401).json({ error: 'Credenciais inválidas.' })
  }
  registerLoginSuccess(ip, email)
  const { token, session } = createSessionToken(email.toLowerCase(), role)
  res.setHeader('Set-Cookie', sessionCookie(token, env.CENTRAL_SESSION_TTL_HOURS * 3600))
  res.setHeader('Cache-Control', 'no-store')
  return res.json({ email: session.email, role: session.role, expiresAt: new Date(session.exp * 1000).toISOString() })
})

router.post('/logout', (_req: Request, res: Response) => {
  res.setHeader('Set-Cookie', clearedSessionCookie())
  return res.json({ ok: true })
})

router.get('/me', (req: Request, res: Response) => {
  if (!isCentralSessionConfigured()) return notConfigured(res)
  res.setHeader('Cache-Control', 'no-store')
  const session = verifySessionToken(readCookie(req.headers.cookie, SESSION_COOKIE))
  if (!session) return res.status(401).json({ error: 'Sem sessão.' })
  return res.json({ email: session.email, role: session.role, expiresAt: new Date(session.exp * 1000).toISOString() })
})

export default router
