import { NavLink } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { NAV_GROUPS } from './nav'
import { BrandMark } from './BrandMark'
import { useHealth } from '../../lib/queries'

interface SidebarProps {
  // Presente (mobile): sidebar vira drawer controlado por open/onClose.
  // Ausente (desktop, md: e acima): sidebar sempre visível, estática.
  mobile?: { open: boolean; onClose: () => void }
  collapsed?: boolean
  onToggleCollapsed?: () => void
}

// Badges só com dado real de /crm-api/health (mesmo cache do Topbar/Dashboard).
function useBadges(): Record<string, { count: number; tone: 'danger' | 'warning' }> {
  const { data } = useHealth()
  if (!data) return {}
  const out: Record<string, { count: number; tone: 'danger' | 'warning' }> = {}
  if (data.recoveryEngine.failed > 0) out.messages = { count: data.recoveryEngine.failed, tone: 'danger' }
  const hookProblems = [data.meta, data.nuvemshop].filter((p) => !p.configured || p.latestEvidence?.error || (p.latestEvidence && !p.latestEvidence.hmacValid)).length
  if (hookProblems) out.health = { count: hookProblems, tone: 'danger' }
  else if (data.inboxMirror.failed > 0 || data.recoveryEngine.unknown > 0) out.health = { count: (data.inboxMirror.failed > 0 ? 1 : 0) + (data.recoveryEngine.unknown > 0 ? 1 : 0), tone: 'warning' }
  return out
}

export function Sidebar({ mobile, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const badges = useBadges()
  const compact = collapsed && !mobile
  const content = (
    <>
      <div className={`flex h-16 items-center ${compact ? 'justify-center px-2' : 'justify-between px-4'}`}>
        <BrandMark compact={compact} />
        {mobile && (
          <button type="button" onClick={mobile.onClose} aria-label="Fechar menu" className="rounded-md p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <nav aria-label="Navegação principal" className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {compact ? <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden="true" /> : <p className="t-section mb-1.5 px-2">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const badge = badges[item.key]
                return (
                  <li key={item.key}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={() => mobile?.onClose()}
                      title={compact ? item.label : undefined}
                      aria-label={compact ? item.label : undefined}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors duration-150 ${compact ? 'justify-center px-2' : 'px-2.5'} ${
                          isActive ? 'bg-accent/10 text-ink' : 'text-ink-muted hover:bg-white/[0.04] hover:text-ink'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent shadow-glow" aria-hidden="true" />}
                          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent' : 'text-ink-faint group-hover:text-ink-muted'}`} aria-hidden="true" />
                          {!compact && <span className="flex-1 truncate">{item.label}</span>}
                          {badge && (
                            <span
                              className={
                                compact
                                  ? `absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${badge.tone === 'danger' ? 'bg-status-danger' : 'bg-status-warning'}`
                                  : `min-w-[1.25rem] rounded-full px-1.5 text-center text-[10px] font-semibold tabular-nums ${badge.tone === 'danger' ? 'bg-status-danger/15 text-status-danger' : 'bg-status-warning/15 text-status-warning'}`
                              }
                              aria-label={`${badge.count} ${badge.tone === 'danger' ? 'críticos' : 'avisos'}`}
                            >
                              {!compact && badge.count.toLocaleString('pt-BR')}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      {!mobile && onToggleCollapsed && (
        <div className="border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-ink-faint hover:bg-white/[0.04] hover:text-ink ${compact ? 'justify-center' : ''}`}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
            {!compact && 'Recolher'}
          </button>
        </div>
      )}
    </>
  )

  const surface = { borderColor: 'var(--border-subtle)', background: 'rgb(var(--c-surface) / 0.85)', backdropFilter: 'blur(var(--blur-glass))' }

  if (!mobile) {
    return (
      <aside className={`hidden h-full shrink-0 flex-col border-r transition-[width] duration-200 ease-out md:flex ${collapsed ? 'w-[4.25rem]' : 'w-60'}`} style={surface}>
        {content}
      </aside>
    )
  }

  // Mobile (< md:): drawer deslizante com backdrop, escondido por padrão.
  return (
    <>
      <div
        aria-hidden={!mobile.open}
        onClick={mobile.onClose}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity md:hidden ${mobile.open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegacao"
        aria-hidden={!mobile.open}
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col border-r transition-transform duration-200 ease-out md:hidden ${mobile.open ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ ...surface, background: 'rgb(var(--c-surface))' }}
      >
        {content}
      </aside>
    </>
  )
}
