import { AlertTriangle, RotateCw } from 'lucide-react'

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="panel enter flex flex-col items-center p-8 text-center" style={{ borderColor: 'rgb(var(--c-danger) / 0.3)' }}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-status-danger/10 text-status-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-3 text-sm font-semibold text-status-danger">Dados indisponiveis</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn mt-4">
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          Tentar de novo
        </button>
      )}
    </div>
  )
}
