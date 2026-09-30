import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'

const mocks = vi.hoisted(() => ({
  jobRunFindFirst: vi.fn(),
  messageCount: vi.fn(),
  ruleFindMany: vi.fn(),
  templateFindMany: vi.fn(),
  consentCount: vi.fn(),
  suppressionCount: vi.fn(),
  verifyMetaTemplateContract: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    automationJobRun: { findFirst: mocks.jobRunFindFirst },
    messageLog: { count: mocks.messageCount },
    automationRule: { findMany: mocks.ruleFindMany },
    whatsappTemplate: { findMany: mocks.templateFindMany },
    whatsappConsent: { count: mocks.consentCount },
    suppression: { count: mocks.suppressionCount },
  },
}))

vi.mock('../../services/templateContracts', async () => {
  const actual = await vi.importActual<typeof import('../../services/templateContracts')>('../../services/templateContracts')
  return {
    ...actual,
    verifyMetaTemplateContract: mocks.verifyMetaTemplateContract,
  }
})

import { automationHealth } from '../../jobs/automationHealth'

const original = {
  automationSendEnabled: env.AUTOMATION_SEND_ENABLED,
  whatsappDryRun: env.WHATSAPP_DRY_RUN,
  inboxSendDryRun: env.INBOX_SEND_DRY_RUN,
  abandonedCartEnabled: env.ABANDONED_CART_ENABLED,
  remarketingEnabled: env.REMARKETING_ENABLED,
  allowed: [...env.AUTOMATION_ALLOWED_TEMPLATES],
  metaAccessToken: env.META_ACCESS_TOKEN,
  metaPhoneNumberId: env.META_PHONE_NUMBER_ID,
  metaAppSecret: env.META_APP_SECRET,
  metaWabaId: env.META_WABA_ID,
  nuvemshopAccessToken: env.NUVEMSHOP_ACCESS_TOKEN,
  nuvemshopStoreId: env.NUVEMSHOP_STORE_ID,
}

function setRuns(rows: Array<Record<string, unknown>>): void {
  mocks.jobRunFindFirst.mockImplementation((args: { where: { jobKey: string } }) =>
    Promise.resolve(rows.find((r) => r.jobKey === args.where.jobKey) ?? null),
  )
}

function run(jobKey: string, startedAt: string, status = 'completed', errorCategory: string | null = null): Record<string, unknown> {
  return { jobKey, status, startedAt: new Date(startedAt), finishedAt: new Date(startedAt), durationMs: 100, summary: {}, errorCategory }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.messageCount.mockResolvedValue(0)
  mocks.ruleFindMany.mockResolvedValue([])
  mocks.templateFindMany.mockResolvedValue([])
  mocks.consentCount.mockResolvedValue(0)
  mocks.suppressionCount.mockResolvedValue(0)
  mocks.verifyMetaTemplateContract.mockResolvedValue(null)
  setRuns([])
})

afterEach(() => {
  vi.useRealTimers()
  env.AUTOMATION_SEND_ENABLED = original.automationSendEnabled
  env.WHATSAPP_DRY_RUN = original.whatsappDryRun
  env.INBOX_SEND_DRY_RUN = original.inboxSendDryRun
  env.ABANDONED_CART_ENABLED = original.abandonedCartEnabled
  env.REMARKETING_ENABLED = original.remarketingEnabled
  env.AUTOMATION_ALLOWED_TEMPLATES = [...original.allowed]
  env.META_ACCESS_TOKEN = original.metaAccessToken
  env.META_PHONE_NUMBER_ID = original.metaPhoneNumberId
  env.META_APP_SECRET = original.metaAppSecret
  env.META_WABA_ID = original.metaWabaId
  env.NUVEMSHOP_ACCESS_TOKEN = original.nuvemshopAccessToken
  env.NUVEMSHOP_STORE_ID = original.nuvemshopStoreId
})

describe('automationHealth send safety', () => {
  it('reports the manual Inbox gate independently from automation send gates', async () => {
    env.INBOX_SEND_DRY_RUN = true
    let health = await automationHealth()
    expect(health).toMatchObject({
      inboxSendDryRun: true,
      manualInboxRealSendArmed: false,
    })

    env.INBOX_SEND_DRY_RUN = false
    health = await automationHealth()
    expect(health).toMatchObject({
      inboxSendDryRun: false,
      manualInboxRealSendArmed: true,
    })
  })

  it('reports allowlist as mandatory when real-send gates are armed', async () => {
    env.AUTOMATION_SEND_ENABLED = true
    env.WHATSAPP_DRY_RUN = false
    env.AUTOMATION_ALLOWED_TEMPLATES = []

    const health = await automationHealth()

    expect(health).toMatchObject({
      databaseReachable: true,
      sendBlockReason: 'automation_allowlist_required',
      realSendConfigArmed: false,
    })
  })

  it('only reports real-send config armed with explicit allowlist', async () => {
    env.AUTOMATION_SEND_ENABLED = true
    env.WHATSAPP_DRY_RUN = false
    env.AUTOMATION_ALLOWED_TEMPLATES = ['carrinho_abandonado_drosa_v2']
    env.ABANDONED_CART_ENABLED = true
    mocks.templateFindMany.mockResolvedValue([{
      id: 'tpl-cart',
      metaTemplateName: 'carrinho_abandonado_drosa_v2',
      languageCode: 'pt_BR',
      category: 'marketing',
    }])

    const health = await automationHealth()

    expect(health).toMatchObject({
      sendBlockReason: null,
      realSendConfigArmed: true,
      abandonedCartRealSendArmed: true,
      automationAllowedTemplates: ['carrinho_abandonado_drosa_v2'],
    })
  })

  it('reports preflight ready only when DB structure and Meta contracts are coherent', async () => {
    env.META_ACCESS_TOKEN = 'meta-token'
    env.META_PHONE_NUMBER_ID = 'phone-id'
    env.META_APP_SECRET = 'app-secret'
    env.META_WABA_ID = 'waba-id'
    env.NUVEMSHOP_ACCESS_TOKEN = 'nuvem-token'
    env.NUVEMSHOP_STORE_ID = '7716231'

    mocks.ruleFindMany.mockResolvedValue([
      { id: 'rule_abandoned_checkout', eventType: 'abandoned_checkout', templateName: 'carrinho_abandonado_drosa_v2' },
    ])
    mocks.templateFindMany.mockResolvedValue([
      {
        id: 'tpl_abandoned_checkout',
        metaTemplateName: 'carrinho_abandonado_drosa_v2',
        languageCode: 'pt_BR',
        category: 'marketing',
      },
    ])
    mocks.consentCount.mockResolvedValue(3)
    mocks.suppressionCount.mockResolvedValue(2)

    const health = await automationHealth()

    expect(health).toMatchObject({
      databaseReachable: true,
      preflightReady: true,
      readinessIssues: [],
      activeRules: 1,
      activeTemplates: 1,
      activeMarketingConsents: 3,
      suppressedContacts: 2,
      metaTemplateChecks: [{ name: 'carrinho_abandonado_drosa_v2', error: null }],
      canonicalTemplatesReady: true,
    })
    expect(health.canonicalTemplateNames).toContain('cliente_recente_drosa_v2')
    expect(health.canonicalMetaTemplateChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'cliente_recente_drosa_v2', activeByDefault: false, error: null }),
      expect.objectContaining({ name: 'cliente_vip_drosa_v1', activeByDefault: false, error: null }),
    ]))
  })

  it('keeps global preflight strict while allowing a healthy explicit send scope', async () => {
    env.META_ACCESS_TOKEN = 'meta-token'
    env.META_PHONE_NUMBER_ID = 'phone-id'
    env.META_APP_SECRET = 'app-secret'
    env.META_WABA_ID = 'waba-id'
    env.NUVEMSHOP_ACCESS_TOKEN = 'nuvem-token'
    env.NUVEMSHOP_STORE_ID = '7716231'
    env.AUTOMATION_ALLOWED_TEMPLATES = ['carrinho_abandonado_drosa_v2']

    mocks.ruleFindMany.mockResolvedValue([
      { id: 'rule-order', eventType: 'order_created', templateName: 'confirmacao_pedido_drosa' },
      { id: 'rule-cart', eventType: 'abandoned_checkout', templateName: 'carrinho_abandonado_drosa_v2' },
    ])
    mocks.templateFindMany.mockResolvedValue([
      {
        id: 'tpl-order',
        metaTemplateName: 'confirmacao_pedido_drosa',
        languageCode: 'pt_BR',
        category: 'utility',
      },
      {
        id: 'tpl-cart',
        metaTemplateName: 'carrinho_abandonado_drosa_v2',
        languageCode: 'pt_BR',
        category: 'marketing',
      },
    ])
    mocks.verifyMetaTemplateContract.mockImplementation(async (name: string) =>
      name === 'confirmacao_pedido_drosa' ? 'template_contract_mismatch' : null
    )

    const health = await automationHealth()

    expect(health.preflightReady).toBe(false)
    expect(health.sendScopeReady).toBe(true)
    expect(health.sendScopeTemplates).toEqual(['carrinho_abandonado_drosa_v2'])
    expect(health.sendScopeMetaTemplateChecks).toEqual([
      { name: 'carrinho_abandonado_drosa_v2', error: null },
    ])
    expect(health.readinessIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'meta_template_not_ready',
        detail: 'confirmacao_pedido_drosa: template_contract_mismatch',
      }),
    ]))
    expect(health.sendScopeIssues).toEqual([])
  })

  it('fails preflight when stale pending messages remain in the queue', async () => {
    env.META_ACCESS_TOKEN = 'meta-token'
    env.META_PHONE_NUMBER_ID = 'phone-id'
    env.META_APP_SECRET = 'app-secret'
    env.META_WABA_ID = 'waba-id'
    env.NUVEMSHOP_ACCESS_TOKEN = 'nuvem-token'
    env.NUVEMSHOP_STORE_ID = '7716231'

    mocks.messageCount.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: { status?: string; scheduledAt?: unknown } })?.where
      if (where?.status === 'pending' && where.scheduledAt) return 4
      return 0
    })

    const health = await automationHealth()

    expect(health.preflightReady).toBe(false)
    expect(health).toMatchObject({ stalePendingMessages: 4 })
    expect(health.readinessIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'stale_pending_messages', detail: '4' }),
    ]))
  })

  it('fails preflight when blocked legacy messages are still pending', async () => {
    env.META_ACCESS_TOKEN = 'meta-token'
    env.META_PHONE_NUMBER_ID = 'phone-id'
    env.META_APP_SECRET = 'app-secret'
    env.META_WABA_ID = 'waba-id'
    env.NUVEMSHOP_ACCESS_TOKEN = 'nuvem-token'
    env.NUVEMSHOP_STORE_ID = '7716231'

    mocks.messageCount.mockImplementation(async (args: unknown) => {
      const where = (args as { where?: { status?: string; templateName?: unknown } })?.where
      if (where?.status === 'pending' && where.templateName) return 3
      return 0
    })

    const health = await automationHealth()

    expect(health.preflightReady).toBe(false)
    expect(health).toMatchObject({ legacyPendingMessages: 3 })
    expect(health.readinessIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'legacy_pending_messages', detail: '3' }),
    ]))
  })

  it('fails preflight closed when an active rule has no active template or expired claims exist', async () => {
    env.META_ACCESS_TOKEN = 'meta-token'
    env.META_PHONE_NUMBER_ID = 'phone-id'
    env.META_APP_SECRET = 'app-secret'
    env.META_WABA_ID = 'waba-id'
    env.NUVEMSHOP_ACCESS_TOKEN = 'nuvem-token'
    env.NUVEMSHOP_STORE_ID = '7716231'

    mocks.ruleFindMany.mockResolvedValue([
      { id: 'rule-cart', eventType: 'abandoned_checkout', templateName: 'carrinho_abandonado_drosa_v2' },
    ])
    mocks.templateFindMany.mockResolvedValue([])
    mocks.messageCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2)

    const health = await automationHealth()

    expect(health.preflightReady).toBe(false)
    expect(health.readinessIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'active_rule_without_active_template' }),
      expect.objectContaining({ code: 'expired_processing_claims' }),
    ]))
  })
})

describe('automationHealth job freshness', () => {
  it('never_run quando não existe nenhuma execução', async () => {
    const health = await automationHealth()
    expect(health.jobFreshness).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobKey: 'process_messages', timing: 'never_run', lastResult: null, healthy: false }),
      expect.objectContaining({ jobKey: 'sync_abandoned_checkouts', timing: 'never_run', healthy: false }),
      expect.objectContaining({ jobKey: 'sync_boleto_expiring', timing: 'never_run', healthy: false }),
    ]))
  })

  it('fresh + completed dentro do limiar = healthy', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
    setRuns([run('process_messages', '2026-09-28T11:58:30Z')])
    const health = await automationHealth()
    expect(health.jobFreshness).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobKey: 'process_messages', timing: 'fresh', lastResult: 'completed', healthy: true }),
    ]))
  })

  it('stale quando a última execução passou do limiar', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
    setRuns([run('sync_boleto_expiring', '2026-09-28T09:00:00Z')]) // 180 min, limiar 120
    const health = await automationHealth()
    expect(health.jobFreshness).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobKey: 'sync_boleto_expiring', timing: 'stale', healthy: false }),
    ]))
  })

  it('fresh porém última execução failed NÃO é healthy e expõe só a categoria fechada', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
    setRuns([run('process_messages', '2026-09-28T11:59:00Z', 'failed', 'database_unreachable')])
    const health = await automationHealth()
    expect(health.jobFreshness).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobKey: 'process_messages', timing: 'fresh', lastResult: 'failed', healthy: false, errorCategory: 'database_unreachable' }),
    ]))
  })

  it('tabela ausente / consulta falha: jobFreshness null, sem derrubar o health', async () => {
    mocks.jobRunFindFirst.mockRejectedValue(Object.assign(new Error('relation "automation_job_runs" does not exist'), { code: 'P2021' }))
    const health = await automationHealth()
    expect(health.databaseReachable).toBe(true)
    expect(health.jobFreshness).toBeNull()
    expect(JSON.stringify(health)).not.toMatch(/does not exist/)
  })

  it('ENABLE_INTERNAL_CRON=false sozinho não é incidente quando os jobs externos estão em dia', async () => {
    env.ENABLE_INTERNAL_CRON = false
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
    setRuns([
      run('process_messages', '2026-09-28T11:59:00Z'),
      run('sync_abandoned_checkouts', '2026-09-28T11:30:00Z'),
      run('sync_boleto_expiring', '2026-09-28T11:00:00Z'),
    ])
    const health = await automationHealth()
    expect(health.cronEnabled).toBe(false)
    expect(health.jobFreshness?.every((e) => e.healthy)).toBe(true)
    expect(health.readinessIssues.some((issue) => issue.code.includes('cron'))).toBe(false)
  })
})
