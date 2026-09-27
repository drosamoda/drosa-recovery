import { useCallback, useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { AuthContext, type Access } from './authContext'
import { clearStoredSecret, getStoredSecret, setStoredSecret } from '../../lib/auth'
import { AUTH_LOST_EVENT, fetchSessionState, login, logout, type SessionInfo } from '../../lib/session'

// Portão de acesso. Ordem:
// 1. segredo de leitura legado já informado nesta aba → entra (rollback intacto);
// 2. cookie de sessão válido (/central-auth/me 200) → entra;
// 3. backend com sessão ligada e sem cookie (401) → formulário de login;
// 4. backend sem sessão (404/503) → formulário legado de segredo.
// Nenhuma credencial vai para localStorage; o segredo legado segue só em
// sessionStorage, como no /crm-v2.

export function ConnectGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>(() => (getStoredSecret() ? { kind: 'legacy' } : { kind: 'checking' }))

  const resolve = useCallback(async () => {
    if (getStoredSecret()) return setAccess({ kind: 'legacy' })
    const state = await fetchSessionState()
    if (state.mode === 'session') setAccess({ kind: 'session', me: state.me })
    else if (state.mode === 'login-required') setAccess({ kind: 'login', allowLegacy: true })
    else setAccess({ kind: 'legacy-form' })
  }, [])

  useEffect(() => {
    if (access.kind === 'checking') void resolve()
  }, [access.kind, resolve])

  useEffect(() => {
    const onLost = () => setAccess({ kind: 'checking' })
    window.addEventListener(AUTH_LOST_EVENT, onLost)
    return () => window.removeEventListener(AUTH_LOST_EVENT, onLost)
  }, [])

  const signOut = useCallback(async () => {
    if (access.kind === 'session') await logout()
    clearStoredSecret()
    setAccess({ kind: 'checking' })
  }, [access.kind])

  if (access.kind === 'legacy' || access.kind === 'session') {
    return <AuthContext.Provider value={{ access, signOut }}>{children}</AuthContext.Provider>
  }
  if (access.kind === 'checking') {
    return <div className="flex h-screen items-center justify-center text-sm text-ink-muted">Verificando acesso…</div>
  }
  if (access.kind === 'login') {
    return <LoginForm onSuccess={(me) => setAccess({ kind: 'session', me })} onUseLegacy={() => setAccess({ kind: 'legacy-form' })} />
  }
  return <LegacySecretForm onConnect={() => setAccess({ kind: 'legacy' })} />
}

function Card({ eyebrow, title, description, children, onSubmit }: { eyebrow: string; title: string; description: string; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-surface px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-card border border-ink-faint/15 bg-surface-raised p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-bordo">{eyebrow}</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">{description}</p>
        {children}
      </form>
    </div>
  )
}

const inputClass = 'mt-3 w-full rounded-md border border-ink-faint/30 px-3 py-2 text-sm outline-none focus:border-bordo'
const buttonClass = 'mt-4 w-full rounded-md bg-bordo px-4 py-2 text-sm font-medium text-white hover:bg-bordo-hover disabled:opacity-60'

function LoginForm({ onSuccess, onUseLegacy }: { onSuccess: (me: SessionInfo) => void; onUseLegacy: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    const result = await login(email.trim(), password)
    setBusy(false)
    setPassword('')
    if (result.ok) onSuccess(result.me)
    else setError(result.message)
  }

  return (
    <Card eyebrow="Central Operacional" title="Entrar" description="Use seu e-mail e senha da Central." onSubmit={submit}>
      <input type="email" autoComplete="username" aria-label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className={inputClass} />
      <input type="password" autoComplete="current-password" aria-label="Senha" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" className={inputClass} />
      {error && (
        <p role="alert" className="mt-3 text-sm text-status-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? 'Entrando…' : 'Entrar'}
      </button>
      <button type="button" onClick={onUseLegacy} className="mt-3 w-full text-xs text-ink-muted hover:text-ink">
        Usar segredo de leitura (acesso legado)
      </button>
    </Card>
  )
}

function LegacySecretForm({ onConnect }: { onConnect: () => void }) {
  const [draft, setDraft] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) return
    setStoredSecret(trimmed)
    onConnect()
  }
  return (
    <Card
      eyebrow="Acesso somente leitura"
      title="Conectar a Central"
      description="Informe o segredo de leitura para consultar os dados operacionais. Este acesso nunca permite enviar mensagens ou alterar registros."
      onSubmit={submit}
    >
      <input type="password" autoComplete="off" aria-label="Segredo de leitura" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Segredo de leitura" className={`${inputClass} mt-5`} />
      <button type="submit" className={buttonClass}>
        Conectar
      </button>
    </Card>
  )
}
