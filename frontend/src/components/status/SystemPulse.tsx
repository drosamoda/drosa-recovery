import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, BarChart3, Cable, Mail, MessageCircle, Server, ShoppingBag, Workflow, type LucideIcon } from 'lucide-react'
import { apiGet } from '../../lib/api'
import { formatDateTime } from '../../lib/labels'
import { useBiDataset, useHealth, type SystemPulseRow } from '../../lib/queries'
import { systemStatus } from '../../lib/systemStatus'
import type { EmailLibrary, WebhookEvidence } from '../../lib/types'

export type PulseLevel = 'ok' | 'warning' | 'critical' | 'unknown'

interface Tile {
  key: string
  label: string
  icon: LucideIcon
  level: PulseLevel
  value: string
  detail: string
  to: string
}

const DOT: Record<PulseLevel, string> = { ok: 'bg-status-success', warning: 'bg-status-warning', critical: 'bg-status-danger', unknown: 'bg-status-neutral' }
const WORD: Record<PulseLevel, string> = { ok: 'OK', warning: 'Atenção', critical: 'Crítico', unknown: 'Sem dado' }

function webhookTile(key: string, label: string, icon: LucideIcon, configured: boolean | undefined, ev: WebhookEvidence | null | undefined): Omit<Tile, 'to'> {
  if (configured === undefined) return { key, label, icon, level: 'unknown', value: '—', detail: 'Sem leitura de /health' }
  if (!configured) return { key, label, icon, level: 'warning', value: 'Não configurado', detail: 'Credenciais ausentes' }
  if (!ev) return { key, label, icon, level: 'unknown', value: 'Sem evidência', detail: 'Nenhum webhook recente' }
  const problem = ev.error ? 'Erro no último evento' : !ev.hmacValid ? 'HMAC inválido' : !ev.processed ? 'Não processado' : null
  return { key, label, icon, level: problem ? 'critical' : 'ok', value: problem ?? 'Recebendo', detail: `Último: ${formatDateTime(ev.createdAt)}` }
}

// Faixa 1 do Command Center: estado de cada subsistema a partir de /health,
// bi_system_pulse e do gate de e-mail. Nenhum estado inferido sem evidência.
export function SystemPulse({ apiOk }: { apiOk: boolean | null }) {
  const health = useHealth()
  const pulse = useBiDataset<SystemPulseRow>('systemPulse', 1)
  const email = useQuery({ queryKey: ['email', 'library'], queryFn: ({ signal }) => apiGet<EmailLibrary>('email/campaign-library', signal), staleTime: 300_000 })
  const h = health.data
  const s = systemStatus(h)
  const p = pulse.data?.data[0]

  const tiles: Tile[] = [
    { key: 'system', label: 'Sistema', icon: Activity, level: health.isError ? 'unknown' : s.level === 'critical' ? 'critical' : s.level === 'warning' ? 'warning' : s.level === 'ok' ? 'ok' : 'unknown', value: health.isError ? 'Sem leitura' : s.label, detail: 'Consolidado do Action Center', to: '/health' },
    { key: 'api', label: 'APIs', icon: Server, level: apiOk === null ? 'unknown' : apiOk ? 'ok' : 'critical', value: apiOk === null ? 'Verificando' : apiOk ? 'Respondendo' : 'Falhando', detail: '/crm-api (leitura)', to: '/health' },
    { ...webhookTile('whatsapp', 'WhatsApp', MessageCircle, h?.meta.configured, h?.meta.latestEvidence), to: '/health' },
    { ...webhookTile('webhooks', 'Nuvemshop', ShoppingBag, h?.nuvemshop.configured, h?.nuvemshop.latestEvidence), to: '/health' },
    h
      ? {
          key: 'jobs',
          label: 'Jobs / fila',
          icon: Workflow,
          level: h.recoveryEngine.failed > 0 ? 'critical' : h.recoveryEngine.unknown > 0 ? 'warning' : 'ok',
          value: `${h.recoveryEngine.pending.toLocaleString('pt-BR')} na fila`,
          detail: `${h.recoveryEngine.processing} processando · ${h.recoveryEngine.failed} falhas`,
          to: '/messages?status=pending',
        }
      : { key: 'jobs', label: 'Jobs / fila', icon: Workflow, level: 'unknown', value: '—', detail: 'Sem leitura de /health', to: '/health' },
    {
      key: 'email',
      label: 'E-mail',
      icon: Mail,
      level: email.data ? (email.data.sendGate.allowed ? 'ok' : 'warning') : 'unknown',
      value: email.data ? (email.data.sendGate.allowed ? 'Gate liberado' : 'Envio bloqueado') : email.isError ? 'Sem leitura' : '—',
      detail: email.data ? (email.data.sendGate.allowed ? 'Gate de envio aberto' : `Gate: ${email.data.sendGate.missing.length} pendências`) : 'Biblioteca de campanhas',
      to: '/campaigns',
    },
    {
      key: 'bi',
      label: 'BI',
      icon: BarChart3,
      level: pulse.isError ? 'critical' : p ? 'ok' : 'unknown',
      value: pulse.isError ? 'Views indisponíveis' : p ? 'Views ativas' : '—',
      detail: p?.last_order_at ? `Último pedido: ${formatDateTime(p.last_order_at)}` : 'bi_system_pulse',
      to: '/bi',
    },
    h
      ? {
          key: 'mirror',
          label: 'Inbox',
          icon: Cable,
          level: h.inboxMirror.failed > 0 ? 'warning' : 'ok',
          value: h.inboxMirror.failed > 0 ? `${h.inboxMirror.failed} não espelhadas` : 'Espelhando',
          detail: h.inboxMirror.latestSuccess ? `Último: ${formatDateTime(h.inboxMirror.latestSuccess)}` : 'Sem espelhamento registrado',
          to: '/conversations',
        }
      : { key: 'mirror', label: 'Inbox', icon: Cable, level: 'unknown', value: '—', detail: 'Sem leitura de /health', to: '/health' },
  ]

  return (
    <section aria-label="System Pulse" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {tiles.map((t) => {
        const Icon = t.icon
        return (
          <Link key={t.key} to={t.to} className="panel panel-interactive enter group min-w-0 px-3 py-2.5" title={t.detail}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t.label}</span>
              </span>
              <span className="relative flex h-2 w-2 shrink-0">
                {t.level === 'critical' && <span className={`absolute inline-flex h-full w-full rounded-full ${DOT[t.level]}`} style={{ animation: 'pulse-dot 1.6s ease-in-out infinite' }} />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${DOT[t.level]}`} />
              </span>
            </div>
            <p className="mt-1 truncate text-sm font-medium text-ink">{t.value}</p>
            <p className="sr-only">{`${WORD[t.level]}. ${t.detail}`}</p>
          </Link>
        )
      })}
    </section>
  )
}
