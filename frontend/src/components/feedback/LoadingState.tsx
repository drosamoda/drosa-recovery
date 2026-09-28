import { KpiSkeleton, TableSkeleton, ChartSkeleton } from './Skeleton'

export type LoadingVariant = 'table' | 'kpis' | 'chart'

// Loading = skeleton no formato do conteúdo; o rótulo fica para leitores de tela.
export function LoadingState({ label = 'Carregando dados reais...', variant = 'table' }: { label?: string; variant?: LoadingVariant }) {
  return (
    <div role="status" aria-live="polite" className="enter">
      <span className="sr-only">{label}</span>
      {variant === 'kpis' ? <KpiSkeleton /> : variant === 'chart' ? <ChartSkeleton /> : <TableSkeleton />}
    </div>
  )
}
