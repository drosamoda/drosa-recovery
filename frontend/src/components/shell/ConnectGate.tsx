import { useState, type ReactNode, type FormEvent } from 'react'
import { getStoredSecret, setStoredSecret } from '../../lib/auth'

// Equivalente ao modal "ACESSO SOMENTE LEITURA" de public/crm-v2/index.html.
// So guarda em sessionStorage, nunca persiste entre abas/dispositivos.
export function ConnectGate({ children }: { children: ReactNode }) {
  const [secret, setSecret] = useState(() => getStoredSecret())
  const [draft, setDraft] = useState('')

  function handleConnect(e: FormEvent) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) return
    setStoredSecret(trimmed)
    setSecret(trimmed)
  }

  if (secret) return <>{children}</>

  return (
    <div className="flex h-screen items-center justify-center bg-surface px-4">
      <form onSubmit={handleConnect} className="w-full max-w-sm rounded-card border border-ink-faint/15 bg-surface-raised p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-bordo">Acesso somente leitura</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Conectar a Central</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Informe o segredo de leitura para consultar os dados operacionais. Este acesso nunca permite enviar mensagens ou alterar registros.
        </p>
        <input
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Segredo de leitura"
          className="mt-5 w-full rounded-md border border-ink-faint/30 px-3 py-2 text-sm outline-none focus:border-bordo"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-bordo px-4 py-2 text-sm font-medium text-white hover:bg-bordo-hover"
        >
          Conectar
        </button>
      </form>
    </div>
  )
}
