// Métrica compacta (grades densas). Para KPIs principais usar KpiCard.
export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="panel enter min-w-0 p-4">
      <p className="t-label truncate">{label}</p>
      <p className="t-metric mt-2 text-xl md:text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}
