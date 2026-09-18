import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'

const mocks = vi.hoisted(() => ({
  messageCount: vi.fn(),
  ruleCount: vi.fn(),
  templateCount: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    messageLog: { count: mocks.messageCount },
    automationRule: { count: mocks.ruleCount },
    whatsappTemplate: { count: mocks.templateCount },
  },
}))

import { automationHealth } from '../../jobs/automationHealth'

const original = {
  automationSendEnabled: env.AUTOMATION_SEND_ENABLED,
  whatsappDryRun: env.WHATSAPP_DRY_RUN,
  abandonedCartEnabled: env.ABANDONED_CART_ENABLED,
  remarketingEnabled: env.REMARKETING_ENABLED,
  allowed: [...env.AUTOMATION_ALLOWED_TEMPLATES],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.messageCount.mockResolvedValue(0)
  mocks.ruleCount.mockResolvedValue(0)
  mocks.templateCount.mockResolvedValue(0)
})

afterEach(() => {
  env.AUTOMATION_SEND_ENABLED = original.automationSendEnabled
  env.WHATSAPP_DRY_RUN = original.whatsappDryRun
  env.ABANDONED_CART_ENABLED = original.abandonedCartEnabled
  env.REMARKETING_ENABLED = original.remarketingEnabled
  env.AUTOMATION_ALLOWED_TEMPLATES = [...original.allowed]
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

    const health = await automationHealth()

    expect(health).toMatchObject({
      sendBlockReason: null,
      realSendConfigArmed: true,
      abandonedCartRealSendArmed: true,
      automationAllowedTemplates: ['carrinho_abandonado_drosa_v2'],
    })
  })
})
