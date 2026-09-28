import { useMemo, useState, type ReactNode } from 'react'
import { PeriodContext, type PeriodKey } from '../../lib/period'

export function PeriodProvider({ children, initial = '7d' }: { children: ReactNode; initial?: PeriodKey }) {
  const [period, setPeriod] = useState<PeriodKey>(initial)
  const value = useMemo(() => ({ period, setPeriod }), [period])
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
}