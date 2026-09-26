import { useState } from 'react'
import { clearStoredSecret, getStoredSecret } from '../../lib/auth'

export function Topbar() {
  const [connected, setConnected] = useState(() => Boolean(getStoredSecret()))

  function disconnect() {
    clearStoredSecret()
    setConnected(false)
    window.location.reload()
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-ink-faint/15 bg-surface-raised px-6">
      <div />
      <div className="flex items-center gap-4 text-sm">
        <span className={connected ? 'text-status-success' : 'text-ink-faint'}>
          {connected ? 'Autenticacao configurada' : 'Desconectado'}
        </span>
        {connected && (
          <button type="button" onClick={disconnect} className="text-ink-muted hover:text-ink">
            Desconectar
          </button>
        )}
      </div>
    </header>
  )
}
