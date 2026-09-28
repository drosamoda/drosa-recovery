// Marca D'Rosa Command Center (monograma + wordmark). Cores via tokens.
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-glow"
        style={{ background: 'linear-gradient(135deg, rgb(var(--c-accent)), rgb(var(--c-accent) / 0.55) 60%, rgb(var(--c-data) / 0.7))' }}
        aria-hidden="true"
      >
        D’R
      </span>
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">D’Rosa</span>
          <span className="block truncate text-sm font-semibold text-ink">Command Center</span>
        </span>
      )}
    </div>
  )
}
