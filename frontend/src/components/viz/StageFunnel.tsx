export interface FunnelStage {
  label: string
  value: number
}

// Funil generico de etapas SUBORDINADAS (cada etapa e subconjunto da
// anterior). Percentual sempre relativo a primeira etapa e NUNCA limitado a
// 100%: se um dado vier fora de ordem, o numero anormal aparece em vez de ser
// escondido. Eventos nao subordinados (ex.: compra posterior) nao entram aqui.
export function StageFunnel({ stages, caption }: { stages: FunnelStage[]; caption?: string }) {
  const base = stages[0]?.value ?? 0
  return (
    <div className="rounded-card border border-ink-faint/15 bg-surface-raised p-4">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stages.map((s, i) => (
          <li key={s.label} className="rounded-md bg-surface-sunken px-3 py-2">
            <p className="text-xs text-ink-muted">{s.label}</p>
            <p className="text-lg font-semibold tabular-nums text-ink">{s.value.toLocaleString('pt-BR')}</p>
            {i > 0 && <p className="text-xs text-ink-faint">{base > 0 ? `${((s.value / base) * 100).toFixed(1)}% de ${stages[0].label.toLowerCase()}` : '—'}</p>}
          </li>
        ))}
      </ol>
      {caption && <p className="mt-3 text-xs text-ink-muted">{caption}</p>}
    </div>
  )
}
