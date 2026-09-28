import { Link, useLocation } from 'react-router-dom'
import { LogOut, Menu, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from './authContext'
import { navForPath } from './nav'
import { useHealth } from '../../lib/queries'
import { systemStatus, type SystemLevel } from '../../lib/systemStatus'

const LEVEL: Record<SystemLevel, { dot: string; text: string }> = {
  ok: { dot: 'bg-status-success', text: 'text-status-success' },
  warning: { dot: 'bg-status-warning', text: 'text-status-warning' },
  critical: { dot: 'bg-status-danger', text: 'text-status-danger' },
  unknown: { dot: 'bg-status-neutral', text: 'text-ink-muted' },
}

export function SystemStatusPill() {
  const { data, isPending } = useHealth()
  const s = systemStatus(data)
  const tone = LEVEL[isPending ? 'unknown' : s.level]
  return (
    <Link
      to="/health"
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:border-white/20"
      style={{ borderColor: 'var(--border-default)', background: 'rgb(var(--c-sunken) / 0.8)' }}
      aria-label={`Estado do sistema: ${isPending ? 'verificando' : s.label}. Abrir Saúde.`}
    >
      <span className="relative flex h-2 w-2">
        {s.level !== 'ok' && !isPending && <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${tone.dot}`} style={{ animation: 'pulse-dot 1.6s ease-in-out infinite' }} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${tone.dot}`} />
      </span>
      <span className={tone.text}>{isPending ? 'Verificando…' : s.label}</span>
    </Link>
  )
}

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { access, signOut } = useAuth()
  const { pathname } = useLocation()
  const page = navForPath(pathname)
  const connected = access.kind === 'session' || access.kind === 'legacy'
  const who = access.kind === 'session' ? access.me.email : 'Segredo de leitura (legado)'
  const role = access.kind === 'session' ? (access.me.role === 'admin' ? 'admin' : 'leitura') : 'leitura'

  return (
    <header
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6"
      style={{ borderColor: 'var(--border-subtle)', background: 'rgb(var(--c-canvas) / 0.72)', backdropFilter: 'blur(var(--blur-glass))' }}
    >
      <button type="button" onClick={onMenuClick} aria-label="Abrir menu de navegacao" className="-ml-1 rounded-md p-2 text-ink-muted hover:bg-white/5 hover:text-ink md:hidden">
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      <nav aria-label="Contexto" className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
        <span className="text-ink-faint">Central</span>
        <span className="text-ink-faint" aria-hidden="true">/</span>
        <span className="truncate font-medium text-ink">{page?.label ?? 'Command Center'}</span>
      </nav>
      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <SystemStatusPill />
        {connected ? (
          <>
            <div className="hidden items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs lg:flex" style={{ borderColor: 'var(--border-default)' }}>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent">
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="max-w-[14rem] truncate text-ink">{who}</span>
              <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {role}
              </span>
            </div>
            <span className="sr-only lg:hidden">{`${who} · ${role}`}</span>
            <button type="button" onClick={() => void signOut()} className="btn px-2.5 text-xs" aria-label="Sair">
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </>
        ) : (
          <span className="text-xs text-ink-faint">Desconectado</span>
        )}
      </div>
    </header>
  )
}
