import type { ReactNode } from 'react'

// Painel lateral generico para detalhe somente-leitura (mensagem, conversa, run).
export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={title} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-surface-raised shadow-xl">
        <div className="flex items-center justify-between border-b border-ink-faint/15 px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md px-2 py-1 text-ink-muted hover:bg-surface-sunken">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </>
  )
}
