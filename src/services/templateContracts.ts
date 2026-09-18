import axios from 'axios'
import { env } from '../config/env'

export type TemplateContract = { language: string; category: string; parameters: string[]; body: string; risk?: string }
// Contratos locais exatos. A Meta continua sendo a fonte final: status, categoria e body são revalidados antes de cada dispatch.
export const templateContracts: Record<string, TemplateContract> = {
  confirmacao_pedido_drosa: { language: 'pt_BR', category: 'UTILITY', parameters: ['name', 'orderNumber'],
    body: "Oi, {{1}}! 😊 Sou a Dani da D'Rosa Moda. Recebemos o seu pedido *{{2}}* com sucesso. Em breve você receberá as atualizações por aqui!" },
  pedido_boleto_drosa_01: { language: 'pt_BR', category: 'UTILITY', parameters: ['name', 'orderNumber'],
    body: 'Oi, {{1}}! Seu pedido *{{2}}* foi recebido e está aguardando a confirmação do pagamento via boleto. O prazo de compensação é de até 3 dias úteis. 💙' },
  carrinho_abandonado_drosa_01: { language: 'pt_BR', category: 'MARKETING', parameters: ['name', 'recoveryUrl'],
    body: "Oi, {{1}}! 😊 Vi que você iniciou um pedido na D'Rosa Moda mas não conseguiu finalizar. Ainda temos os itens reservados! Continue a compra pelo link: {{2}} 🛒",
    risk: 'unsupported_reservation_claim' },
  carrinho_abandonado_drosa_v2: { language: 'pt_BR', category: 'MARKETING', parameters: ['name', 'recoveryUrl'],
    body: `Oi, {{1}}! 😊
Você deixou algumas peças no carrinho da D’Rosa Moda.

Se quiser continuar sua compra, acesse:
{{2}}

Se precisar de ajuda com tamanho, tecido ou combinação, me chama por aqui.` },
  _pix_pendente: { language: 'pt_BR', category: 'MARKETING', parameters: ['name', 'orderNumber', 'total'],
    body: 'Oi, {{1}}! Pedido nº *{{2}}* no valor de *R$ {{3}}* aguardando pagamento PIX. Complete o pagamento para garantir seus itens! 💙' },
  boleto_vencendo_drosa_v2: { language: 'pt_BR', category: 'UTILITY', parameters: ['name', 'orderNumber'],
    body: 'Oi, {{1}}! O boleto do pedido *{{2}}* está próximo do vencimento. Se você já realizou o pagamento, desconsidere esta mensagem. Se precisar de ajuda, me chama por aqui. 💙' },
  pagamento_confirmado_drosa_01: { language: 'pt_BR', category: 'MARKETING', parameters: ['name', 'orderNumber', 'vipLink'],
    body: `Oi, {{1}}! 😊
Sou a Dani da D'Rosa Moda.

Obrigada pela confiança 💕
Recebemos o seu pedido *{{2}}* e o pagamento foi confirmado com sucesso.

Seu pedido já está sendo preparado com todo carinho e, assim que for postado, o *código de rastreio será enviado por e-mail* 📧📦

💖 Aproveitando, quero te convidar para o nosso *GRUPO VIP*:
Lá você recebe lançamentos em primeira mão e preços especiais!

👉 *Entre aqui:* {{3}}

Qualquer dúvida, estou por aqui 😊` },
  pagamento_recusado_drosa_01: { language: 'pt_BR', category: 'UTILITY', parameters: ['name', 'orderNumber'],
    body: `Oi, {{1}}! 😊
Sou a Dani da D'Rosa Moda.

Identificamos que o pagamento do pedido *{{2}}* não foi aprovado pelo cartão.
Isso pode acontecer por alguns motivos da própria operadora 💕

Para facilitar, *podemos gerar um link de pagamento pelo Mercado Pago*, seguro e rápido 🔐
Por lá, você também pode *parcelar em até 4x sem juros*.

Se quiser, me avise que já te envio o link 😊` },
  pix_cancelado_drosa_01: { language: 'pt_BR', category: 'MARKETING', parameters: ['name', 'orderNumber', 'vipLink'],
    body: `Oi, {{1}}! 😊
Sou a Dani da D'Rosa Moda.

Passando para te informar que o pedido *{{2}}* foi cancelado conforme status do sistema.

Se desejar, posso te ajudar a realizar um novo pedido 💕

💖 Aproveitando, quero te convidar para o nosso GRUPO VIP:
Lá você recebe lançamentos em primeira mão e preços especiais!

👉 Entre aqui: {{3}}

Qualquer dúvida, estou por aqui 😊` },
  cliente_recente_drosa_v1: { language: 'pt_BR', category: 'MARKETING', parameters: ['name'],
    body: "Oi, {{1}}! 😊 Que bom ter você como cliente da D'Rosa Moda! Se precisar de ajuda para escolher a próxima peça, é só chamar por aqui." },
  cliente_vip_drosa_v1: { language: 'pt_BR', category: 'MARKETING', parameters: ['name'],
    body: "Oi, {{1}}! 😊 Você é uma cliente especial da D'Rosa Moda. Estamos sempre por aqui se precisar de ajuda para escolher looks ou tirar dúvidas sobre pedidos." },
  cliente_inativo_drosa_v1: { language: 'pt_BR', category: 'MARKETING', parameters: ['name'],
    body: "Oi, {{1}}! 😊 Faz um tempinho que você não aparece por aqui na D'Rosa Moda. Estamos com peças novas na loja — se quiser dar uma olhada ou tirar alguma dúvida, é só chamar." },
  atendimento_retomada_drosa_v1: { language: 'pt_BR', category: 'MARKETING', parameters: ['name'],
    body: "Oi, {{1}}! 😊 Vi que você já conversou com a gente por aqui. Ficou alguma dúvida sobre tamanhos, cores ou formas de pagamento? Estou à disposição para ajudar." },
}

export function isMarketingTemplate(name: string): boolean {
  return templateContracts[name]?.category === 'MARKETING'
}

export function renderContract(name: string, values: string[]): string | null {
  const contract = templateContracts[name]
  if (!contract || values.length !== contract.parameters.length || values.some(value => !value.trim() || /�|\?\?|{{|}}/.test(value))) return null
  return contract.body.replace(/{{(\d+)}}/g, (_match, index: string) => values[Number(index) - 1])
}

export async function verifyMetaTemplateContract(name: string, language: string): Promise<string | null> {
  const contract = templateContracts[name]
  if (!contract || contract.language !== language) return 'template_contract_mismatch'
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
  } catch {
    return 'meta_template_verification_failed'
  }
}

export async function verifyDispatchContract(
  name: string,
  language: string,
  values: string[],
  options: { marketingConsentProven?: boolean } = {}
) {
  const contract = templateContracts[name]
  if (!contract || contract.language !== language || !renderContract(name, values)) return 'template_data_missing'
  if (contract.risk) return contract.risk
  if (contract.category === 'MARKETING' && !options.marketingConsentProven) return 'consent_unproven'
  return verifyMetaTemplateContract(name, language)
}
