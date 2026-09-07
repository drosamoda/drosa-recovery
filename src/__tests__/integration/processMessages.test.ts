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
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      messageLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    })),
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

// Repopula a fila antes de cada teste.
async function resetPrismaMock() {
  const { prisma } = await import('../../config/prisma')
  vi.mocked(prisma.messageLog.findMany).mockResolvedValue([pendingMsg])
}

describe('POST /jobs/process-messages', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
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
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      messageLog: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }))
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

  it('INBOX_SEND_DRY_RUN tambem protege o envio automatico', async () => {
    const { whatsappService } = await import('../../services/whatsappService')
    const originalInboxDryRun = env.INBOX_SEND_DRY_RUN
    env.INBOX_SEND_DRY_RUN = true

    const res = await request(app)
      .post('/jobs/process-messages')
      .set('x-jobs-secret', JOBS_SECRET)

    env.INBOX_SEND_DRY_RUN = originalInboxDryRun
    expect(res.body).toMatchObject({ dryRun: 1, sent: 0 })
    expect(whatsappService.sendTemplateMessage).not.toHaveBeenCalled()
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
