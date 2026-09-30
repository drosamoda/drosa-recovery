import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'

const HOUR = 3_600_000

const mocks = vi.hoisted(() => {
  const writes = {
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  }
  return {
    writes,
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    customerFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    suppressionFindUnique: vi.fn(),
    templateFindFirst: vi.fn(),
    ruleFindFirst: vi.fn(),
    orderFindUnique: vi.fn(),
    orderFindFirst: vi.fn(),
    hasConsent: vi.fn(),
    metaVerify: vi.fn(),
    send: vi.fn(),
    transaction: vi.fn(),
    queryRaw: vi.fn(),
    executeRaw: vi.fn(),
  }
})

vi.mock('../../config/prisma', () => ({
  prisma: {
    messageLog: {
      count: mocks.count,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      ...mocks.writes,
    },
    customer: { findUnique: mocks.customerFindUnique, findFirst: mocks.customerFindFirst, ...mocks.writes },
    suppression: { findUnique: mocks.suppressionFindUnique, ...mocks.writes },
    whatsappTemplate: { findFirst: mocks.templateFindFirst, ...mocks.writes },
    automationRule: { findFirst: mocks.ruleFindFirst, ...mocks.writes },
    order: { findUnique: mocks.orderFindUnique, findFirst: mocks.orderFindFirst, ...mocks.writes },
    abandonedCheckout: { findUnique: vi.fn(), ...mocks.writes },
    conversation: { findUnique: vi.fn(), ...mocks.writes },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  },
}))
vi.mock('../../services/whatsappConsentService', () => ({ hasActiveWhatsappConsent: mocks.hasConsent }))
vi.mock('../../services/whatsappService', () => ({ whatsappService: { sendTemplateMessage: mocks.send } }))
vi.mock('../../services/inboxService', () => ({ inboxService: { mirrorAutomationMessage: vi.fn() } }))
vi.mock('../../services/templateContracts', async () => {
  const actual = await vi.importActual<typeof import('../../services/templateContracts')>('../../services/templateContracts')
  return { ...actual, verifyMetaTemplateContract: mocks.metaVerify }
})

import { runProcessMessagesDryRun } from '../../jobs/processMessagesDryRun'

function msg(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    entityType: 'order',
    entityId: `order-${id}`,
    customerId: `cust-${id}`,
    normalizedPhone: '5531998021418',
    templateName: 'confirmacao_pedido_drosa',
    source: null,
    status: 'pending',
    retryCount: 0,
    scheduledAt: new Date(Date.now() - HOUR),
    nextRetryAt: null,
    claimOwner: null,
    ...over,
  }
}

const original = { ...env } as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  env.AUTOMATION_SEND_ENABLED = true
  env.WHATSAPP_DRY_RUN = false
  env.AUTOMATION_ALLOWED_TEMPLATES = ['confirmacao_pedido_drosa', 'pedido_boleto_drosa_01']
  env.AUTOMATION_MAX_MESSAGE_AGE_HOURS = 24
  env.ABANDONED_CART_ENABLED = true
  env.REMARKETING_ENABLED = true
  mocks.count.mockResolvedValue(0)
  mocks.findMany.mockResolvedValue([])
  mocks.findFirst.mockResolvedValue(null)
  mocks.customerFindUnique.mockResolvedValue({ id: 'c', optOut: false })
  mocks.customerFindFirst.mockResolvedValue({ id: 'c', optOut: false })
  mocks.suppressionFindUnique.mockResolvedValue(null)
  mocks.templateFindFirst.mockResolvedValue({ id: 't', languageCode: 'pt_BR', messagePreview: null, variables: null, metaTemplateName: 'x' })
  mocks.ruleFindFirst.mockResolvedValue({ id: 'r', eventType: 'order_created', templateName: 'confirmacao_pedido_drosa', active: true })
  mocks.orderFindUnique.mockResolvedValue({
    customerName: 'Maria Silva', orderNumber: '1001', total: '149.90', orderUrl: 'https://x', paymentStatus: 'pending', paymentMethod: 'pix', status: 'open', sourceCreatedAt: new Date(),
  })
  mocks.orderFindFirst.mockResolvedValue(null)
  mocks.hasConsent.mockResolvedValue(true)
  mocks.metaVerify.mockResolvedValue(null)
})

function setQueue(rows: Array<Record<string, unknown>>): void {
  mocks.count.mockResolvedValue(rows.length)
  mocks.findMany.mockResolvedValue(rows)
}

describe('runProcessMessagesDryRun (somente leitura)', () => {
  it('prova de leitura: nunca envia, nunca escreve, nunca reivindica', async () => {
    setQueue([
      msg('a'),
      msg('b', { scheduledAt: new Date(Date.now() - 30 * HOUR) }),
      msg('c', { scheduledAt: new Date(Date.now() + HOUR) }),
    ])
    mocks.hasConsent.mockImplementation(async (_p: string, scope: string) => scope === 'transactional')

    await runProcessMessagesDryRun()

    expect(mocks.send).not.toHaveBeenCalled()
    for (const [name, fn] of Object.entries(mocks.writes)) expect(fn, `escrita proibida: ${name}`).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.queryRaw).not.toHaveBeenCalled()
    expect(mocks.executeRaw).not.toHaveBeenCalled()
    // nem a checagem de claim (findUnique do próprio log) é feita
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('classifica expirada, sem consentimento transacional, enviável e ainda não vencida', async () => {
    setQueue([
      msg('exp', { scheduledAt: new Date(Date.now() - 30 * HOUR) }),
      msg('ok'),
      msg('noconsent', { normalizedPhone: '5583999990000' }),
      msg('future', { scheduledAt: new Date(Date.now() + HOUR) }),
    ])
    mocks.hasConsent.mockImplementation(async (phone: string, scope: string) => scope === 'transactional' && phone === '5531998021418')

    const r = await runProcessMessagesDryRun()

    expect(r.dryRun).toBe(true)
    expect(r.totalPending).toBe(4)
    expect(r.totalCandidates).toBe(3)
    expect(r.wouldExpire).toBe(1)
    expect(r.wouldReachSendStage).toBe(1)
    expect(r.reachSendStageByTemplate).toEqual({ confirmacao_pedido_drosa: 1 })
    expect(r.wouldSkipTransactionalConsent).toBe(1)
    expect(r.wouldRetryLater).toBe(1)
    expect(r.other).toBe(0)
  })

  it('pagamento já concluído → wouldSkipPaymentCompleted (regra de PIX/boleto pendente)', async () => {
    setQueue([msg('paid', { templateName: 'pedido_boleto_drosa_01' })])
    mocks.ruleFindFirst.mockResolvedValue({ id: 'r', eventType: 'order_created_boleto', templateName: 'pedido_boleto_drosa_01', active: true })
    mocks.orderFindUnique.mockResolvedValue({
      customerName: 'Maria', orderNumber: '1', total: '10', orderUrl: 'x', paymentStatus: 'paid', paymentMethod: 'boleto', status: 'open', sourceCreatedAt: new Date(),
    })

    const r = await runProcessMessagesDryRun()

    expect(r.wouldSkipPaymentCompleted).toBe(1)
    expect(r.wouldReachSendStage).toBe(0)
  })

  it('template de marketing sem consentimento de marketing → wouldSkipMarketingConsent', async () => {
    env.AUTOMATION_ALLOWED_TEMPLATES = ['_pix_pendente']
    setQueue([msg('mk', { templateName: '_pix_pendente' })])
    mocks.ruleFindFirst.mockResolvedValue({ id: 'r', eventType: 'order_created_pix', templateName: '_pix_pendente', active: true })
    mocks.hasConsent.mockImplementation(async (_p: string, scope: string) => scope === 'transactional')

    const r = await runProcessMessagesDryRun()

    expect(r.wouldSkipMarketingConsent).toBe(1)
    expect(r.wouldSkipTransactionalConsent).toBe(0)
    expect(r.wouldReachSendStage).toBe(0)
  })

  it('template fora da allowlist e verificação da Meta cacheada por template', async () => {
    setQueue([msg('a'), msg('b'), msg('x', { templateName: 'cliente_vip_drosa_v1' })])

    const r = await runProcessMessagesDryRun()

    expect(r.otherReasons).toEqual({ not_in_allowlist: 1 })
    expect(r.wouldReachSendStage).toBe(2)
    expect(mocks.metaVerify).toHaveBeenCalledTimes(1) // 1 template/idioma, não 1 por mensagem
  })

  it('mostra o bloqueio real do envio e não avalia cooldown/caps (transparência)', async () => {
    env.AUTOMATION_SEND_ENABLED = false
    setQueue([msg('a')])

    const r = await runProcessMessagesDryRun()

    expect(r.runtime).toMatchObject({ automationSendEnabled: false, realSendBlockedBy: 'automation_send_disabled' })
    expect(r.notEvaluated).toEqual(['runtime_cooldown_lock', 'runtime_batch_limit', 'runtime_per_flow_send_caps'])
    expect(r.wouldReachSendStage).toBe(1) // hipotético: "se o envio estivesse ligado"
  })

  it('saída sem PII: nenhum telefone, nome, id de pedido ou id de mensagem', async () => {
    setQueue([msg('sensitive-id-1'), msg('n', { normalizedPhone: '5583988887777' })])
    mocks.hasConsent.mockResolvedValue(false)

    const r = await runProcessMessagesDryRun()
    const text = JSON.stringify(r)

    expect(text).not.toMatch(/5531998021418|5583988887777|sensitive-id-1|Maria|order-/)
  })

  it('messageIds restringe a consulta e a resposta indica truncamento quando há mais do que o limite', async () => {
    setQueue([msg('a')])
    await runProcessMessagesDryRun({ messageIds: ['a'] })
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ['a'] } }) }))

    mocks.count.mockResolvedValue(1500)
    mocks.findMany.mockResolvedValue([msg('a')])
    const r = await runProcessMessagesDryRun()
    expect(r.truncated).toBe(true)
  })
})

void original
