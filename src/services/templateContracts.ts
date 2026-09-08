import axios from 'axios'
import { env } from '../config/env'

export type TemplateContract = { language: string; category: string; parameters: string[]; body: string; risk?: string }
// Observed from the existing WABA on 2026-09-07. Approval is rechecked before dispatch.
export const templateContracts: Record<string, TemplateContract> = {
  confirmacao_pedido_drosa: { language: 'pt_BR', category: 'UTILITY', parameters: ['name', 'orderNumber'],
    body: "Oi, {{1}}! 😊 Sou a Dani da D'Rosa Moda. Recebemos o seu pedido *{{2}}* com sucesso. Em breve você receberá as atualizações por aqui!" },
  pedido_boleto_drosa_01: { language: 'pt_BR', category: 'UTILITY', parameters: ['name', 'orderNumber'],
    body: 'Oi, {{1}}! Seu pedido *{{2}}* foi recebido e está aguardando a confirmação do pagamento via boleto. O prazo de compensação é de até 3 dias úteis. 💙' },
  carrinho_abandonado_drosa_01: { language: 'pt_BR', category: 'MARKETING', parameters: ['name', 'recoveryUrl'],
    body: "Oi, {{1}}! 😊 Vi que você iniciou um pedido na D'Rosa Moda mas não conseguiu finalizar. Ainda temos os itens reservados! Continue a compra pelo link: {{2}} 🛒",
    risk: 'unsupported_reservation_claim' },
  _pix_pendente: { language: 'pt_BR', category: 'MARKETING', parameters: ['name', 'orderNumber', 'total'],
    body: 'Oi, {{1}}! Pedido nº *{{2}}* no valor de *R$ {{3}}* aguardando pagamento PIX. Complete o pagamento para garantir seus itens! 💙' },
}

export function renderContract(name: string, values: string[]): string | null {
  const contract = templateContracts[name]
  if (!contract || values.length !== contract.parameters.length || values.some(value => !value.trim() || /�|\?\?|{{|}}/.test(value))) return null
  return contract.body.replace(/{{(\d+)}}/g, (_match, index: string) => values[Number(index) - 1])
}

export async function verifyDispatchContract(name: string, language: string, values: string[]) {
  const contract = templateContracts[name]
  if (!contract || contract.language !== language || !renderContract(name, values)) return 'template_data_missing'
  if (contract.risk) return contract.risk
  // No proven marketing-consent source exists in this checkout.
  if (contract.category === 'MARKETING') return 'consent_unproven'
  if (!env.META_WABA_ID) return 'missing_meta_waba_id'
  try {
    const response = await axios.get(`https://graph.facebook.com/${env.META_API_VERSION}/${env.META_WABA_ID}/message_templates`, {
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}` },
      params: { name, fields: 'name,language,status,category,components', limit: 100 }, timeout: env.META_REQUEST_TIMEOUT_MS,
    })
    const actual = response.data?.data?.find((item: { name: string; language: string }) => item.name === name && item.language === language)
    const body = actual?.components?.find((item: { type: string }) => item.type === 'BODY')?.text
    if (actual?.status !== 'APPROVED' || actual.category !== contract.category || body !== contract.body) return 'template_contract_mismatch'
    if (actual.components.some((item: { type: string }) => !['BODY', 'FOOTER'].includes(item.type))) return 'unsupported_template_components'
    return null
  } catch { return 'meta_template_verification_failed' }
}
