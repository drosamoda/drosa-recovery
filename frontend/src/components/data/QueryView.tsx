import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { LoadingState } from '../feedback/LoadingState'
import { ErrorState } from '../feedback/ErrorState'
import { EmptyState } from '../feedback/EmptyState'
import { Notice } from '../feedback/Notice'
import { ApiError, errorMessage } from '../../lib/api'

// Encapsula loading/erro/vazio de qualquer useQuery. Um recurso que o backend
// declara indisponivel por configuracao (503 com codigo, ex.:
// AI_DATABASE_NOT_CONFIGURED) vira aviso neutro, nao erro vermelho.
export function QueryView<T>({ query, isEmpty, emptyTitle, fallbackError, children }: { query: UseQueryResult<T>; isEmpty?: (data: T) => boolean; emptyTitle: string; fallbackError: string; children: (data: T) => ReactNode }) {
  if (query.isPending) return <LoadingState />
  if (query.isError) {
    const err = query.error
    if (err instanceof ApiError && err.status === 503 && err.code) {
      return (
        <Notice>
          <strong>Recurso indisponível neste ambiente.</strong> {err.message} <span className="text-ink-faint">({err.code})</span>
        </Notice>
      )
    }
    return <ErrorState message={errorMessage(err, fallbackError)} onRetry={() => query.refetch()} />
  }
  if (isEmpty?.(query.data)) return <EmptyState title={emptyTitle} />
  return <>{children(query.data)}</>
}
