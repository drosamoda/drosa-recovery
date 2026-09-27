import { StatusBadge } from '../feedback/StatusBadge'

// Flag de runtime exibida de forma SEMANTICA: false nao vira vermelho
// automaticamente (cron desabilitado pode ser o estado esperado). Ausente =
// "Estado desconhecido". Nome tecnico da flag fica no tooltip.
export function FlagBadge({ name, label, value }: { name: string; label: string; value: boolean | null | undefined }) {
  const text = value === true ? `${label} habilitado` : value === false ? `${label} desabilitado` : `${label}: estado desconhecido`
  return (
    <span title={`${name}=${value === undefined || value === null ? 'unknown' : String(value)}`}>
      <StatusBadge label={text} tone="neutral" />
    </span>
  )
}
