import type { ReactNode } from 'react'
import { Info, TriangleAlert } from 'lucide-react'

// Aviso informativo neutro (ex.: "somente leitura", "indisponível na API atual").
// Não é erro: não usa vermelho.
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  const warning = tone === 'warning'
  const Icon = warning ? TriangleAlert : Info
  return (
    <div
      className={`mb-4 flex gap-3 rounded-card border px-4 py-3 text-sm ${warning ? 'bg-status-warning/5 text-ink' : 'bg-white/[0.02] text-ink-muted'}`}
      style={{ borderColor: warning ? 'rgb(var(--c-warning) / 0.3)' : 'var(--border-default)' }}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${warning ? 'text-status-warning' : 'text-data'}`} aria-hidden="true" />
      <div className="min-w-0 [&_code]:rounded [&_code]:bg-white/5 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]">{children}</div>
    </div>
  )
}
