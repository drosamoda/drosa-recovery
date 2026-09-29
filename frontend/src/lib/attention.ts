import type { HealthResponse, WebhookEvidence } from './types'
import { formatDateTime } from './labels'

// "PRECISA DE ATENÇÃO" do Dashboard. Só FATOS já expostos por /crm-api/health
// — nenhum threshold novo, nenhuma regra de negócio nova. Cron desligado NÃO
// entra: em produção os jobs rodam pelo Cloud Scheduler e cron interno off é o
// estado esperado (não é alerta).
export type AttentionSeverity = 'danger' | 'warning' | 'neutral'

export interface AttentionItem {
  key: string
  severity: AttentionSeverity
  title: string
  context: string
  action: string
  to: string
}

const RANK: Record<AttentionSeverity, number> = { danger: 0, warning: 1, neutral: 2 }
const n = (v: number) => v.toLocaleString('pt-BR')

function webhookItem(key: string, provider: string, configured: boolean, ev: WebhookEvidence | null): AttentionItem | null {
  if (!configured) return { key, severity: 'warning', title: `${provider}: integração não configurada`, context: 'Credenciais ausentes neste ambiente.', action: 'Ver Saúde', to: '/health' }
  if (!ev) return null
  const problem = ev.error ? 'erro registrado' : !ev.hmacValid ? 'HMAC inválido' : !ev.processed ? 'não processado' : null
  if (!problem) return null
  return { key, severity: 'danger', title: `${provider}: último webhook com ${problem}`, context: `Recebido em ${formatDateTime(ev.createdAt)}.`, action: 'Ver Saúde › Auditoria', to: '/health' }
}

// Fila parada: há pendente cujo agendamento passou há mais de 15 min (o job roda a cada 2 min).
const STALL_MS = 15 * 60_000

export function buildAttentionItems(h: HealthResponse, max = 5, now: Date = new Date()): AttentionItem[] {
  const oldest = h.recoveryEngine.oldestPending ? new Date(h.recoveryEngine.oldestPending).getTime() : null
  const stalled = h.recoveryEngine.pending > 0 && oldest !== null && now.getTime() - oldest > STALL_MS
  const items: (AttentionItem | null)[] = [
    stalled
      ? { key: 'queue-stalled', severity: 'danger', title: 'Fila de WhatsApp parada', context: `${n(h.recoveryEngine.pending)} mensagens pendentes; a mais antiga estava agendada para ${formatDateTime(h.recoveryEngine.oldestPending)}.`, action: 'Ver fila', to: '/messages?status=pending' }
      : null,
    h.recoveryEngine.failed > 0
      ? { key: 'failed', severity: 'danger', title: `${n(h.recoveryEngine.failed)} mensagens com falha`, context: 'Mensagens em status "failed" aguardando revisão.', action: 'Ver mensagens com falha', to: '/messages?status=failed' }
      : null,
    webhookItem('meta', 'Meta (WhatsApp)', h.meta.configured, h.meta.latestEvidence),
    webhookItem('nuvemshop', 'Nuvemshop', h.nuvemshop.configured, h.nuvemshop.latestEvidence),
    h.recoveryEngine.unknown > 0
      ? { key: 'unknown', severity: 'warning', title: `${n(h.recoveryEngine.unknown)} mensagens em estado desconhecido`, context: 'Entrega não confirmada pelo provedor.', action: 'Ver mensagens', to: '/messages?status=unknown' }
      : null,
    h.inboxMirror.failed > 0
      ? { key: 'mirror', severity: 'warning', title: `${n(h.inboxMirror.failed)} mensagens não espelhadas no inbox`, context: 'Conversas podem não mostrar disparos do Recovery.', action: 'Ver Saúde', to: '/health' }
      : null,
    h.recoveryEngine.pending > 0 && !stalled
      ? { key: 'queue', severity: 'neutral', title: `${n(h.recoveryEngine.pending)} mensagens na fila`, context: h.recoveryEngine.oldestPending ? `Mais antiga agendada para ${formatDateTime(h.recoveryEngine.oldestPending)}.` : 'Sem data de agendamento.', action: 'Ver fila', to: '/messages?status=pending' }
      : null,
  ]
  return items.filter((i): i is AttentionItem => i !== null).sort((a, b) => RANK[a.severity] - RANK[b.severity]).slice(0, max)
}
