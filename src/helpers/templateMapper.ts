import { env } from '../config/env'

export type TemplateVariables = Record<string, string>

// Mapeia variáveis internas para valores do payload
export function buildOrderConfirmationVars(data: {
  customerName: string
  orderNumber: string
}): TemplateVariables {
  return {
    nome_cliente: firstName(data.customerName),
    numero_pedido: data.orderNumber,
  }
}

export function buildAbandonedCartVars(data: {
  customerName: string
  abandonedCheckoutUrl: string
}): TemplateVariables {
  const suffix = extractUrlSuffix(data.abandonedCheckoutUrl, env.CHECKOUT_BASE_URL)
  return {
    nome_cliente: firstName(data.customerName),
    link_checkout: suffix ?? data.abandonedCheckoutUrl,
  }
}

// Extrai o sufixo de uma URL relativa a uma base.
// Retorna null se a URL não pertencer à base — o caller deve tratar como skipped.
export function extractUrlSuffix(fullUrl: string, baseUrl: string): string | null {
  if (!fullUrl.startsWith(baseUrl)) return null
  return fullUrl.slice(baseUrl.length)
}

// Retorna apenas o primeiro nome
function firstName(fullName: string): string {
  return fullName.trim().split(' ')[0] ?? fullName
}

// Substitui placeholders no formato [variavel] por valores do map
export function interpolate(template: string, vars: TemplateVariables): string {
  return template.replace(/\[(\w+)\]/g, (_, key) => vars[key] ?? `[${key}]`)
}
