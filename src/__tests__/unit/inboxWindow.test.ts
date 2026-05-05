import { describe, expect, it } from 'vitest'
import { isWithinWhatsappCustomerCareWindow } from '../../helpers/inboxWindow'

describe('isWithinWhatsappCustomerCareWindow', () => {
  it('permite resposta livre ate 24h apos a ultima mensagem inbound', () => {
    const now = new Date('2026-05-05T12:00:00.000Z')
    const lastInboundAt = new Date('2026-05-04T12:00:01.000Z')

    expect(isWithinWhatsappCustomerCareWindow(lastInboundAt, now)).toBe(true)
  })

  it('bloqueia resposta livre fora da janela de 24h', () => {
    const now = new Date('2026-05-05T12:00:00.000Z')
    const lastInboundAt = new Date('2026-05-04T11:59:59.000Z')

    expect(isWithinWhatsappCustomerCareWindow(lastInboundAt, now)).toBe(false)
  })

  it('bloqueia resposta livre quando nao existe mensagem inbound', () => {
    expect(isWithinWhatsappCustomerCareWindow(null, new Date())).toBe(false)
  })
})
