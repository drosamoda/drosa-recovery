import type { ReactNode } from 'react'

// Aviso informativo neutro (ex.: "somente leitura", "indisponivel na API atual").
// Nao e erro: nao usa vermelho.
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  const cls = tone === 'warning' ? 'border-status-warning/30 bg-status-warning/5 text-ink' : 'border-ink-faint/20 bg-surface-sunken text-ink-muted'
  return <div className={`mb-4 rounded-card border px-4 py-3 text-sm ${cls}`}>{children}</div>
}
