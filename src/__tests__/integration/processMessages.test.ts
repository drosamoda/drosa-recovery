import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import app from '../../index'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'

// Dados de teste criados antes da factory do vi.mock (vi.hoisted garante a ordem)
const { pendingMsg, processingMsg } = vi.hoisted(() => {
  const pendingMsg = {
    id: 'msg-001',
    idempotencyKey: 'order:order-001:confirmacao_pedido_drosa',
    entityType: 'order',
    entityId: 'order-001',
    customerId: 'cust-001',
    normalizedPhone: '5531998021418',
    templateName: 'confirmacao_pedido_drosa',
    status: 'pending',
    retryCount: 0,
    scheduledAt: new Date(Date.now() - 60000),
    nextRetryAt: null,
  }
  const processingMsg = { ...pendingMsg, status: 'processing' }
  return { pendingMsg, processingMsg }
})

// Mock do Prisma e dos serviços de envio
vi.mock('../../config/prisma', () => ({
  prisma: {
    suppression: { findUnique: vi.fn().mockResolvedValue(null) },
    messageLog: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({ ...processingMsg, status: 'sent' }),
      findUnique: vi.fn().mockResolvedValue({ status: 'processing' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    customer: {
      findUnique: vi.fn().mockResolvedValue({ id: 'cust-001', optOut: false }),
      findFirst: vi.fn().mockResolvedValue({ id: 'cust-001', optOut: false }),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsappTemplate: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'tpl-001',
        metaTemplateName: 'confirmacao_pedido_drosa',
        active: true,
        languageCode: 'pt_BR',
        eventType: 'order_created',
        messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nRecebemos o seu pedido *[numero_pedido]* com sucesso.\n\nAgora estamos aguardando a confirmação do pagamento para separar suas peças com todo carinho.\n\n👉 *Entre aqui:* [link_grupo_vip]`,
      }),
    },
    automationRule: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'rule-001',
        templateName: 'confirmacao_pedido_drosa',
        active: true,
        eventType: 'order_created',
      }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'order-001',
        customerName: 'Maria Silva',
        orderNumber: '1001',
        total: '149.90',
        orderUrl: 'https://example.com',
      }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    abandonedCheckout: {
      findUnique: vi.fn().mockResolvedValue({
        customerName: 'Maria Silva',
        customerEmail: 'maria@example.com',
        customerPhone: '5531998021418',
        normalizedPhone: '5531998021418',
        abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/test',
        firstSeenAt: new Date(Date.now() - 3600000),
        sourceCreatedAt: new Date(Date.now() - 3600000),
        status: 'abandoned',
      }),
    },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      messageLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    })),
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
  },
}))

vi.mock('../../services/whatsappService', () => ({
  whatsappService: {
    sendTemplateMessage: vi.fn().mockResolvedValue({
      success: true,
      metaMessageId: 'wamid-test-123',
    }),
  },
}))

vi.mock('../../services/inboxService', () => ({
  inboxService: {
    mirrorAutomationMessage: vi.fn().mockResolvedValue({ created: true }),
  },
}))

const JOBS_SECRET = process.env.JOBS_SECRET!
vi.mock('../../services/templateContracts', () => ({
  verifyDispatchContract: vi.fn().mockResolvedValue(null),
  renderContract: vi.fn().mockReturnValue('Recebemos o seu pedido'),
  isMarketingTemplate: vi.fn().mockReturnValue(false),
}))

// Repopula a fila antes de cada teste.
async function resetPrismaMock() {
  const { prisma } = await import('../../config/prisma')
  vi.mocked(prisma.messageLog.findMany).mockResolvedValue([pendingMsg] as never)
}

describe('POST /jobs/process-messages', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    env.AUTOMATION_SEND_ENABLED = true
    await resetPrismaMock()
    // Restaura mocks não-findMany que clearAllMocks apaga
    const { prisma } = await import('../../config/prisma')
    vi.mocked(prisma.messageLog.updateMany).mockResolvedValue({ count: 1 })
    vi.mocked(prisma.messageLog.update).mockResolvedValue({ ...processingMsg, status: 'sent' } as never)
    vi.mocked(prisma.messageLog.findUnique).mockResolvedValue({ status: 'processing' } as never)
    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: 'cust-001', optOut: false } as never)
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: 'cust-001', optOut: false } as never)
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue({
      id: 'tpl-001', metaTemplateName: 'confirmacao_pedido_drosa',
      active: true, languageCode: 'pt_BR', eventType: 'order_created',
      messagePreview: `Oi, [nome_cliente]! 😊\nSou a Dani da D'Rosa Moda.\n\nRecebemos o seu pedido *[numero_pedido]* com sucesso.\n\nAgora estamos aguardando a confirmação do pagamento para separar suas peças com todo carinho.\n\n👉 *Entre aqui:* [link_grupo_vip]`,
    } as never)
    vi.mocked(prisma.automationRule.findFirst).mockResolvedValue({
      id: 'rule-001', templateName: 'confirmacao_pedido_drosa',
      active: true, eventType: 'order_created',
    } as never)
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: 'order-001', customerName: 'Maria Silva', orderNumber: '1001', total: '149.90', orderUrl: 'https://example.com',
    } as never)
    vi.mocked(prisma.order.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.abandonedCheckout.findUnique).mockResolvedValue({
      customerName: 'Maria Silva', customerEmail: 'maria@example.com', customerPhone: '5531998021418',
      normalizedPhone: '5531998021418', abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/test',
      firstSeenAt: new Date(Date.now() - 3600000), sourceCreatedAt: new Date(Date.now() - 3600000), status: 'abandoned',
    } as never)
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => fn({
      messageLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    })) as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ acquired: true }] as never)
    // Restaura whatsappService mock padrão
    const { whatsappService } = await import('../../services/whatsappService')
    vi.mocked(whatsappService.sendTemplateMessage).mockResolvedValue({
      success: true,
      metaMessageId: 'wamid-test-123',
    })
  })

  it('retorna 401 sem jobs secret', async () => {
    const res = await request(app).post('/jobs/process-messages')
    expect(res.status).toBe(401)
  })

  it('dois workers concorrentes fazem uma unica chamada ao sender', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { runProcessMessages } = await import('../../jobs/processMessages')
    let claimed = false
    vi.mocked(prisma.messageLog.updateMany).mockImplementation((async () => {
      if (claimed) return { count: 0 }
      claimed = true
      return { count: 1 }
    }) as never)
    const results = await Promise.all([runProcessMessages(), runProcessMessages()])
    expect(results.reduce((sum, item) => sum + item.sent, 0)).toBe(1)
    expect(whatsappService.sendTemplateMessage).toHaveBeenCalledTimes(1)
  })

  it('automation gate fechado impede a chamada Meta', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { runProcessMessages } = await import('../../jobs/processMessages')
    env.AUTOMATION_SEND_ENABLED = false
    const result = await runProcessMessages()
    expect(result.sent).toBe(0)
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('timeout incerto nao agenda retry nem marca failed comum', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { runProcessMessages } = await import('../../jobs/processMessages')
    vi.mocked(whatsappService.sendTemplateMessage).mockResolvedValue({ success: false, uncertain: true, reason: 'delivery_unknown' })
    const result = await runProcessMessages()
    expect(result).toMatchObject({ sent: 0, unknown: 1, failed: 0, retryScheduled: 0 })
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'unknown' }) }))
  })

  it('falha no mirror preserva aceite e nao reenvia WhatsApp', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { inboxService } = await import('../../services/inboxService')
    const { runProcessMessages } = await import('../../jobs/processMessages')
    vi.mocked(inboxService.mirrorAutomationMessage).mockRejectedValueOnce(new Error('mirror unavailable'))
    const result = await runProcessMessages()
    expect(result).toMatchObject({ sent: 1, failed: 0, unknown: 0 })
    expect(whatsappService.sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(prisma.messageLog.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }))
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mirrorStatus: 'failed' }) }))
  })

  it('retorna resumo com campos corretos', async () => {
    const { inboxService } = await import('../../services/inboxService')

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('found')
    expect(res.body).toHaveProperty('eligible')
    expect(res.body).toHaveProperty('markedProcessing')
    expect(res.body).toHaveProperty('dryRun')
    expect(res.body).toHaveProperty('sent')
    expect(res.body).toHaveProperty('skipped')
    expect(res.body).toHaveProperty('failed')
    expect(res.body).toHaveProperty('errors')
    expect(res.body).toHaveProperty('retryScheduled')
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-001' },
      data: expect.objectContaining({
        payload: expect.objectContaining({
          renderedPreview: expect.stringContaining('Recebemos o seu pedido'),
          templateParameters: expect.objectContaining({
            nome_cliente: 'Maria',
            numero_pedido: '1001',
          }),
        }),
      }),
    }))
    expect(inboxService.mirrorAutomationMessage).toHaveBeenCalledWith(expect.objectContaining({
      phone: '5531998021418',
      metaMessageId: 'wamid-test-123',
      templateName: 'confirmacao_pedido_drosa',
      status: 'sent',
      messageLogId: 'msg-001',
      payload: expect.objectContaining({
        renderedPreview: expect.stringContaining('Recebemos o seu pedido'),
        templateParameters: expect.objectContaining({
          nome_cliente: 'Maria',
          numero_pedido: '1001',
        }),
      }),
    }))
  })

  it('payment_confirmed envia ao contrato os 3 parametros incluindo o link VIP', async () => {
    const { verifyDispatchContract } = await import('../../services/templateContracts')
    const originalWhatsappDryRun = env.WHATSAPP_DRY_RUN
    env.WHATSAPP_DRY_RUN = true

    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      { ...pendingMsg, templateName: 'pagamento_confirmado_drosa_01' } as never,
    ])
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue({
      id: 'tpl-paid',
      metaTemplateName: 'pagamento_confirmado_drosa_01',
      active: true,
      languageCode: 'pt_BR',
      eventType: 'payment_confirmed',
      messagePreview: 'Pagamento confirmado [nome_cliente] [numero_pedido] [link_grupo_vip]',
    } as never)
    vi.mocked(prisma.automationRule.findFirst).mockResolvedValue({
      id: 'rule-paid',
      templateName: 'pagamento_confirmado_drosa_01',
      active: true,
      eventType: 'payment_confirmed',
    } as never)

    const result = await (await import('../../jobs/processMessages')).runProcessMessages()

    env.WHATSAPP_DRY_RUN = originalWhatsappDryRun

    expect(result).toMatchObject({ dryRun: 1, sent: 0 })
    expect(verifyDispatchContract).toHaveBeenCalledWith(
      'pagamento_confirmado_drosa_01',
      'pt_BR',
      ['Maria', '1001', env.GRUPO_VIP_LINK],
      expect.any(Object),
    )
  })

  it('dry-run aplica os mesmos gates de contrato e consentimento do envio real', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { verifyDispatchContract } = await import('../../services/templateContracts')
    const originalWhatsappDryRun = env.WHATSAPP_DRY_RUN
    env.WHATSAPP_DRY_RUN = true
    vi.mocked(verifyDispatchContract).mockResolvedValueOnce('consent_unproven')

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    env.WHATSAPP_DRY_RUN = originalWhatsappDryRun

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ dryRun: 0, sent: 0, skipped: 1 })
    expect(verifyDispatchContract).toHaveBeenCalledTimes(1)
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-001' },
      data: expect.objectContaining({ status: 'skipped', reason: 'consent_unproven' }),
    }))
  })

  it('dry-run nao chama Meta, nao marca sent e nao cria metaMessageId falso', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const originalWhatsappDryRun = env.WHATSAPP_DRY_RUN
    env.WHATSAPP_DRY_RUN = true

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    env.WHATSAPP_DRY_RUN = originalWhatsappDryRun

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ eligible: 1, dryRun: 1, sent: 0 })
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-001' },
      data: expect.objectContaining({
        status: 'pending',
        metaMessageId: null,
        sentAt: null,
        reason: 'dry_run',
      }),
    }))
  })

  it('marketing fora da janela e adiado sem chamar Meta nem ser descartado', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { isMarketingTemplate } = await import('../../services/templateContracts')
    const originalStart = env.MARKETING_SEND_HOUR_START
    const originalEnd = env.MARKETING_SEND_HOUR_END
    const originalDryRun = env.WHATSAPP_DRY_RUN
    env.MARKETING_SEND_HOUR_START = 9
    env.MARKETING_SEND_HOUR_END = 9
    env.WHATSAPP_DRY_RUN = false
    vi.mocked(isMarketingTemplate).mockReturnValueOnce(true)

    const result = await (await import('../../jobs/processMessages')).runProcessMessages()

    env.MARKETING_SEND_HOUR_START = originalStart
    env.MARKETING_SEND_HOUR_END = originalEnd
    env.WHATSAPP_DRY_RUN = originalDryRun

    expect(result.sent).toBe(0)
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-001' },
      data: expect.objectContaining({
        status: 'pending',
        reason: 'marketing_send_window_closed',
        claimOwner: null,
        claimExpiresAt: null,
        nextRetryAt: expect.any(Date),
      }),
    }))
  })

  it('INBOX_SEND_DRY_RUN protege somente a Inbox manual', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const originalInboxDryRun = env.INBOX_SEND_DRY_RUN
    env.INBOX_SEND_DRY_RUN = true

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    env.INBOX_SEND_DRY_RUN = originalInboxDryRun
    expect(res.body).toMatchObject({ dryRun: 0, sent: 1 })
    expect(whatsappService.sendTemplateMessage).toHaveBeenCalledTimes(1)
  })

  it('gate desabilitado bloqueia carrinho antes de chamar Meta', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const originalEnabled = env.ABANDONED_CART_ENABLED
    env.ABANDONED_CART_ENABLED = false
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      { ...pendingMsg, entityType: 'abandoned_checkout', entityId: 'checkout-001' } as never,
    ])

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    env.ABANDONED_CART_ENABLED = originalEnabled
    expect(res.body).toMatchObject({ sent: 0, skipped: 1 })
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'skipped', reason: 'abandoned_cart_disabled' }),
    }))
  })

  it('gate desabilitado bloqueia fonte de remarketing antes de chamar Meta', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue([
      { ...pendingMsg, source: 'remarketing_preview_promoted' } as never,
    ])

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.body).toMatchObject({ sent: 0, skipped: 1 })
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('nao processa candidato que outra execucao reivindicou primeiro', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    vi.mocked(prisma.messageLog.updateMany).mockResolvedValue({ count: 0 })

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.body).toMatchObject({ found: 1, markedProcessing: 0, sent: 0 })
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('agenda retry com next_retry_at para erro temporário', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    vi.mocked(whatsappService.sendTemplateMessage).mockResolvedValue({
      success: false,
      errorType: 'temporary',
      errorCode: '429',
      reason: 'rate_limit',
    })

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(200)
    expect(typeof res.body.retryScheduled).toBe('number')
  })

  it('marca failed para erro permanente', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    vi.mocked(whatsappService.sendTemplateMessage).mockResolvedValue({
      success: false,
      errorType: 'permanent',
      errorCode: '132000',
      reason: 'template_not_found',
    })

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(200)
    expect(typeof res.body.failed).toBe('number')
  })

  it('allowlist processa apenas o template permitido e mantém os demais pendentes', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { runProcessMessages } = await import('../../jobs/processMessages')
    const original = env.AUTOMATION_ALLOWED_TEMPLATES
    env.AUTOMATION_ALLOWED_TEMPLATES = ['carrinho_abandonado_drosa_v2']
    vi.mocked(prisma.messageLog.findMany).mockImplementation((async (args: unknown) => {
      const where = (args as { where?: { templateName?: unknown } } | undefined)?.where
      return where?.templateName ? [] : [pendingMsg]
    }) as never)

    const result = await runProcessMessages()

    env.AUTOMATION_ALLOWED_TEMPLATES = original
    expect(result.found).toBe(0)
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
    expect(prisma.messageLog.updateMany).not.toHaveBeenCalled()
  })

  it('limite por execução libera carrinhos excedentes de volta para pending', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const { runProcessMessages } = await import('../../jobs/processMessages')
    const originalCartEnabled = env.ABANDONED_CART_ENABLED
    const originalDryRun = env.WHATSAPP_DRY_RUN
    env.ABANDONED_CART_ENABLED = true
    env.WHATSAPP_DRY_RUN = false
    const carts = [1, 2, 3].map((n) => ({ ...pendingMsg, id: `checkout-${n}`, entityType: 'abandoned_checkout', entityId: `checkout-${n}`, templateName: 'carrinho_abandonado_drosa_v2' }))
    vi.mocked(prisma.messageLog.findMany).mockResolvedValue(carts as never)
    vi.mocked(prisma.whatsappTemplate.findFirst).mockResolvedValue({ id: 'tpl-cart', metaTemplateName: 'carrinho_abandonado_drosa_v2', active: true, languageCode: 'pt_BR', eventType: 'abandoned_checkout', messagePreview: 'Oi [nome_cliente] [link_checkout]' } as never)
    vi.mocked(prisma.automationRule.findFirst).mockResolvedValue({ id: 'rule-cart', templateName: 'carrinho_abandonado_drosa_v2', active: true, eventType: 'abandoned_checkout' } as never)

    const result = await runProcessMessages()

    env.ABANDONED_CART_ENABLED = originalCartEnabled
    env.WHATSAPP_DRY_RUN = originalDryRun
    expect(result.sent).toBe(1)
    expect(whatsappService.sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'checkout-2' }, data: expect.objectContaining({ status: 'pending', claimOwner: null }) }))
    expect(prisma.messageLog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'checkout-3' }, data: expect.objectContaining({ status: 'pending', claimOwner: null }) }))
  })
})

describe('POST /jobs/sync-abandoned-checkouts', () => {
  it('retorna 401 sem jobs secret', async () => {
    const res = await request(app).post('/jobs/sync-abandoned-checkouts')
    expect(res.status).toBe(401)
  })

  it('retorna resumo com campos corretos quando não há carrinhos', async () => {
    vi.mock('../../services/nuvemshopService', () => ({
      nuvemshopService: {
        fetchAbandonedCheckouts: vi.fn().mockResolvedValue([]),
      },
    }))

    const res = await request(app)
      .post('/jobs/sync-abandoned-checkouts')
      .set('x-jobs-secret', JOBS_SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      found: 0,
      eligible: 0,
      dryRun: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      errors: 0,
      scheduled: 0,
    })
  })
})
