import { EventType, TemplateCategory } from '@prisma/client'

export type CanonicalWhatsappTemplate = {
  id: string
  name: string
  eventType: string
  metaTemplateName: string
  languageCode: string
  category: TemplateCategory
  messagePreview: string
  variables: string[]
  active: boolean
}

export type CanonicalAutomationRule = {
  id: string
  name: string
  eventType: EventType
  templateName: string
  delayMinutes: number
  active: boolean
  maxSendsPerEntity: number
  stopIfOrderExists: boolean
}

// Esta é a configuração operacional canônica do Recovery CRM.
// "active" aqui significa que template/regra podem gerar fila; envio real
// continua dependendo de AUTOMATION_SEND_ENABLED, WHATSAPP_DRY_RUN,
// allowlist, gates do fluxo, consentimento e contrato Meta.
export const canonicalWhatsappTemplates: CanonicalWhatsappTemplate[] = [
  {
    id: 'tpl_order_created',
    name: 'Confirmação de pedido',
    eventType: 'order_created',
    metaTemplateName: 'confirmacao_pedido_drosa',
    languageCode: 'pt_BR',
    category: TemplateCategory.utility,
    messagePreview: "Oi, [nome_cliente]! 😊 Sou a Dani da D'Rosa Moda. Recebemos o seu pedido *[numero_pedido]* com sucesso. Em breve você receberá as atualizações por aqui!",
    variables: ['nome_cliente', 'numero_pedido'],
    active: true,
  },
  {
    id: 'tpl_abandoned_checkout',
    name: 'Carrinho abandonado 30 minutos',
    eventType: 'abandoned_checkout',
    metaTemplateName: 'carrinho_abandonado_drosa_v2',
    languageCode: 'pt_BR',
    category: TemplateCategory.marketing,
    messagePreview: `Oi, [nome_cliente]! 😊
Você deixou algumas peças no carrinho da D’Rosa Moda.

Se quiser continuar sua compra, acesse:
[link_checkout]

Se precisar de ajuda com tamanho, tecido ou combinação, me chama por aqui.`,
    variables: ['nome_cliente', 'link_checkout'],
    active: true,
  },
  {
    id: 'tpl_order_created_boleto',
    name: 'Pedido com boleto',
    eventType: 'order_created_boleto',
    metaTemplateName: 'pedido_boleto_drosa_01',
    languageCode: 'pt_BR',
    category: TemplateCategory.utility,
    messagePreview: 'Oi, [nome_cliente]! Seu pedido *[numero_pedido]* foi recebido e está aguardando a confirmação do pagamento via boleto. O prazo de compensação é de até 3 dias úteis. 💙',
    variables: ['nome_cliente', 'numero_pedido'],
    active: false,
  },
  {
    id: 'tpl_boleto_expiring',
    name: 'Boleto vencendo',
    eventType: 'boleto_expiring',
    metaTemplateName: 'boleto_vencendo_drosa_v2',
    languageCode: 'pt_BR',
    category: TemplateCategory.utility,
    messagePreview: 'Oi, [nome_cliente]! O boleto do pedido *[numero_pedido]* está próximo do vencimento. Se você já realizou o pagamento, desconsidere esta mensagem. Se precisar de ajuda, me chama por aqui. 💙',
    variables: ['nome_cliente', 'numero_pedido'],
    active: false,
  },
  {
    id: 'tpl_order_created_pix',
    name: 'Pix pendente',
    eventType: 'order_created_pix',
    metaTemplateName: '_pix_pendente',
    languageCode: 'pt_BR',
    category: TemplateCategory.marketing,
    messagePreview: 'Oi, [nome_cliente]! Pedido nº *[numero_pedido]* no valor de *[valor_total]* aguardando pagamento PIX. Complete o pagamento para garantir seus itens! 💙',
    variables: ['nome_cliente', 'numero_pedido', 'valor_total'],
    active: false,
  },
  {
    id: 'tpl_payment_confirmed',
    name: 'Pagamento confirmado / pós-venda',
    eventType: 'payment_confirmed',
    metaTemplateName: 'pagamento_confirmado_drosa_01',
    languageCode: 'pt_BR',
    category: TemplateCategory.marketing,
    messagePreview: `Oi, [nome_cliente]! 😊
Sou a Dani da D'Rosa Moda.

Obrigada pela confiança 💕
Recebemos o seu pedido *[numero_pedido]* e o pagamento foi confirmado com sucesso.

Seu pedido já está sendo preparado com todo carinho e, assim que for postado, o *código de rastreio será enviado por e-mail* 📧📦

💖 Aproveitando, quero te convidar para o nosso *GRUPO VIP*:
Lá você recebe lançamentos em primeira mão e preços especiais!

👉 *Entre aqui:* [link_grupo_vip]

Qualquer dúvida, estou por aqui 😊`,
    variables: ['nome_cliente', 'numero_pedido', 'link_grupo_vip'],
    active: false,
  },
  {
    id: 'tpl_payment_rejected',
    name: 'Pagamento recusado',
    eventType: 'payment_rejected',
    metaTemplateName: 'pagamento_recusado_drosa_01',
    languageCode: 'pt_BR',
    category: TemplateCategory.utility,
    messagePreview: `Oi, [nome_cliente]! 😊
Sou a Dani da D'Rosa Moda.

Identificamos que o pagamento do pedido *[numero_pedido]* não foi aprovado pelo cartão.
Isso pode acontecer por alguns motivos da própria operadora 💕

Para facilitar, *podemos gerar um link de pagamento pelo Mercado Pago*, seguro e rápido 🔐
Por lá, você também pode *parcelar em até 4x sem juros*.

Se quiser, me avise que já te envio o link 😊`,
    variables: ['nome_cliente', 'numero_pedido'],
    active: false,
  },
  {
    id: 'tpl_pix_cancelled',
    name: 'QR Code ou pedido cancelado',
    eventType: 'pix_cancelled',
    metaTemplateName: 'pix_cancelado_drosa_01',
    languageCode: 'pt_BR',
    category: TemplateCategory.marketing,
    messagePreview: `Oi, [nome_cliente]! 😊
Sou a Dani da D'Rosa Moda.

Passando para te informar que o pedido *[numero_pedido]* foi cancelado conforme status do sistema.

Se desejar, posso te ajudar a realizar um novo pedido 💕

💖 Aproveitando, quero te convidar para o nosso GRUPO VIP:
Lá você recebe lançamentos em primeira mão e preços especiais!

👉 Entre aqui: [link_grupo_vip]

Qualquer dúvida, estou por aqui 😊`,
    variables: ['nome_cliente', 'numero_pedido', 'link_grupo_vip'],
    active: false,
  },
]

export const canonicalAutomationRules: CanonicalAutomationRule[] = [
  {
    id: 'rule_order_created',
    name: 'Confirmação de pedido',
    eventType: EventType.order_created,
    templateName: 'confirmacao_pedido_drosa',
    delayMinutes: 1,
    active: true,
    maxSendsPerEntity: 1,
    stopIfOrderExists: false,
  },
  {
    id: 'rule_abandoned_checkout',
    name: 'Carrinho abandonado 30 minutos',
    eventType: EventType.abandoned_checkout,
    templateName: 'carrinho_abandonado_drosa_v2',
    delayMinutes: 30,
    active: true,
    maxSendsPerEntity: 1,
    stopIfOrderExists: true,
  },
  {
    id: 'rule_order_created_boleto',
    name: 'Pedido com boleto',
    eventType: EventType.order_created_boleto,
    templateName: 'pedido_boleto_drosa_01',
    delayMinutes: 5,
    active: false,
    maxSendsPerEntity: 1,
    stopIfOrderExists: true,
  },
  {
    id: 'rule_boleto_expiring',
    name: 'Boleto vencendo',
    eventType: EventType.boleto_expiring,
    templateName: 'boleto_vencendo_drosa_v2',
    delayMinutes: 0,
    active: false,
    maxSendsPerEntity: 1,
    stopIfOrderExists: true,
  },
  {
    id: 'rule_order_created_pix',
    name: 'Pix pendente',
    eventType: EventType.order_created_pix,
    templateName: '_pix_pendente',
    delayMinutes: 30,
    active: false,
    maxSendsPerEntity: 1,
    stopIfOrderExists: true,
  },
  {
    id: 'rule_payment_confirmed',
    name: 'Pagamento confirmado',
    eventType: EventType.payment_confirmed,
    templateName: 'pagamento_confirmado_drosa_01',
    delayMinutes: 0,
    active: false,
    maxSendsPerEntity: 1,
    stopIfOrderExists: true,
  },
  {
    id: 'rule_payment_rejected',
    name: 'Pagamento recusado',
    eventType: EventType.payment_rejected,
    templateName: 'pagamento_recusado_drosa_01',
    delayMinutes: 5,
    active: false,
    maxSendsPerEntity: 1,
    stopIfOrderExists: true,
  },
  {
    id: 'rule_pix_cancelled',
    name: 'QR Code ou pedido cancelado',
    eventType: EventType.pix_cancelled,
    templateName: 'pix_cancelado_drosa_01',
    delayMinutes: 0,
    active: false,
    maxSendsPerEntity: 1,
    stopIfOrderExists: true,
  },
]

export const legacyBlockedTemplateNames = ['carrinho_abandonado_drosa_01'] as const
