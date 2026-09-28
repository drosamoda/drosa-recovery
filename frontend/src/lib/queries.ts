import { useQuery } from '@tanstack/react-query'
import { apiGet } from './api'
import { dashboardQuery, type PeriodKey } from './period'
import type { DashboardResponse, HealthResponse } from './types'

// Fonte canônica por dado: uma query key por recurso, compartilhada entre
// páginas via cache do React Query (Topbar, Dashboard, Saúde e Action Center
// leem o MESMO ['health']).

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: ({ signal }) => apiGet<HealthResponse>('health', signal), staleTime: 30_000 })
}

export function useDashboard(period: PeriodKey) {
  return useQuery({
    queryKey: ['dashboard', period],
    queryFn: ({ signal }) => apiGet<DashboardResponse>(`dashboard?${dashboardQuery(period)}`, signal),
  })
}

export function useBiDataset<T>(dataset: string, days: number) {
  return useQuery({
    queryKey: ['bi', dataset, days],
    queryFn: ({ signal }) => apiGet<{ data: T[]; days: number }>(`bi/data/${dataset}?days=${days}`, signal),
    staleTime: 60_000,
  })
}

export interface SystemPulseRow {
  last_order_at: string | null
  last_webhook_nuvemshop_at: string | null
  last_webhook_meta_at: string | null
  pending_messages: number
  processing_messages: number
  delivery_unknown_messages: number
}

export interface WebhookSummaryRow {
  provider: string
  topic: string | null
  events: number
  processed: number
  invalid_hmac: number
  errors: number
  last_day: string
}
