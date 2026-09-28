import { StatusBadge } from '../feedback/StatusBadge'
import { lookup, type Label } from '../../lib/labels'

// Badge generico para qualquer codigo tecnico do backend (status, motivo de
// bloqueio, categoria de falha): rotulo amigavel vindo de um mapa puramente
// visual + valor tecnico original preservado no tooltip. Nao reinterpreta.
export function CodeBadge({ code, map }: { code: string | null | undefined; map: Record<string, Label> }) {
  const found = lookup(map, code)
  if (!found || !code) return <span className="text-ink-faint">—</span>
  return (
    <span title={code}>
      <StatusBadge label={found.label} tone={found.tone} />
    </span>
  )
}
