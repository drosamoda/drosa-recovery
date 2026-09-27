import { useState } from 'react'
import { clearStoredSecret, getStoredSecret } from '../../lib/auth'

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const [connected, setConnected] = useState(() => Boolean(getStoredSecret()))

  function disconnect() {
    clearStoredSecret()
    setConnected(false)
    window.location.reload()
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-ink-faint/15 bg-surface-raised px-4 md:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menu de navegacao"
        className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken hover:text-ink md:hidden"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M2.5 5h15M2.5 10h15M2.5 15h15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
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
