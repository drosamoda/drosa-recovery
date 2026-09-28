export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-status-success/10 text-status-success ring-status-success/25',
  warning: 'bg-status-warning/10 text-status-warning ring-status-warning/25',
  danger: 'bg-status-danger/10 text-status-danger ring-status-danger/25',
  neutral: 'bg-status-neutral/10 text-ink-muted ring-status-neutral/20',
  info: 'bg-data/10 text-data ring-data/25',
}

// tone é sempre explícito no chamador — nunca derivar cor só de um boolean
// (ex.: cronEnabled=false NÃO é automaticamente "danger": pode ser um estado
// esperado). O ponto + texto garantem que a cor não é o único significado.
export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-left text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  )
}
