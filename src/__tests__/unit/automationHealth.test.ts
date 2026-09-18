import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'

const mocks = vi.hoisted(() => ({
  messageCount: vi.fn(),
  ruleFindMany: vi.fn(),
  templateFindMany: vi.fn(),
  consentCount: vi.fn(),
  suppressionCount: vi.fn(),
  verifyMetaTemplateContract: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.messageCount.mockResolvedValue(0)
  mocks.ruleFindMany.mockResolvedValue([])
  mocks.templateFindMany.mockResolvedValue([])
  mocks.consentCount.mockResolvedValue(0)
  mocks.suppressionCount.mockResolvedValue(0)
  mocks.verifyMetaTemplateContract.mockResolvedValue(null)
})

afterEach(() => {
  env.AUTOMATION_SEND_ENABLED = original.automationSendEnabled
  env.WHATSAPP_DRY_RUN = original.whatsappDryRun
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
    })
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
