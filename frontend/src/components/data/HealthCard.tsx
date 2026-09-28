import { StatusBadge, type StatusTone } from '../feedback/StatusBadge'
import { Field } from './Field'

export interface HealthCardProps {
  title: string
  state: { label: string; tone: StatusTone }
  evidence: string
  problem: string | null
  impact: string
  action: string
}

// Cartao generico de saude de uma integracao. O tom do estado e decidido pelo
// chamador a partir de EVIDENCIA (erro registrado, HMAC invalido...), nunca
// por um boolean de configuracao isolado.
export function HealthCard({ title, state, evidence, problem, impact, action }: HealthCardProps) {
  return (
    <article className="rounded-card border border-ink-faint/15 bg-surface-raised p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <StatusBadge label={state.label} tone={state.tone} />
      </div>
      <dl>
        <Field label="Última evidência">{evidence}</Field>
        <Field label="Problema">{problem ?? 'Nenhum registrado'}</Field>
        <Field label="Impacto">{impact}</Field>
        <Field label="Ação sugerida">{action}</Field>
      </dl>
    </article>
  )
}
