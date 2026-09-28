import type { ReactNode } from 'react'

// Par rotulo/valor generico para paineis de detalhe (usar dentro de <dl>).
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-ink-faint/10 py-2 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  )
}
