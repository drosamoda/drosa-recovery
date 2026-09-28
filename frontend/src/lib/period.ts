import { createContext, useContext } from 'react'

// Filtro global de período. Só é aplicado a fontes que suportam temporalidade:
// /crm-api/dashboard (period=today|7d|30d|custom) e /crm-api/bi/data/* (days).
export type PeriodKey = 'today' | '7d' | '30d' | '90d'

export interface PeriodOption {
  key: PeriodKey
  label: string
  short: string
  days: number
}

export const PERIODS: PeriodOption[] = [
  { key: 'today', label: 'Hoje', short: 'Hoje', days: 1 },
  { key: '7d', label: 'Últimos 7 dias', short: '7d', days: 7 },
  { key: '30d', label: 'Últimos 30 dias', short: '30d', days: 30 },
  { key: '90d', label: 'Últimos 90 dias', short: '90d', days: 90 },
]

export function periodOption(key: PeriodKey): PeriodOption {
  return PERIODS.find((p) => p.key === key) ?? PERIODS[2]
}

/** Query string do /crm-api/dashboard. 90d usa o `custom` que o backend já aceita. */
export function dashboardQuery(key: PeriodKey, now: Date = new Date()): string {
  if (key !== '90d') return `period=${key}`
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - 89)
  return `period=custom&from=${encodeURIComponent(from.toISOString())}`
}

export interface PeriodContextValue {
  period: PeriodKey
  setPeriod: (key: PeriodKey) => void
}

export const PeriodContext = createContext<PeriodContextValue | null>(null)

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext)
  // Fora do provider (testes isolados de uma página): período fixo, sem crash.
  return ctx ?? { period: '7d', setPeriod: () => undefined }
}
