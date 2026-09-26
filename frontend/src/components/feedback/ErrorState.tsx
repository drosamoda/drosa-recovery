export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-card border border-status-danger/30 bg-status-danger/5 p-6 text-center">
      <p className="text-sm font-medium text-status-danger">Dados indisponiveis</p>
      <p className="mt-1 text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-status-danger/40 px-3 py-1.5 text-sm text-status-danger hover:bg-status-danger/10"
        >
          Tentar de novo
        </button>
      )}
    </div>
  )
}
