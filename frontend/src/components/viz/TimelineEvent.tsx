import type { JourneyEvent } from '../../lib/types'

// So os tipos que a API realmente emite (ver crmJourneyService.ts). Tipo
// desconhecido cai no fallback (mostra o valor cru) em vez de quebrar ou
// inventar um rotulo.
const EVENT_LABEL: Record<string, string> = {
  ORDER_CREATED: 'Pedido criado',
  ORDER_PAID: 'Pedido pago',
  CHECKOUT: 'Carrinho iniciado',
  CHECKOUT_ABANDONED: 'Carrinho abandonado',
  CHECKOUT_CONVERTED: 'Carrinho convertido',
  WHATSAPP_SCHEDULED: 'WhatsApp agendado',
  WHATSAPP_ACCEPTED: 'WhatsApp aceito',
  WHATSAPP_SENT: 'WhatsApp enviado',
  WHATSAPP_DELIVERED: 'WhatsApp entregue',
  WHATSAPP_READ: 'WhatsApp lido',
  WHATSAPP_FAILED: 'WhatsApp falhou',
  WHATSAPP_INBOUND: 'Mensagem recebida',
  CONSENT_GRANTED: 'Consentimento concedido',
  CONSENT_REVOKED: 'Consentimento revogado',
  SUPPRESSION: 'Supressao aplicada',
  OPT_OUT: 'Opt-out registrado',
}

export function TimelineEvent({ event }: { event: JourneyEvent }) {
  const label = EVENT_LABEL[event.type] ?? event.type
  const time = event.at ? new Date(event.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sem horario comprovado'

  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-bordo" />
      <p className="text-xs text-ink-faint">{time}</p>
      <p className="text-sm font-medium text-ink">{label}</p>
      {/* Mostra so o que a API realmente devolveu — nunca inventa motivo/causa. */}
      {(event.template || event.related || event.status) && (
        <p className="text-xs text-ink-muted">
          {[event.template, event.related, event.status].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="text-xs text-ink-faint">Fonte: {event.source}</p>
    </li>
  )
}
