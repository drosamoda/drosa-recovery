import { RotateCw, TriangleAlert } from 'lucide-react'

// Erro de rota (ex.: chunk de versão antiga indisponível após deploy).
export function RouteError() {
  return (
    <div role="alert" className="flex min-h-screen items-center justify-center px-4">
      <div className="panel max-w-md p-8 text-center">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-status-warning/10 text-status-warning">
          <TriangleAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-base font-semibold text-ink">A Central foi atualizada</h1>
        <p className="mt-1 text-sm text-ink-muted">Esta aba estava com uma versão anterior. Recarregue para continuar.</p>
        <button type="button" onClick={() => window.location.reload()} className="btn-primary mt-5">
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Recarregar
        </button>
      </div>
    </div>
  )
}