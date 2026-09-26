export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral'

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-status-success/10 text-status-success',
  warning: 'bg-status-warning/10 text-status-warning',
  danger: 'bg-status-danger/10 text-status-danger',
  neutral: 'bg-status-neutral/10 text-status-neutral',
}

// tone e sempre explicito no chamador — nunca derivar cor so de um boolean
// (ex.: cronEnabled=false NAO e automaticamente "danger": pode ser um estado
// esperado. Quem chama decide a semantica, ver REACT_MIGRATION_BLUEPRINT
// secao "NAO PORTAR BUGS").
export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  )
}
