import { afterEach, describe, expect, it } from 'vitest'
import { env } from '../../config/env'
import { isMarketingSendWindowOpen } from '../../jobs/processMessages'

const original = {
  start: env.MARKETING_SEND_HOUR_START,
  end: env.MARKETING_SEND_HOUR_END,
  timeZone: env.MARKETING_TIME_ZONE,
}

afterEach(() => {
  env.MARKETING_SEND_HOUR_START = original.start
  env.MARKETING_SEND_HOUR_END = original.end
  env.MARKETING_TIME_ZONE = original.timeZone
})

describe('isMarketingSendWindowOpen', () => {
  it('aplica 09:00-20:00 no fuso America/Sao_Paulo independentemente do fuso do servidor', () => {
    env.MARKETING_SEND_HOUR_START = 9
    env.MARKETING_SEND_HOUR_END = 20
    env.MARKETING_TIME_ZONE = 'America/Sao_Paulo'

    expect(isMarketingSendWindowOpen(new Date('2026-09-18T11:59:59Z'))).toBe(false) // 08:59:59 BRT
    expect(isMarketingSendWindowOpen(new Date('2026-09-18T12:00:00Z'))).toBe(true)  // 09:00 BRT
    expect(isMarketingSendWindowOpen(new Date('2026-09-18T22:59:59Z'))).toBe(true)  // 19:59:59 BRT
    expect(isMarketingSendWindowOpen(new Date('2026-09-18T23:00:00Z'))).toBe(false) // 20:00 BRT
  })

  it('falha fechado quando o timezone e invalido', () => {
    env.MARKETING_TIME_ZONE = 'Invalid/Timezone'
    expect(isMarketingSendWindowOpen(new Date())).toBe(false)
  })
})
