import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', () => ({
  prisma: { whatsappConsent: { findUnique: vi.fn(), upsert: vi.fn() } },
}))

import { prisma } from '../../config/prisma'
import {
  classifyWhatsappConsent,
  hasActiveWhatsappConsent,
  recordConsentFromNuvemshopOrderExtra,
} from '../../services/whatsappConsentService'

// NUVEMSHOP_STORE_ID em src/__tests__/setup.ts
const STORE_ID = 'test_store_id'

const validGrantedExtra = {
  drosa_whatsapp_marketing_version: 'v1',
  drosa_whatsapp_marketing_store_id: STORE_ID,
  drosa_whatsapp_marketing_source: 'nuvemshop_checkout_whatsapp_optin',
  drosa_whatsapp_marketing_scope: 'marketing',
  drosa_whatsapp_marketing_choice: 'granted',
}

describe('WhatsApp consent registry', () => {
  it.each([
    [null, 'UNKNOWN'],
    [{ consented: true, consentedAt: null, revokedAt: null }, 'UNKNOWN'],
    [{ consented: true, consentedAt: new Date('2026-09-10'), revokedAt: null }, 'GRANTED'],
    [{ consented: false, consentedAt: null, revokedAt: null }, 'REVOKED'],
    [{ consented: false, consentedAt: new Date('2026-09-10'), revokedAt: null }, 'REVOKED'],
    [{ consented: true, consentedAt: null, revokedAt: new Date('2026-09-11') }, 'REVOKED'],
    [{ consented: true, consentedAt: new Date('2026-09-10'), revokedAt: new Date('2026-09-11') }, 'REVOKED'],
    [{ consented: false, consentedAt: new Date('2026-09-10'), revokedAt: new Date('2026-09-11') }, 'REVOKED'],
  ] as const)('classifies consent evidence consistently: %j', async (record, expected) => {
    vi.mocked(prisma.whatsappConsent.findUnique).mockResolvedValue(record as never)
    expect(classifyWhatsappConsent(record)).toBe(expected)
    expect(await hasActiveWhatsappConsent('5531999999999')).toBe(expected === 'GRANTED')
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not query consent registry for an invalid normalized phone', async () => {
    expect(await hasActiveWhatsappConsent('5511000000000')).toBe(false)
    expect(prisma.whatsappConsent.findUnique).not.toHaveBeenCalled()
  })

  it('accepts only an explicit, active and timestamped consent record', async () => {
    vi.mocked(prisma.whatsappConsent.findUnique).mockResolvedValue({
      consented: true,
      consentedAt: new Date('2026-09-10T12:00:00Z'),
      revokedAt: null,
    } as never)

    expect(await hasActiveWhatsappConsent('5531999999999')).toBe(true)
  })

  it.each([
    null,
    { consented: false, consentedAt: new Date('2026-09-10T12:00:00Z'), revokedAt: null },
    { consented: true, consentedAt: null, revokedAt: null },
    { consented: true, consentedAt: new Date('2026-09-10T12:00:00Z'), revokedAt: new Date('2026-09-10T13:00:00Z') },
  ])('fails closed for absent, incomplete or revoked consent', async (record) => {
    vi.mocked(prisma.whatsappConsent.findUnique).mockResolvedValue(record as never)
    expect(await hasActiveWhatsappConsent('5531999999999')).toBe(false)
  })
})

describe('recordConsentFromNuvemshopOrderExtra', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opt-in válido grava GRANTED com consentedAt e limpa revokedAt', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: validGrantedExtra,
      nuvemshopOrderId: '1',
    })

    expect(prisma.whatsappConsent.upsert).toHaveBeenCalledWith({
      where: { normalizedPhone_scope: { normalizedPhone: '5583998765432', scope: 'marketing' } },
      create: expect.objectContaining({
        normalizedPhone: '5583998765432',
        scope: 'marketing',
        source: 'nuvemshop_checkout_whatsapp_optin',
        consented: true,
        revokedAt: null,
      }),
      update: expect.objectContaining({
        consented: true,
        source: 'nuvemshop_checkout_whatsapp_optin',
        revokedAt: null,
      }),
    })
    const call = vi.mocked(prisma.whatsappConsent.upsert).mock.calls[0][0]
    expect(call.create.consentedAt).toBeInstanceOf(Date)
    expect(call.update.consentedAt).toBeInstanceOf(Date)
  })

  it('checkbox nunca marcada (sem marcador em extra) permanece UNKNOWN — nada é gravado', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: undefined,
      nuvemshopOrderId: '2',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it('sinal não relacionado (ex.: opt-in de e-mail) nunca é interpretado como consentimento WhatsApp', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: { accepts_marketing: 'true', marketing_email_optin: 'true' },
      nuvemshopOrderId: '3',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it.each([
    '551199999999',
    '5511000000000',
    '5599999999999',
    '5583123456789',
  ])('telefone normalizado estruturalmente invalido (%s) falha fechado', async (phone) => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: phone,
      extra: validGrantedExtra,
      nuvemshopOrderId: '4-invalid',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it.each([null, undefined, ''])('telefone ausente/inválido (%j) falha fechado — nunca grava', async (phone) => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: phone,
      extra: validGrantedExtra,
      nuvemshopOrderId: '4',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it('source incorreto é rejeitado — nada é gravado', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: { ...validGrantedExtra, drosa_whatsapp_marketing_source: 'outra_origem' },
      nuvemshopOrderId: '5',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it('scope incorreto é rejeitado — nada é gravado', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: { ...validGrantedExtra, drosa_whatsapp_marketing_scope: 'transactional' },
      nuvemshopOrderId: '6',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it('store_id divergente é rejeitado — nada é gravado', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: { ...validGrantedExtra, drosa_whatsapp_marketing_store_id: 'outra_loja' },
      nuvemshopOrderId: '7',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it('choice fora do enum (granted|revoked) é rejeitado — nada é gravado', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: { ...validGrantedExtra, drosa_whatsapp_marketing_choice: 'maybe' },
      nuvemshopOrderId: '8',
    })

    expect(prisma.whatsappConsent.upsert).not.toHaveBeenCalled()
  })

  it('repetição do mesmo opt-in é idempotente (mesma chave única, mesmo resultado)', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: validGrantedExtra,
      nuvemshopOrderId: '9',
    })
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: validGrantedExtra,
      nuvemshopOrderId: '9',
    })

    expect(prisma.whatsappConsent.upsert).toHaveBeenCalledTimes(2)
    const [first, second] = vi.mocked(prisma.whatsappConsent.upsert).mock.calls
    expect(first[0].where).toEqual(second[0].where)
    expect(first[0].create.consented).toBe(second[0].create.consented)
  })

  it('opt-in seguido de revogação grava REVOKED preservando a chave única', async () => {
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: validGrantedExtra,
      nuvemshopOrderId: '10',
    })
    await recordConsentFromNuvemshopOrderExtra({
      normalizedPhone: '5583998765432',
      extra: { ...validGrantedExtra, drosa_whatsapp_marketing_choice: 'revoked' },
      nuvemshopOrderId: '10',
    })

    const calls = vi.mocked(prisma.whatsappConsent.upsert).mock.calls
    const revokeCall = calls[1][0]
    expect(revokeCall.update).toEqual(
      expect.objectContaining({ consented: false, source: 'nuvemshop_checkout_whatsapp_optin' })
    )
    expect(revokeCall.update.revokedAt).toBeInstanceOf(Date)
    expect(revokeCall.update).not.toHaveProperty('consentedAt')
  })
})
