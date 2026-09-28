import type { ReactNode } from 'react'

// Par rotulo/valor generico para paineis de detalhe (usar dentro de <dl>).
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-2 text-sm last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}
