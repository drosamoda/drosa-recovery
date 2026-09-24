import { afterEach, describe, expect, it, vi } from 'vitest'

describe('email send global readiness gate', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('../../config/env')
    vi.doUnmock('../../services/emailAudienceEngine')
    vi.doUnmock('../../services/emailProviderFactory')
    vi.doUnmock('../../config/prisma')
  })

  it('com infraestrutura técnica pronta, revisão jurídica e EMAIL_SEND_ENABLED continuam bloqueando', async () => {
    vi.resetModules()
    vi.doMock('../../config/env', () => ({
      env: {
        EMAIL_SEND_ENABLED: false,
        EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED: true,
        EMAIL_DOMAIN_AUTHENTICATED: true,
        EMAIL_TRANSFER_MECHANISM_APPROVED: false,
        EMAIL_LEGAL_REVIEW_APPROVED: false,
        NODE_ENV: 'test',
      },
    }))
    vi.doMock('../../services/emailAudienceEngine', () => ({
      EMAIL_MARKETING_CONSENT_SOURCE: 'CONFIGURED',
    }))
    vi.doMock('../../services/emailProviderFactory', () => ({
      isEmailProviderConfigured: () => true,
    }))
    vi.doMock('../../config/prisma', () => ({ prisma: {} }))

    const gate = await import('../../services/emailSendGate')
    expect(gate.evaluateEmailSendGate()).toEqual({
      allowed: false,
      missing: ['EMAIL_TRANSFER_MECHANISM_REQUIRED', 'EMAIL_LEGAL_REVIEW_REQUIRED', 'EMAIL_SEND_DISABLED'],
    })
  })

  it('transferência internacional sem mecanismo aprovado bloqueia mesmo com revisão jurídica e envio ligados', async () => {
    vi.resetModules()
    vi.doMock('../../config/env', () => ({
      env: {
        EMAIL_SEND_ENABLED: true,
        EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED: true,
        EMAIL_DOMAIN_AUTHENTICATED: true,
        EMAIL_TRANSFER_MECHANISM_APPROVED: false,
        EMAIL_LEGAL_REVIEW_APPROVED: true,
        NODE_ENV: 'test',
      },
    }))
    vi.doMock('../../services/emailAudienceEngine', () => ({
      EMAIL_MARKETING_CONSENT_SOURCE: 'CONFIGURED',
    }))
    vi.doMock('../../services/emailProviderFactory', () => ({
      isEmailProviderConfigured: () => true,
    }))
    vi.doMock('../../config/prisma', () => ({ prisma: {} }))

    const gate = await import('../../services/emailSendGate')
    expect(gate.evaluateEmailSendGate()).toEqual({
      allowed: false,
      missing: ['EMAIL_TRANSFER_MECHANISM_REQUIRED'],
    })
  })

  it('mesmo com revisão jurídica aprovada, EMAIL_SEND_ENABLED=false continua sendo a última trava', async () => {
    vi.resetModules()
    vi.doMock('../../config/env', () => ({
      env: {
        EMAIL_SEND_ENABLED: false,
        EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED: true,
        EMAIL_DOMAIN_AUTHENTICATED: true,
        EMAIL_TRANSFER_MECHANISM_APPROVED: true,
        EMAIL_LEGAL_REVIEW_APPROVED: true,
        NODE_ENV: 'test',
      },
    }))
    vi.doMock('../../services/emailAudienceEngine', () => ({
      EMAIL_MARKETING_CONSENT_SOURCE: 'CONFIGURED',
    }))
    vi.doMock('../../services/emailProviderFactory', () => ({
      isEmailProviderConfigured: () => true,
    }))
    vi.doMock('../../config/prisma', () => ({ prisma: {} }))

    const gate = await import('../../services/emailSendGate')
    expect(gate.evaluateEmailSendGate()).toEqual({
      allowed: false,
      missing: ['EMAIL_SEND_DISABLED'],
    })
  })
})
