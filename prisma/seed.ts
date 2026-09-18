import { PrismaClient, AbandonedCheckoutStatus, EntityType, MessageStatus } from '@prisma/client'
import { canonicalAutomationRules, canonicalWhatsappTemplates, legacyBlockedTemplateNames } from '../src/config/recoveryCanonicalConfig'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed...')

  // =====================================================================
  // CONFIGURAÇÃO CANÔNICA DE RECOVERY
  // =====================================================================

  console.log('📋 Sincronizando templates WhatsApp canônicos...')

  for (const template of canonicalWhatsappTemplates) {
    const { id, ...data } = template
    await prisma.whatsappTemplate.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    })
  }

  console.log('⚙️  Sincronizando regras de automação canônicas...')

  for (const rule of canonicalAutomationRules) {
    const { id, ...data } = rule
    await prisma.automationRule.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    })
  }

  for (const legacyName of legacyBlockedTemplateNames) {
    await prisma.whatsappTemplate.updateMany({
      where: { metaTemplateName: legacyName },
      data: { active: false },
    })
    await prisma.automationRule.updateMany({
      where: { templateName: legacyName },
      data: { active: false },
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

  const checkoutIdempotencyKey = `abandoned_checkout:${checkout.id}:carrinho_abandonado_drosa_v2`
  await prisma.messageLog.upsert({
    where: { idempotencyKey: checkoutIdempotencyKey },
    update: {},
    create: {
      idempotencyKey: checkoutIdempotencyKey,
      entityType: EntityType.abandoned_checkout,
      entityId: checkout.id,
      customerId: customer.id,
      normalizedPhone: '5531998021418',
      templateName: 'carrinho_abandonado_drosa_v2',
      status: MessageStatus.pending,
      scheduledAt: new Date(Date.now() + 30 * 60 * 1000),
      source: 'seed_test',
    },
  })

  console.log('✅ Seed concluído com sucesso!')
  console.log(`   - ${canonicalWhatsappTemplates.length} templates sincronizados`)
  console.log(`   - ${canonicalAutomationRules.length} regras sincronizadas`)
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
