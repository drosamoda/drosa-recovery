import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config/prisma', async () => {
  const { trackingDb } = await import('../fixtures/inMemoryTrackingDb')
  return { prisma: trackingDb.prisma }
})

import { emailDb } from '../fixtures/inMemoryEmailDb'
import { trackingDb } from '../fixtures/inMemoryTrackingDb'
import { MockEmailProvider, signMockWebhook, MOCK_SIGNATURE_HEADER } from '../fixtures/mockEmailProvider'
import { hashEmail } from '../../services/emailConsentService'
import { InvalidWebhookSignatureError, NormalizedEmailEvent } from '../../services/emailProviderAdapter'
import {
  attributePurchase,
  buildSendKey,
  claimEmailSend,
  EMAIL_ATTRIBUTION_MODEL,
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
  EmailSendNotClaimableError,
  hasRecentEmailSend,
  ingestProviderWebhook,
  InvalidTrackingInputError,
  markEmailSendFailed,
  markEmailSendSent,
  recordProviderEmailEvent,
  reserveEmailSend,
} from '../../services/emailTrackingService'

const PEPPER = 'p'.repeat(40)
const ANA = 'ana@example.com'
const BIA = 'bia@example.com'
const T0 = new Date('2026-09-10T12:00:00Z')
const DAY = 86_400_000
const hash = (email: string): string => hashEmail(email, PEPPER)

beforeEach(() => {
  trackingDb.reset()
})

async function sentSend(email = ANA, campaignKey = 'CAMP_A', providerMessageId = 'm1') {
  const { sendId } = await reserveEmailSend({ emailHash: hash(email), campaignKey })
  await claimEmailSend(sendId, hash(email))
  await markEmailSendSent(sendId, { provider: 'mock', providerMessageId, at: T0 })
  return sendId
}

function providerEvent(overrides: Partial<NormalizedEmailEvent> = {}): NormalizedEmailEvent {
  return {
    provider: 'mock',
    providerEventId: 'e1',
    type: 'DELIVERED',
    providerMessageId: null,
    recipient: ANA,
    occurredAt: T0,
    sendId: null,
    campaignKey: null,
    ...overrides,
  }
}

const statusOf = (sendId: string): string | undefined => trackingDb.sends.find((s) => s.id === sendId)?.status

describe('buildSendKey / reserveEmailSend — idempotência da tentativa', () => {
  it('monta a chave por campanha, onda e destinatário', () => {
    expect(buildSendKey({ emailHash: 'a'.repeat(64), campaignKey: 'CAMP_X' })).toBe(`CAMP_X:1:${'a'.repeat(64)}`)
    expect(buildSendKey({ emailHash: 'a'.repeat(64), campaignKey: 'CAMP_X', wave: '2' })).toBe(`CAMP_X:2:${'a'.repeat(64)}`)
  })

  it.each([
    [{ emailHash: 'curto', campaignKey: 'CAMP_X' }],
    [{ emailHash: 'a'.repeat(64), campaignKey: 'a b' }],
    [{ emailHash: 'a'.repeat(64), campaignKey: 'CAMP_X', wave: 'x y' }],
  ])('recusa entrada inválida %j', (input) => {
    expect(() => buildSendKey(input)).toThrow(InvalidTrackingInputError)
  })

  it('reservar duas vezes a mesma tentativa devolve a MESMA linha; outra onda ou campanha cria outra', async () => {
    const first = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    const again = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    expect(first).toMatchObject({ created: true, status: 'QUEUED' })
    expect(again).toMatchObject({ created: false, sendId: first.sendId })

    const otherWave = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A', wave: '2' })
    const otherCampaign = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_B' })
    expect(new Set([first.sendId, otherWave.sendId, otherCampaign.sendId]).size).toBe(3)
    expect(trackingDb.sends).toHaveLength(3)
  })
})

describe('claimEmailSend — claim atômico QUEUED -> SENDING', () => {
  it('o primeiro claim vence e conta a tentativa; o segundo é recusado (NOT_QUEUED)', async () => {
    const { sendId } = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    await claimEmailSend(sendId, hash(ANA))
    expect(trackingDb.sends[0]).toMatchObject({ status: 'SENDING', attempts: 1 })
    await expect(claimEmailSend(sendId, hash(ANA))).rejects.toMatchObject({ reason: 'NOT_QUEUED' })
  })

  it('dois claims concorrentes: exatamente UM vence', async () => {
    const { sendId } = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    const results = await Promise.allSettled([claimEmailSend(sendId, hash(ANA)), claimEmailSend(sendId, hash(ANA))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    expect(trackingDb.sends[0].attempts).toBe(1)
  })

  it('recusa claim de OUTRO destinatário e id inexistente, sem alterar a tentativa', async () => {
    const { sendId } = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    await expect(claimEmailSend(sendId, hash(BIA))).rejects.toMatchObject({ reason: 'RECIPIENT_MISMATCH' })
    await expect(claimEmailSend('nao_existe', hash(ANA))).rejects.toMatchObject({ reason: 'NOT_FOUND' })
    expect(trackingDb.sends[0]).toMatchObject({ status: 'QUEUED', attempts: 0 })
    await expect(claimEmailSend(sendId, hash(BIA))).rejects.toBeInstanceOf(EmailSendNotClaimableError)
  })
})

describe('markEmailSendSent / markEmailSendFailed', () => {
  it('SENDING vira SENT, grava os campos do provedor e UM evento SENT (idempotente)', async () => {
    const sendId = await sentSend()
    expect(trackingDb.sends[0]).toMatchObject({ status: 'SENT', provider: 'mock', providerMessageId: 'm1', sentAt: T0 })
    await markEmailSendSent(sendId, { provider: 'mock', providerMessageId: 'm1', at: T0 })
    expect(trackingDb.events.filter((e) => e.type === 'SENT')).toHaveLength(1)
    expect(trackingDb.events[0]).toMatchObject({ providerEventId: `sent:${sendId}`, sendId, campaignKey: 'CAMP_A' })
  })

  it('um DELIVERED que chegou ANTES do registro do envio não é rebaixado, mas os campos do provedor são gravados', async () => {
    const { sendId } = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    await claimEmailSend(sendId, hash(ANA))
    await recordProviderEmailEvent(providerEvent({ sendId }), PEPPER)
    expect(statusOf(sendId)).toBe('DELIVERED')
    await markEmailSendSent(sendId, { provider: 'mock', providerMessageId: 'm9', at: T0 })
    expect(trackingDb.sends[0]).toMatchObject({ status: 'DELIVERED', providerMessageId: 'm9' })
  })

  it('falha temporária volta a QUEUED e permite novo claim; falha definitiva vira FAILED', async () => {
    const { sendId } = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    await claimEmailSend(sendId, hash(ANA))
    await markEmailSendFailed(sendId, { retryable: true, reason: 'PROVIDER_TEMPORARY' })
    expect(trackingDb.sends[0]).toMatchObject({ status: 'QUEUED', failureReason: 'PROVIDER_TEMPORARY' })
    await claimEmailSend(sendId, hash(ANA))
    expect(trackingDb.sends[0].attempts).toBe(2)

    await markEmailSendFailed(sendId, { retryable: false, reason: 'PROVIDER_REJECTED' })
    expect(trackingDb.sends[0].status).toBe('FAILED')
    await expect(claimEmailSend(sendId, hash(ANA))).rejects.toMatchObject({ reason: 'NOT_QUEUED' })
  })

  it('o motivo precisa ser um código em maiúsculas (nunca texto livre) e só age sobre SENDING', async () => {
    const { sendId } = await reserveEmailSend({ emailHash: hash(ANA), campaignKey: 'CAMP_A' })
    await expect(markEmailSendFailed(sendId, { retryable: false, reason: 'ana@example.com recusou' })).rejects.toThrow(InvalidTrackingInputError)
    await markEmailSendFailed(sendId, { retryable: false, reason: 'PROVIDER_REJECTED' }) // ainda QUEUED: nada muda
    expect(trackingDb.sends[0].status).toBe('QUEUED')
  })
})

describe('recordProviderEmailEvent — vínculo, monotonicidade e replay', () => {
  it('DELIVERED vinculado por sendId avança o status; o replay não duplica nem muda nada', async () => {
    const sendId = await sentSend()
    const first = await recordProviderEmailEvent(providerEvent({ sendId }), PEPPER)
    expect(first).toMatchObject({ recorded: true, linkedToSend: true, suppression: 'IGNORED' })
    expect(statusOf(sendId)).toBe('DELIVERED')

    const replay = await recordProviderEmailEvent(providerEvent({ sendId }), PEPPER)
    expect(replay.recorded).toBe(false)
    expect(trackingDb.events.filter((e) => e.provider === 'mock')).toHaveLength(1)
  })

  it('vincula também só pelo providerMessageId', async () => {
    const sendId = await sentSend(ANA, 'CAMP_A', 'm1')
    const outcome = await recordProviderEmailEvent(providerEvent({ providerMessageId: 'm1' }), PEPPER)
    expect(outcome.linkedToSend).toBe(true)
    expect(statusOf(sendId)).toBe('DELIVERED')
  })

  it('evento atrasado nunca rebaixa: DELIVERED depois de HARD_BOUNCE mantém HARD_BOUNCED; SOFT_BOUNCE < DELIVERED', async () => {
    const hardId = await sentSend(ANA, 'CAMP_A', 'm1')
    await recordProviderEmailEvent(providerEvent({ providerEventId: 'e2', type: 'HARD_BOUNCE', sendId: hardId }), PEPPER)
    await recordProviderEmailEvent(providerEvent({ providerEventId: 'e3', type: 'DELIVERED', sendId: hardId }), PEPPER)
    expect(statusOf(hardId)).toBe('HARD_BOUNCED')

    const softId = await sentSend(BIA, 'CAMP_A', 'm2')
    await recordProviderEmailEvent(providerEvent({ providerEventId: 'e4', type: 'SOFT_BOUNCE', recipient: BIA, sendId: softId }), PEPPER)
    expect(statusOf(softId)).toBe('SOFT_BOUNCED')
    await recordProviderEmailEvent(providerEvent({ providerEventId: 'e5', type: 'DELIVERED', recipient: BIA, sendId: softId }), PEPPER)
    expect(statusOf(softId)).toBe('DELIVERED')
  })

  it('um sendId de OUTRO destinatário não vincula nem mexe no envio alheio', async () => {
    const anaSend = await sentSend(ANA, 'CAMP_A', 'm1')
    const outcome = await recordProviderEmailEvent(providerEvent({ recipient: BIA, sendId: anaSend }), PEPPER)
    expect(outcome).toMatchObject({ recorded: true, linkedToSend: false })
    expect(statusOf(anaSend)).toBe('SENT')
    expect(trackingDb.events.find((e) => e.providerEventId === 'e1')?.sendId).toBeNull()
  })

  it('HARD_BOUNCE suprime o endereço (sem evento de consentimento); replay dá ALREADY_SUPPRESSED', async () => {
    const sendId = await sentSend()
    const first = await recordProviderEmailEvent(providerEvent({ type: 'HARD_BOUNCE', sendId }), PEPPER)
    expect(first.suppression).toBe('SUPPRESSED')
    expect(emailDb.suppressions.get(hash(ANA))?.reason).toBe('HARD_BOUNCE')
    expect(emailDb.events).toHaveLength(0)
    expect((await recordProviderEmailEvent(providerEvent({ type: 'HARD_BOUNCE', sendId }), PEPPER)).suppression).toBe('ALREADY_SUPPRESSED')
  })

  it('SPAM_COMPLAINT vira COMPLAINED, suprime e revoga o consentimento no livro-razão', async () => {
    const sendId = await sentSend()
    await recordProviderEmailEvent(providerEvent({ type: 'SPAM_COMPLAINT', sendId }), PEPPER)
    expect(statusOf(sendId)).toBe('COMPLAINED')
    expect(emailDb.suppressions.has(hash(ANA))).toBe(true)
    expect(emailDb.events).toHaveLength(1)
    expect(emailDb.events[0]).toMatchObject({ status: 'OPT_OUT', source: 'PROVIDER_EVENT' })
  })

  it.each(['OPEN', 'CLICK', 'DEFERRED', 'BLOCKED'] as const)('%s é registrado mas não muda o status nem suprime', async (type) => {
    const sendId = await sentSend()
    const outcome = await recordProviderEmailEvent(providerEvent({ providerEventId: `e_${type}`, type, sendId }), PEPPER)
    expect(outcome).toMatchObject({ recorded: true, suppression: 'IGNORED' })
    expect(statusOf(sendId)).toBe('SENT')
    expect(emailDb.suppressions.size).toBe(0)
  })

  it('o replay CURA uma supressão perdida: evento já gravado, supressão ausente', async () => {
    trackingDb.events.push({
      id: 'evt_pre', provider: 'mock', providerEventId: 'e9', type: 'HARD_BOUNCE', emailHash: hash(ANA), sendId: null,
      campaignKey: null, occurredAt: T0, orderId: null, revenue: null, currency: null, attributionModel: null,
    })
    expect(emailDb.suppressions.size).toBe(0)
    const outcome = await recordProviderEmailEvent(providerEvent({ providerEventId: 'e9', type: 'HARD_BOUNCE' }), PEPPER)
    expect(outcome).toMatchObject({ recorded: false, suppression: 'SUPPRESSED' })
    expect(emailDb.suppressions.has(hash(ANA))).toBe(true)
  })

  it('se a supressão falha, o evento NÃO é registrado (o provedor reenvia) e a nova tentativa funciona', async () => {
    const sendId = await sentSend()
    emailDb.failNextLedgerWrite = true
    await expect(recordProviderEmailEvent(providerEvent({ type: 'SPAM_COMPLAINT', sendId }), PEPPER)).rejects.toThrow()
    expect(trackingDb.events.filter((e) => e.provider === 'mock')).toHaveLength(0)
    expect(emailDb.suppressions.size).toBe(0)

    const retry = await recordProviderEmailEvent(providerEvent({ type: 'SPAM_COMPLAINT', sendId }), PEPPER)
    expect(retry).toMatchObject({ recorded: true, suppression: 'SUPPRESSED' })
  })
})

describe('ingestProviderWebhook — assinatura sobre o corpo bruto e replay', () => {
  const SECRET = 'whsec'
  function body(sendId: string): string {
    return JSON.stringify([
      { id: 'w1', type: 'DELIVERED', email: ANA, timestamp: 1_789_000_000, messageId: 'm1', sendId },
      { id: 'w2', type: 'HARD_BOUNCE', email: ANA, timestamp: 1_789_000_100, sendId },
      { id: 'w3', type: 'OPEN', email: 'nao-e-um-email', timestamp: 1_789_000_200 },
    ])
  }
  const request = (raw: string, signature = signMockWebhook(raw, SECRET)) => ({ rawBody: raw, headers: { [MOCK_SIGNATURE_HEADER]: signature } })

  it('assinatura inválida: lança e NADA é gravado (nem evento nem supressão)', async () => {
    const sendId = await sentSend()
    const provider = new MockEmailProvider(SECRET)
    const raw = body(sendId)
    await expect(ingestProviderWebhook(provider, request(raw, 'assinatura-errada'), PEPPER)).rejects.toBeInstanceOf(InvalidWebhookSignatureError)
    await expect(ingestProviderWebhook(provider, request(raw.replace('w2', 'wX'), signMockWebhook(raw, SECRET)), PEPPER)).rejects.toBeInstanceOf(InvalidWebhookSignatureError)
    expect(trackingDb.events.filter((e) => e.provider === 'mock')).toHaveLength(0)
    expect(emailDb.suppressions.size).toBe(0)
  })

  it('lote válido grava, suprime e descarta o destinatário fora do formato; o replay só conta duplicatas', async () => {
    const sendId = await sentSend()
    const provider = new MockEmailProvider(SECRET)

    const first = await ingestProviderWebhook(provider, request(body(sendId)), PEPPER)
    expect(first).toEqual({ received: 3, recorded: 2, duplicates: 0, unlinked: 0, suppressed: 1, rejected: 1 })
    expect(statusOf(sendId)).toBe('HARD_BOUNCED')

    const replay = await ingestProviderWebhook(provider, request(body(sendId)), PEPPER)
    expect(replay).toEqual({ received: 3, recorded: 0, duplicates: 2, unlinked: 0, suppressed: 0, rejected: 1 })
    expect(trackingDb.events.filter((e) => e.provider === 'mock')).toHaveLength(2)
  })
})

describe('attributePurchase — último clique em 7 dias, abertura nunca atribui', () => {
  async function click(sendId: string, at: Date, email = ANA, id = `c_${at.getTime()}`, type: 'CLICK' | 'OPEN' = 'CLICK') {
    await recordProviderEmailEvent(providerEvent({ providerEventId: id, type, recipient: email, sendId, occurredAt: at }), PEPPER)
  }
  const order = (overrides: Partial<Parameters<typeof attributePurchase>[0]> = {}) => ({
    email: ANA, orderId: '1001', total: 199.9, orderedAt: new Date(T0.getTime() + 2 * DAY), ...overrides,
  })

  it('a janela é de 7 dias e o modelo é LAST_CLICK_7D', () => {
    expect(EMAIL_ATTRIBUTION_WINDOW_DAYS).toBe(7)
    expect(EMAIL_ATTRIBUTION_MODEL).toBe('LAST_CLICK_7D')
  })

  it('atribui a compra ao envio do clique, com receita, moeda e modelo; repetir dá DUPLICATE', async () => {
    const sendId = await sentSend()
    await click(sendId, new Date(T0.getTime() + DAY))

    expect(await attributePurchase(order(), PEPPER)).toBe('ATTRIBUTED')
    const purchase = trackingDb.events.find((e) => e.type === 'PURCHASE')
    expect(purchase).toMatchObject({
      provider: 'CRM', providerEventId: 'purchase:1001', sendId, campaignKey: 'CAMP_A',
      orderId: '1001', currency: 'BRL', attributionModel: 'LAST_CLICK_7D',
    })
    expect(String(purchase?.revenue)).toBe('199.9')

    expect(await attributePurchase(order(), PEPPER)).toBe('DUPLICATE')
    expect(trackingDb.events.filter((e) => e.type === 'PURCHASE')).toHaveLength(1)
  })

  // Cada caso isolado (própria tentativa/e-mail/pedido) para nenhum clique de um
  // caso contaminar a janela de outro dentro do teste.
  it('sem nenhum clique: não atribui', async () => {
    await sentSend()
    expect(await attributePurchase(order(), PEPPER)).toBe('NOT_ATTRIBUTED')
    expect(trackingDb.events.filter((e) => e.type === 'PURCHASE')).toHaveLength(0)
  })

  it('só abertura (sem clique): não atribui', async () => {
    const sendId = await sentSend()
    await click(sendId, new Date(T0.getTime() + DAY), ANA, 'o1', 'OPEN')
    expect(await attributePurchase(order(), PEPPER)).toBe('NOT_ATTRIBUTED')
  })

  it('clique DEPOIS do pedido: não atribui', async () => {
    const sendId = await sentSend()
    await click(sendId, new Date(T0.getTime() + 3 * DAY), ANA, 'c_depois') // pedido é em T0+2DAY
    expect(await attributePurchase(order(), PEPPER)).toBe('NOT_ATTRIBUTED')
  })

  it('clique de OUTRA pessoa: não atribui', async () => {
    await sentSend(ANA, 'CAMP_A', 'm1')
    const bia = await sentSend(BIA, 'CAMP_A', 'm2')
    await click(bia, new Date(T0.getTime() + DAY), BIA, 'c_bia')
    expect(await attributePurchase(order(), PEPPER)).toBe('NOT_ATTRIBUTED') // order() é de ANA
  })

  it('clique fora da janela (8 dias antes do pedido): não atribui', async () => {
    const sendId = await sentSend()
    await click(sendId, T0, ANA, 'c_velho')
    expect(await attributePurchase(order({ orderedAt: new Date(T0.getTime() + 8 * DAY) }), PEPPER)).toBe('NOT_ATTRIBUTED')
    expect(trackingDb.events.filter((e) => e.type === 'PURCHASE')).toHaveLength(0)
  })

  it('o limite de 7 dias é inclusivo', async () => {
    const sendId = await sentSend()
    await click(sendId, T0)
    expect(await attributePurchase(order({ orderedAt: new Date(T0.getTime() + 7 * DAY) }), PEPPER)).toBe('ATTRIBUTED')
  })

  it('o ÚLTIMO clique vence quando há dois envios', async () => {
    const a = await sentSend(ANA, 'CAMP_A', 'm1')
    const b = await sentSend(ANA, 'CAMP_B', 'm2')
    await click(a, new Date(T0.getTime() + DAY), ANA, 'c_a')
    await click(b, new Date(T0.getTime() + 2 * DAY), ANA, 'c_b')
    expect(await attributePurchase(order({ orderedAt: new Date(T0.getTime() + 3 * DAY) }), PEPPER)).toBe('ATTRIBUTED')
    expect(trackingDb.events.find((e) => e.type === 'PURCHASE')).toMatchObject({ sendId: b, campaignKey: 'CAMP_B' })
  })

  it('é re-executável: um clique que chegou atrasado no webhook passa a atribuir na próxima rodada', async () => {
    const sendId = await sentSend()
    expect(await attributePurchase(order(), PEPPER)).toBe('NOT_ATTRIBUTED')
    await click(sendId, new Date(T0.getTime() + DAY))
    expect(await attributePurchase(order(), PEPPER)).toBe('ATTRIBUTED')
  })

  it.each([
    [{ orderId: '  ' }],
    [{ total: -1 }],
    [{ total: 'abc' }],
  ])('recusa entrada inválida %j', async (overrides) => {
    await expect(attributePurchase(order(overrides), PEPPER)).rejects.toThrow(InvalidTrackingInputError)
  })
})

describe('hasRecentEmailSend — cooldown por destinatário', () => {
  it('SENT dentro de 72h bloqueia; depois libera; QUEUED e FAILED não contam; SENDING conta', async () => {
    await sentSend(ANA, 'CAMP_A', 'm1')
    expect(await hasRecentEmailSend(ANA, { pepper: PEPPER, now: new Date(T0.getTime() + 3_600_000) })).toBe(true)
    expect(await hasRecentEmailSend(ANA, { pepper: PEPPER, now: new Date(T0.getTime() + 73 * 3_600_000) })).toBe(false)
    expect(await hasRecentEmailSend(BIA, { pepper: PEPPER, now: T0 })).toBe(false)

    const { sendId: queued } = await reserveEmailSend({ emailHash: hash(BIA), campaignKey: 'CAMP_A' })
    expect(await hasRecentEmailSend(BIA, { pepper: PEPPER })).toBe(false)
    await claimEmailSend(queued, hash(BIA))
    expect(await hasRecentEmailSend(BIA, { pepper: PEPPER })).toBe(true)
    await markEmailSendFailed(queued, { retryable: false, reason: 'PROVIDER_REJECTED' })
    expect(await hasRecentEmailSend(BIA, { pepper: PEPPER })).toBe(false)
  })
})

describe('privacidade do livro de tracking', () => {
  it('nenhuma linha de envio ou evento contém e-mail em claro', async () => {
    const sendId = await sentSend()
    await recordProviderEmailEvent(providerEvent({ type: 'CLICK', sendId, occurredAt: new Date(T0.getTime() + DAY) }), PEPPER)
    await attributePurchase({ email: ANA, orderId: '77', total: 50, orderedAt: new Date(T0.getTime() + 2 * DAY) }, PEPPER)
    const dump = JSON.stringify({ sends: trackingDb.sends, events: trackingDb.events })
    expect(dump).not.toMatch(/@/)
    expect(dump.toLowerCase()).not.toContain('example.com')
    expect(dump).not.toContain('ana')
  })
})
