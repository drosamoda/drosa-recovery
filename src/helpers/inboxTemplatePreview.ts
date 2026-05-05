const TEMPLATE_PREVIEW_MAP: Record<string, string> = {
  confirmacao_pedido_drosa: 'Confirmação de pedido enviada',
  pix_pendente_drosa_01: 'Lembrete de Pix pendente enviado',
  pedido_boleto_drosa_01: 'Lembrete de boleto enviado',
  carrinho_abandonado_drosa_01: 'Mensagem de carrinho abandonado enviada',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function getFriendlyTemplatePreview(templateName: string): string {
  return TEMPLATE_PREVIEW_MAP[templateName] ?? templateName
}

export function getTemplatePreviewMap(): Record<string, string> {
  return { ...TEMPLATE_PREVIEW_MAP }
}

export function extractTemplatePreview(payload: unknown): string | null {
  if (!isRecord(payload)) return null

  return (
    extractString(payload.messagePreview) ??
    extractString(payload.preview) ??
    extractString(payload.body) ??
    extractString(payload.text) ??
    (isRecord(payload.template) ? extractString(payload.template.preview) : null) ??
    (isRecord(payload.template) ? extractString(payload.template.body) : null) ??
    null
  )
}
