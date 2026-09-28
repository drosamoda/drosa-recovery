import { buildAttentionItems } from './attention'
import type { HealthResponse } from './types'

// Estado geral derivado SÓ dos itens do Action Center (mesmos fatos de /health).
export type SystemLevel = 'ok' | 'warning' | 'critical' | 'unknown'

export interface SystemStatus {
  level: SystemLevel
  label: string
  critical: number
  warnings: number
}

export function systemStatus(h: HealthResponse | undefined): SystemStatus {
  if (!h) return { level: 'unknown', label: 'Status indisponível', critical: 0, warnings: 0 }
  const items = buildAttentionItems(h, 99)
  const critical = items.filter((i) => i.severity === 'danger').length
  const warnings = items.filter((i) => i.severity === 'warning').length
  if (critical) return { level: 'critical', label: `${critical} ${critical === 1 ? 'alerta crítico' : 'alertas críticos'}`, critical, warnings }
  if (warnings) return { level: 'warning', label: `${warnings} ${warnings === 1 ? 'ponto de atenção' : 'pontos de atenção'}`, critical, warnings }
  return { level: 'ok', label: 'Operação normal', critical, warnings }
}
