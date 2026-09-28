import { CircleDot, MessageCircle, ShieldCheck, ShieldOff, ShoppingBag, ShoppingCart, type LucideIcon } from 'lucide-react'
import type { JourneyEvent } from '../../lib/types'

// Só os tipos que a API realmente emite (ver crmJourneyService.ts). Tipo
// desconhecido cai no fallback (mostra o valor cru) em vez de quebrar ou
// inventar um rótulo. WHATSAPP_SENT = disparado (não "enviado").
const EVENT_LABEL: Record<string, string> = {
  ORDER_CREATED: 'Pedido criado',
  ORDER_PAID: 'Pedido pago',
  CHECKOUT: 'Carrinho iniciado',
  CHECKOUT_ABANDONED: 'Carrinho abandonado',
  CHECKOUT_CONVERTED: 'Carrinho com pedido vinculado',
  WHATSAPP_SCHEDULED: 'WhatsApp agendado',
  WHATSAPP_ACCEPTED: 'WhatsApp aceito pela Meta',
  WHATSAPP_SENT: 'WhatsApp disparado',
  WHATSAPP_DELIVERED: 'WhatsApp entregue',
  WHATSAPP_READ: 'WhatsApp lido',
  WHATSAPP_FAILED: 'WhatsApp falhou',
  WHATSAPP_INBOUND: 'Mensagem recebida',
  CONSENT_GRANTED: 'Consentimento concedido',
  CONSENT_REVOKED: 'Consentimento revogado',
  SUPPRESSION: 'Supressao aplicada',
  OPT_OUT: 'Opt-out registrado',
}

function visual(type: string): { icon: LucideIcon; cls: string } {
  if (type.startsWith('ORDER')) return { icon: ShoppingBag, cls: 'text-status-success bg-status-success/10' }
  if (type.startsWith('CHECKOUT')) return { icon: ShoppingCart, cls: 'text-accent bg-accent/10' }
  if (type === 'WHATSAPP_FAILED') return { icon: MessageCircle, cls: 'text-status-danger bg-status-danger/10' }
  if (type.startsWith('WHATSAPP')) return { icon: MessageCircle, cls: 'text-data bg-data/10' }
  if (type === 'CONSENT_GRANTED') return { icon: ShieldCheck, cls: 'text-status-success bg-status-success/10' }
  if (type === 'CONSENT_REVOKED' || type === 'SUPPRESSION' || type === 'OPT_OUT') return { icon: ShieldOff, cls: 'text-status-warning bg-status-warning/10' }
  return { icon: CircleDot, cls: 'text-ink-muted bg-white/5' }
}

export function TimelineEvent({ event }: { event: JourneyEvent }) {
  const label = EVENT_LABEL[event.type] ?? event.type
  const time = event.at ? new Date(event.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sem horario comprovado'
  const { icon: Icon, cls } = visual(event.type)

  return (
    <li className="relative pb-5 pl-11 last:pb-0">
      <span className="absolute bottom-0 left-[15px] top-8 w-px bg-white/10 group-last:hidden" aria-hidden="true" />
      <span className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset ring-white/5 ${cls}`} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-xs tabular-nums text-ink-faint">{time}</p>
      </div>
      {/* Mostra só o que a API realmente devolveu — nunca inventa motivo/causa. */}
      {(event.template || event.related || event.status) && (
        <p className="mt-0.5 text-xs text-ink-muted">
          {[event.template, event.related, event.status].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="text-[11px] text-ink-faint">Fonte: {event.source}</p>
    </li>
  )
}
