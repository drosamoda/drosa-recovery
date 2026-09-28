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

const BAR: Record<StatusTone, string> = { success: 'bg-status-success', warning: 'bg-status-warning', danger: 'bg-status-danger', neutral: 'bg-status-neutral', info: 'bg-data' }

// Cartão genérico de saúde de uma integração. O tom do estado é decidido pelo
// chamador a partir de EVIDÊNCIA (erro registrado, HMAC inválido...), nunca
// por um boolean de configuração isolado.
export function HealthCard({ title, state, evidence, problem, impact, action }: HealthCardProps) {
  return (
    <article className="panel enter relative overflow-hidden p-4">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${BAR[state.tone]}`} aria-hidden="true" />
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
