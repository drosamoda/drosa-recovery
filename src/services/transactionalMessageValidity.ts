// Revalidação de pagamento para mensagens TRANSACIONAIS de pagamento pendente.
// A expiração por idade (24h) continua em processMessages (message_expired).
export const PAYMENT_PENDING_TEMPLATES = ['_pix_pendente', 'pedido_boleto_drosa_01', 'boleto_vencendo_drosa_v2'] as const

export function transactionalPaymentReason(
  templateName: string,
  order: { status: string; paymentStatus: string; paymentMethod: string | null },
): 'payment_already_completed' | 'order_cancelled' | null {
  if (!(PAYMENT_PENDING_TEMPLATES as readonly string[]).includes(templateName)) return null
  if (['cancelled', 'canceled', 'refunded'].includes(order.status)) return 'order_cancelled'
  if (order.paymentStatus !== 'pending') return 'payment_already_completed'
  return null
}
