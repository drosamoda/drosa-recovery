// Sessão única da Central (cookie httpOnly emitido por /central-auth). O
// frontend nunca vê nem guarda o token: só pergunta "tenho sessão?" e faz
// login/logout. Quando o backend não tem a sessão ligada (/central-auth 404/503),
// o app cai no fluxo legado de segredo de leitura (x-crm-read-secret).

export interface SessionInfo {
  email: string
  role: 'admin' | 'read'
  expiresAt: string
}

export type SessionState = { mode: 'session'; me: SessionInfo } | { mode: 'login-required' } | { mode: 'legacy-only' }

export const AUTH_LOST_EVENT = 'central-auth-lost'

export async function fetchSessionState(): Promise<SessionState> {
  try {
    const res = await fetch('/central-auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    if (res.status === 200) return { mode: 'session', me: (await res.json()) as SessionInfo }
    if (res.status === 401) return { mode: 'login-required' }
    return { mode: 'legacy-only' }
  } catch {
    return { mode: 'legacy-only' }
  }
}

export async function login(email: string, password: string): Promise<{ ok: true; me: SessionInfo } | { ok: false; message: string }> {
  try {
    const res = await fetch('/central-auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const body = (await res.json().catch(() => ({}))) as Partial<SessionInfo> & { error?: string }
    if (res.ok) return { ok: true, me: body as SessionInfo }
    if (res.status === 429) return { ok: false, message: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }
    return { ok: false, message: body.error ?? 'Não foi possível entrar.' }
  } catch {
    return { ok: false, message: 'Falha de rede ao entrar.' }
  }
}

export async function logout(): Promise<void> {
  await fetch('/central-auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
}
