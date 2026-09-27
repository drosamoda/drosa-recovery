import { NavLink } from 'react-router-dom'

// Espelha o NAV atual de public/crm-v2/app.js. So Dashboard tem rota
// funcional nesta rodada (piloto) — as demais ficam desabilitadas de
// proposito ate serem migradas (ver REACT_MIGRATION_BLUEPRINT secao 7).
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', to: '/', enabled: true },
  { key: 'customers', label: 'Cliente 360', to: '/customers', enabled: true },
  { key: 'messages', label: 'Mensagens', to: '/messages', enabled: true },
  { key: 'conversations', label: 'Conversas', to: '/conversations', enabled: true },
  { key: 'recovery', label: 'Recovery', to: '/recovery', enabled: false },
  { key: 'campaigns', label: 'Campanhas & IA', to: '/campaigns', enabled: false },
  { key: 'bi', label: 'BI & Inteligencia', to: '/bi', enabled: false },
  { key: 'health', label: 'Saude', to: '/health', enabled: false },
]

interface SidebarProps {
  // Presente (mobile): sidebar vira drawer controlado por open/onClose.
  // Ausente (desktop, md: e acima): sidebar sempre visivel, estatica.
  mobile?: { open: boolean; onClose: () => void }
}

export function Sidebar({ mobile }: SidebarProps) {
  const content = (
    <>
      <div className="px-5 py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-bordo">D'Rosa</p>
        <p className="text-lg font-semibold text-ink">Central Operacional</p>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) =>
          item.enabled ? (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.to === '/'}
              onClick={() => mobile?.onClose()}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-bordo-soft text-bordo' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ) : (
            <span
              key={item.key}
              title="Ainda nao migrado para o React — ver plano por tela no REACT_MIGRATION_BLUEPRINT"
              className="block cursor-not-allowed rounded-md px-3 py-2 text-sm font-medium text-ink-faint"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
      <div className="border-t border-ink-faint/15 px-5 py-4 text-xs text-ink-faint">
        Piloto React · nao publicado em /crm-v2
      </div>
    </>
  )

  if (!mobile) {
    // Desktop (md: e acima): sidebar estatica, sempre visivel.
    return <aside className="hidden md:flex h-full w-64 flex-col border-r border-ink-faint/15 bg-surface-raised">{content}</aside>
  }

  // Mobile (< md:): drawer deslizante com backdrop, escondido por padrao.
  return (
    <>
      <div
        aria-hidden={!mobile.open}
        onClick={mobile.onClose}
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity md:hidden ${
          mobile.open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navegacao"
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col border-r border-ink-faint/15 bg-surface-raised transition-transform md:hidden ${
          mobile.open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {content}
      </aside>
    </>
  )
}
