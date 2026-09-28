export interface FunnelStage {
  label: string
  value: number
}

// Funil (FunnelChart) de etapas SUBORDINADAS (cada etapa é subconjunto da
// anterior). Percentual sempre relativo à primeira etapa e NUNCA limitado a
// 100%: se um dado vier fora de ordem, o número anormal aparece em vez de ser
// escondido. Eventos não subordinados (ex.: compra posterior) não entram aqui.
export function StageFunnel({ stages, caption, color = 'var(--chart-1)' }: { stages: FunnelStage[]; caption?: string; color?: string }) {
  const base = stages[0]?.value ?? 0
  const max = Math.max(1, ...stages.map((s) => s.value))
  return (
    <div className="panel enter p-4 md:p-5">
      <ol className="space-y-3">
        {stages.map((s, i) => (
          <li key={s.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="truncate text-xs text-ink-muted">{s.label}</p>
              <p className="t-metric text-lg">{s.value.toLocaleString('pt-BR')}</p>
            </div>
            <div className="min-w-0">
              <div className="h-7 overflow-hidden rounded-md" style={{ background: 'rgb(255 255 255 / 0.04)' }}>
                <div
                  className="h-full rounded-md transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.min(100, (s.value / max) * 100)}%`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 55%, transparent))`, opacity: 1 - i * 0.12 }}
                />
              </div>
              {i > 0 && <p className="mt-1 text-xs text-ink-faint">{base > 0 ? `${((s.value / base) * 100).toFixed(1)}% de ${stages[0].label.toLowerCase()}` : '—'}</p>}
            </div>
          </li>
        ))}
      </ol>
      {caption && <p className="mt-4 text-xs text-ink-muted">{caption}</p>}
    </div>
  )
}
