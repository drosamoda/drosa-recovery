import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockEnv = vi.hoisted(() => ({
  EMAIL_PROVIDER: 'none',
  RESEND_API_KEY: '',
  RESEND_WEBHOOK_SECRET: '',
}))

vi.mock('../../config/env', () => ({ env: mockEnv }))

import { getEmailProviderAdapter, isEmailProviderConfigured } from '../../services/emailProviderFactory'

describe('emailProviderFactory', () => {
  beforeEach(() => {
    mockEnv.EMAIL_PROVIDER = 'none'
    mockEnv.RESEND_API_KEY = ''
    mockEnv.RESEND_WEBHOOK_SECRET = ''
  })

  it('fica fail-closed sem provider', () => {
    expect(isEmailProviderConfigured()).toBe(false)
    expect(getEmailProviderAdapter()).toBeNull()
  })

  it('fica fail-closed se Resend estiver selecionado mas faltar qualquer segredo', () => {
    mockEnv.EMAIL_PROVIDER = 'resend'
    mockEnv.RESEND_API_KEY = 're_test'
    expect(isEmailProviderConfigured()).toBe(false)
    expect(getEmailProviderAdapter()).toBeNull()
  })

  it('cria o adapter Resend somente com seleção + API key + webhook secret', () => {
    mockEnv.EMAIL_PROVIDER = 'resend'
    mockEnv.RESEND_API_KEY = 're_test'
    mockEnv.RESEND_WEBHOOK_SECRET = 'whsec_test'
    expect(isEmailProviderConfigured()).toBe(true)
    expect(getEmailProviderAdapter()?.name).toBe('resend')
  })
})
