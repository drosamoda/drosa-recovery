import { PrismaClient, TemplateCategory, EventType, AbandonedCheckoutStatus, EntityType, MessageStatus } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed...')

  // =====================================================================
  // WHATSAPP TEMPLATES
  // =====================================================================

  console.log('📋 Inserindo templates WhatsApp...')

  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_order_created' },
    update: {},
    create: {
      id: 'tpl_order_created',
      name: 'Confirmação de pedido',
      eventType: 'order_created',
      metaTemplateName: 'confirmacao_pedido_drosa',
      languageCode: 'pt_BR',
      category: TemplateCategory.utility,
      active: true,
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nRecebemos o seu pedido *[numero_pedido]* com sucesso.\n\nAgora estamos aguardando a confirmação do pagamento para separar suas peças com todo carinho.`,
      variables: ['nome_cliente', 'numero_pedido'],
    },
  })

  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_abandoned_checkout' },
    update: {},
    create: {
      id: 'tpl_abandoned_checkout',
      name: 'Carrinho abandonado 30 minutos',
      eventType: 'abandoned_checkout',
      metaTemplateName: 'carrinho_abandonado_drosa_01',
      languageCode: 'pt_BR',
      category: TemplateCategory.marketing,
      active: true,
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nVi que você iniciou um pedido no nosso site, mas não conseguiu finalizar.\nPara facilitar, você pode continuar exatamente de onde parou pelo link abaixo:\n\n👉 [link_checkout]\n\nSe ficou alguma dúvida ou precisar de ajuda para concluir, estou por aqui 💕`,
      variables: ['nome_cliente', 'link_checkout'],
    },
  })

  // Templates Fase 2 — active=false
  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_order_created_boleto' },
    update: {},
    create: {
      id: 'tpl_order_created_boleto',
      name: 'Pedido com boleto',
      eventType: 'order_created_boleto',
      metaTemplateName: 'pedido_boleto_drosa_01',
      languageCode: 'pt_BR',
      category: TemplateCategory.utility,
      active: false,
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nRecebemos o seu pedido *[numero_pedido]* e, no momento, estamos aguardando a confirmação do pagamento do boleto.\n\nSe preferir, você pode optar pelo pagamento via *PIX (celular)*.`,
      variables: ['nome_cliente', 'numero_pedido'],
    },
  })

  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_boleto_expiring' },
    update: {},
    create: {
      id: 'tpl_boleto_expiring',
      name: 'Boleto vencendo',
      eventType: 'boleto_expiring',
      metaTemplateName: 'boleto_vencendo_drosa_01',
      languageCode: 'pt_BR',
      category: TemplateCategory.utility,
      active: false,
      messagePreview: `Oi, [nome_cliente]! 😊\n\nPassando só para avisar que o seu boleto está prestes a expirar nas próximas horas ⏰\nVocê pode realizar o pagamento pelo link abaixo:\n\n👉 [link_boleto_pix]\n\nSe preferir ou tiver qualquer dúvida, estou por aqui 💕`,
      variables: ['nome_cliente', 'link_boleto_pix'],
    },
  })

  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_order_created_pix' },
    update: {},
    create: {
      id: 'tpl_order_created_pix',
      name: 'Pix pendente',
      eventType: 'order_created_pix',
      metaTemplateName: 'pix_pendente_drosa_01',
      languageCode: 'pt_BR',
      category: TemplateCategory.utility,
      active: false,
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nVi que o pedido nº *[numero_pedido]*, no valor de *R$ [valor_total]*, ainda está aguardando o pagamento.\n\nCaso o QR Code tenha expirado, você pode realizar o pagamento pela nossa chave *PIX (Debora Melo)*:\n📲 *31998021418*\n\nAssim que enviar o comprovante por aqui, damos sequência ao seu pedido 📦💕\n\nQualquer dúvida, estou por aqui 💕`,
      variables: ['nome_cliente', 'numero_pedido', 'valor_total'],
    },
  })

  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_payment_confirmed' },
    update: {},
    create: {
      id: 'tpl_payment_confirmed',
      name: 'Pagamento confirmado / pós-venda',
      eventType: 'payment_confirmed',
      metaTemplateName: 'pagamento_confirmado_drosa_01',
      languageCode: 'pt_BR',
      category: TemplateCategory.marketing,
      active: false,
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nObrigada pela confiança 💕\nRecebemos o seu pedido *[numero_pedido]* e o pagamento foi confirmado com sucesso.\n\nSeu pedido já está sendo preparado com todo carinho e, assim que for postado, o *código de rastreio será enviado por e-mail* 📧📦\n\n💖 Aproveitando, quero te convidar para o nosso *GRUPO VIP*:\nLá você recebe lançamentos em primeira mão e preços especiais!\n\n👉 *Entre aqui:* [link_grupo_vip]\n\nQualquer dúvida, estou por aqui 😊`,
      variables: ['nome_cliente', 'numero_pedido', 'link_grupo_vip'],
    },
  })

  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_payment_rejected' },
    update: {},
    create: {
      id: 'tpl_payment_rejected',
      name: 'Pagamento recusado',
      eventType: 'payment_rejected',
      metaTemplateName: 'pagamento_recusado_drosa_01',
      languageCode: 'pt_BR',
      category: TemplateCategory.utility,
      active: false,
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nIdentificamos que o pagamento do pedido *[numero_pedido]* não foi aprovado pelo cartão.\nIsso pode acontecer por alguns motivos da própria operadora 💕\n\nPara facilitar, *podemos gerar um link de pagamento pelo Mercado Pago*, seguro e rápido 🔐\nPor lá, você também pode *parcelar em até 4x sem juros*.\n\nSe quiser, me avise que já te envio o link 😊`,
      variables: ['nome_cliente', 'numero_pedido'],
    },
  })

  await prisma.whatsappTemplate.upsert({
    where: { id: 'tpl_pix_cancelled' },
    update: {},
    create: {
      id: 'tpl_pix_cancelled',
      name: 'QR Code ou pedido cancelado',
      eventType: 'pix_cancelled',
      metaTemplateName: 'pix_cancelado_drosa_01',
      languageCode: 'pt_BR',
      category: TemplateCategory.marketing,
      active: false,
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nPassando para te informar que o pedido *[numero_pedido]* foi cancelado conforme status do sistema.\n\nSe desejar, posso te ajudar a realizar um novo pedido 💕\n\n💖 Aproveitando, quero te convidar para o nosso GRUPO VIP:\nLá você recebe lançamentos em primeira mão e preços especiais!\n\n👉 Entre aqui: [link_grupo_vip]\n\nQualquer dúvida, estou por aqui 😊`,
      variables: ['nome_cliente', 'numero_pedido', 'link_grupo_vip'],
    },
  })

  // =====================================================================
  // AUTOMATION RULES
  // =====================================================================

  console.log('⚙️  Inserindo regras de automação...')

  await prisma.automationRule.upsert({
    where: { id: 'rule_order_created' },
    update: {},
    create: {
      id: 'rule_order_created',
      name: 'Confirmação de pedido',
      eventType: EventType.order_created,
      templateName: 'confirmacao_pedido_drosa',
      delayMinutes: 1,
      active: true,
      maxSendsPerEntity: 1,
      stopIfOrderExists: false,
    },
  })

  await prisma.automationRule.upsert({
    where: { id: 'rule_abandoned_checkout' },
    update: {},
    create: {
      id: 'rule_abandoned_checkout',
      name: 'Carrinho abandonado 30 minutos',
      eventType: EventType.abandoned_checkout,
      templateName: 'carrinho_abandonado_drosa_01',
      delayMinutes: 30,
      active: true,
      maxSendsPerEntity: 1,
      stopIfOrderExists: true,
    },
  })

  // Regras futuras — active=false
  const futureRules = [
    { id: 'rule_order_created_boleto', name: 'Pedido com boleto', eventType: EventType.order_created_boleto, templateName: 'pedido_boleto_drosa_01', delayMinutes: 5 },
    { id: 'rule_boleto_expiring', name: 'Boleto vencendo', eventType: EventType.boleto_expiring, templateName: 'boleto_vencendo_drosa_01', delayMinutes: 0 },
    { id: 'rule_order_created_pix', name: 'Pix pendente', eventType: EventType.order_created_pix, templateName: 'pix_pendente_drosa_01', delayMinutes: 30 },
    { id: 'rule_payment_confirmed', name: 'Pagamento confirmado', eventType: EventType.payment_confirmed, templateName: 'pagamento_confirmado_drosa_01', delayMinutes: 0 },
    { id: 'rule_payment_rejected', name: 'Pagamento recusado', eventType: EventType.payment_rejected, templateName: 'pagamento_recusado_drosa_01', delayMinutes: 5 },
    { id: 'rule_pix_cancelled', name: 'QR Code ou pedido cancelado', eventType: EventType.pix_cancelled, templateName: 'pix_cancelado_drosa_01', delayMinutes: 0 },
  ]

  for (const rule of futureRules) {
    await prisma.automationRule.upsert({
      where: { id: rule.id },
      update: {},
      create: {
        id: rule.id,
        name: rule.name,
        eventType: rule.eventType,
        templateName: rule.templateName,
        delayMinutes: rule.delayMinutes,
        active: false,
        maxSendsPerEntity: 1,
        stopIfOrderExists: true,
      },
    })
  }

  // =====================================================================
  // DADOS DE TESTE
  // =====================================================================

  console.log('🧪 Inserindo dados de teste...')

  const customer = await prisma.customer.upsert({
    where: { id: 'test_customer_001' },
    update: {},
    create: {
      id: 'test_customer_001',
      name: 'Cliente Teste',
      phone: '31998021418',
      normalizedPhone: '5531998021418',
      optOut: false,
      source: 'seed_test',
    },
  })

  const order = await prisma.order.upsert({
    where: { nuvemshopOrderId: 'test_order_001' },
    update: {},
    create: {
      id: 'test_order_001',
      nuvemshopOrderId: 'test_order_001',
      orderNumber: '1001',
      customerId: customer.id,
      customerName: 'Cliente Teste',
      customerPhone: '31998021418',
      normalizedPhone: '5531998021418',
      total: 199.9,
      currency: 'BRL',
      paymentStatus: 'pending',
      status: 'open',
      rawPayload: {},
      source: 'seed_test',
    },
  })

  const checkout = await prisma.abandonedCheckout.upsert({
    where: { nuvemshopCheckoutId: 'test_checkout_001' },
    update: {},
    create: {
      id: 'test_checkout_001',
      nuvemshopCheckoutId: 'test_checkout_001',
      customerId: customer.id,
      customerName: 'Cliente Teste',
      customerPhone: '31998021418',
      normalizedPhone: '5531998021418',
      productsSummary: 'Conjunto Bela',
      abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/teste',
      status: AbandonedCheckoutStatus.abandoned,
      rawPayload: {},
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      source: 'seed_test',
    },
  })

  const orderIdempotencyKey = `order:${order.id}:confirmacao_pedido_drosa`
  await prisma.messageLog.upsert({
    where: { idempotencyKey: orderIdempotencyKey },
    update: {},
    create: {
      idempotencyKey: orderIdempotencyKey,
      entityType: EntityType.order,
      entityId: order.id,
      customerId: customer.id,
      normalizedPhone: '5531998021418',
      templateName: 'confirmacao_pedido_drosa',
      status: MessageStatus.pending,
      scheduledAt: new Date(),
      source: 'seed_test',
    },
  })

  const checkoutIdempotencyKey = `abandoned_checkout:${checkout.id}:carrinho_abandonado_drosa_01`
  await prisma.messageLog.upsert({
    where: { idempotencyKey: checkoutIdempotencyKey },
    update: {},
    create: {
      idempotencyKey: checkoutIdempotencyKey,
      entityType: EntityType.abandoned_checkout,
      entityId: checkout.id,
      customerId: customer.id,
      normalizedPhone: '5531998021418',
      templateName: 'carrinho_abandonado_drosa_01',
      status: MessageStatus.pending,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
      source: 'seed_test',
    },
  })

  console.log('✅ Seed concluído com sucesso!')
  console.log(`   - 8 templates inseridos (2 ativos, 6 fase 2)`)
  console.log(`   - 8 regras de automação inseridas (2 ativas, 6 fase 2)`)
  console.log(`   - 1 customer de teste: ${customer.id}`)
  console.log(`   - 1 order de teste: ${order.id}`)
  console.log(`   - 1 abandoned_checkout de teste: ${checkout.id}`)
  console.log(`   - 2 message_logs de teste`)
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
