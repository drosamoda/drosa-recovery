// Skeletons com o formato do conteúdo que vão substituir (evita "página vazia").
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-7 w-20" />
          <Skeleton className="mt-3 h-6 w-full" />
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="panel p-5">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-2 h-3 w-56" />
      <div className="mt-4 flex items-end gap-2" style={{ height }}>
        {Array.from({ length: 14 }, (_, i) => (
          <Skeleton key={i} className="flex-1" />
        ))}
      </div>
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <Skeleton className="h-3 w-1/3" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 border-b px-4 py-3.5 last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-3 w-1/5" />
          <Skeleton className="hidden h-3 w-1/6 md:block" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export function ProfileSkeleton() {
  return (
    <div className="panel flex items-center gap-4 p-5">
      <Skeleton className="h-14 w-14 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-2 h-3 w-64" />
      </div>
    </div>
  )
}
