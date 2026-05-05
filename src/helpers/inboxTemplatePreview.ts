import { interpolate } from './templateMapper'

const TEMPLATE_PREVIEW_MAP: Record<string, string> = {
  confirmacao_pedido_drosa: 'Confirmação de pedido enviada',
  pix_pendente_drosa_01: 'Lembrete de Pix pendente enviado',
  pedido_boleto_drosa_01: 'Lembrete de boleto enviado',
  carrinho_abandonado_drosa_01: 'Mensagem de carrinho abandonado enviada',
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
  const templatePreview = extractString(context.templatePreview)
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
