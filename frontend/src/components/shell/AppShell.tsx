import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const COLLAPSE_KEY = 'central.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        // preferência visual apenas; sem storage segue em memória
      }
      return !c
    })

  return (
    <div className="flex h-screen overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface-overlay focus:px-3 focus:py-2 focus:text-sm">
        Pular para o conteúdo
      </a>
      {/* Desktop: sidebar estática (recolhível). Mobile: drawer controlado por drawerOpen. */}
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggle} />
      <Sidebar mobile={{ open: drawerOpen, onClose: () => setDrawerOpen(false) }} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setDrawerOpen(true)} />
        <main id="main" className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-8 md:py-7">{children}</div>
        </main>
      </div>
    </div>
  )
}
