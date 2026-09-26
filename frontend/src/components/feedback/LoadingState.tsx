export function LoadingState({ label = 'Carregando dados reais...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-ink-muted">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-bordo border-t-transparent" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
