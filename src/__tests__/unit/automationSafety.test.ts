import { describe, expect, it } from 'vitest'
import { env } from '../../config/env'
import { shouldStartInternalCron } from '../../index'

describe('automation safety defaults', () => {
  it('nao inicia cron quando a flag explicita esta ausente ou false', () => {
    expect(shouldStartInternalCron(false)).toBe(false)
    expect(env.ENABLE_INTERNAL_CRON).toBe(false)
  })

  it('mantem remarketing desligado por padrao no ambiente de teste', () => {
    expect(env.REMARKETING_ENABLED).toBe(false)
  })
})
