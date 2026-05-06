import { interpolate } from './templateMapper'

const TEMPLATE_PREVIEW_MAP: Record<string, string> = {
  confirmacao_pedido_drosa: 'Confirmação de pedido enviada',
  pix_pendente_drosa_01: 'Lembrete de Pix pendente enviado',
  pedido_boleto_drosa_01: 'Lembrete de boleto enviado',
  carrinho_abandonado_drosa_01: 'Mensagem de carrinho abandonado enviada',
}

const ORDER_CONFIRMATION_PREVIEW = `Oi, [nome_cliente]!
Sou a Dani da D'Rosa Moda.

Obrigada pela sua confiança!
Recebemos o seu pedido [numero_pedido] e o pagamento foi confirmado com sucesso.

Seu pedido já está sendo preparado com todo carinho. Assim que ele for postado, você receberá o código de rastreio por e-mail.

Também quero te convidar para o nosso Grupo VIP D'Rosa: por lá, você recebe lançamentos em primeira mão, condições especiais e novidades antes de todo mundo.

Entre aqui:
[link_grupo_vip]

Qualquer dúvida, estou por aqui para te ajudar.
Com carinho,
Dani | D'Rosa Moda`

const CANONICAL_TEMPLATE_PREVIEW_MAP: Record<string, string> = {
  confirmacao_pedido_drosa: ORDER_CONFIRMATION_PREVIEW,
  pagamento_confirmado_drosa_01: ORDER_CONFIRMATION_PREVIEW,
}

export type TemplateRenderContext = {
  templatePreview?: string | null
  templateVariables?: Record<string, string | number | boolean | null | undefined>
}

export type RenderedTemplatePreview = {
  renderedPreview: string
  templateParameters: Record<string, string>
  complete: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeTemplateValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return null
}

function normalizeRenderedPreview(rendered: string): string {
  return rendered.trim().replace(/\n{3,}/g, '\n\n')
}

export function looksLikeCorruptedText(value?: string | null): boolean {
  if (!value) return false
  return (
    /�|ï¿½|Ãƒ|Ã‚|Ã¢|Ã°|Å¸|[?]{2,}/.test(value) ||
    /\bconfiana\b|\bcdigo\b|\bTambm\b|\blanamentos\b|\bcondies\b|\bdvida\b/i.test(value) ||
    /\bpedido j est\b|\bVoc receber\b|\bvoce receber\b|\bprimeira mo\b/i.test(value)
  )
}

function getTemplatePreview(templateName: string, templatePreview: string | null): string | null {
  if (!templatePreview) return CANONICAL_TEMPLATE_PREVIEW_MAP[templateName] ?? null
  if (looksLikeCorruptedText(templatePreview)) {
    return CANONICAL_TEMPLATE_PREVIEW_MAP[templateName] ?? templatePreview
  }
  return templatePreview
}

function buildFallbackPreview(templateName: string, params: Record<string, string>): string {
  return [
    `Template enviado: ${templateName}`,
    'preview completo indisponível',
    `Parâmetros: ${JSON.stringify(params)}`,
  ].join('\n')
}

export function getFriendlyTemplatePreview(templateName: string): string {
  return TEMPLATE_PREVIEW_MAP[templateName] ?? templateName
}

export function getTemplatePreviewMap(): Record<string, string> {
  return { ...TEMPLATE_PREVIEW_MAP }
}

export function renderTemplatePreview(
  templateName: string,
  context: TemplateRenderContext = {}
): RenderedTemplatePreview {
  const templatePreview = getTemplatePreview(templateName, extractString(context.templatePreview))
  const normalizedParams: Record<string, string> = {}

  for (const [key, value] of Object.entries(context.templateVariables ?? {})) {
    const normalizedValue = normalizeTemplateValue(value)
    if (normalizedValue) normalizedParams[key] = normalizedValue
  }

  if (templatePreview) {
    const rendered = normalizeRenderedPreview(interpolate(templatePreview, normalizedParams))
    const unresolved = /\[[\w]+\]/.test(rendered)

    if (!unresolved) {
      return {
        renderedPreview: rendered,
        templateParameters: normalizedParams,
        complete: true,
      }
    }
  }

  return {
    renderedPreview: buildFallbackPreview(templateName, normalizedParams),
    templateParameters: normalizedParams,
    complete: false,
  }
}

export function extractTemplatePreview(payload: unknown): string | null {
  if (!isRecord(payload)) return null

  return (
    extractString(payload.renderedPreview) ??
    extractString(payload.templatePreview) ??
    extractString(payload.previewText) ??
    extractString(payload.preview) ??
    extractString(payload.messagePreview) ??
    extractString(payload.body) ??
    extractString(payload.text) ??
    (isRecord(payload.template) ? extractString(payload.template.preview) : null) ??
    (isRecord(payload.template) ? extractString(payload.template.body) : null) ??
    null
  )
}
