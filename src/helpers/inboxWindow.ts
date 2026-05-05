const WHATSAPP_CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000

export const WHATSAPP_24H_WINDOW_ERROR =
  'Fora da janela de 24h. Use um template aprovado para retomar a conversa.'

export function isWithinWhatsappCustomerCareWindow(
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastInboundAt) return false

  const inboundDate = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt)
  if (Number.isNaN(inboundDate.getTime())) return false

  const diff = now.getTime() - inboundDate.getTime()
  return diff >= 0 && diff <= WHATSAPP_CUSTOMER_CARE_WINDOW_MS
}
