import { beforeEach, describe, expect, it, vi } from 'vitest'

type CheckoutFixture = { id: string; normalizedPhone: string | null; customerName: string; customerEmail: string; abandonedCheckoutUrl: string; status: string; sourceCreatedAt: Date; sourceUpdatedAt: Date; abandonedAt: Date; nuvemshopCheckoutId: string; productsSummary: string; total: number; currency: string }

const state = vi.hoisted(() => ({
  facts: { suppressed: false, optOut: false, consent: true, template: true, sent: false, recent: false, orders: [] as Array<{ id: string; normalizedPhone: string; customerEmail: string; sourceCreatedAt: Date | null; createdAt: Date }> },
  calls: [] as string[],
  checkouts: [] as CheckoutFixture[],
}))

const phone = '5531987654321'
const email = 'cliente@example.com'
const template = { metaTemplateName: 'carrinho_abandonado_drosa_v2', languageCode: 'pt_BR', messagePreview: 'Oi {{1}} {{2}}', variables: {} }
const record = (name: string, value: unknown) => { state.calls.push(name); return Promise.resolve(value) }
vi.mock('../../config/prisma', () => ({ prisma: {
  suppression: { findUnique: () => record('suppression.findUnique', state.facts.suppressed ? { id: 's' } : null), findMany: () => record('suppression.findMany', state.facts.suppressed ? [{ normalizedPhone: phone }] : []) },
  customer: { findFirst: () => record('customer.findFirst', { optOut: state.facts.optOut }), findMany: () => record('customer.findMany', [{ normalizedPhone: phone, optOut: state.facts.optOut }]) },
  whatsappConsent: { findMany: () => record('whatsappConsent.findMany', state.facts.consent ? [{ normalizedPhone: phone, consented: true, revokedAt: null, consentedAt: new Date() }] : []) },
  whatsappTemplate: { findFirst: () => record('whatsappTemplate.findFirst', state.facts.template ? template : null) },
  messageLog: {
    findFirst: (args: { where: { entityId?: string } }) => record('messageLog.findFirst', args.where.entityId ? (state.facts.sent ? { id: 'm' } : null) : (state.facts.recent ? { id: 'm' } : null)),
    findMany: (args: { select?: { entityId?: boolean; normalizedPhone?: boolean } }) => record('messageLog.findMany', args.select?.entityId ? (state.facts.sent ? state.checkouts.map(c => ({ entityId: c.id })) : []) : args.select?.normalizedPhone ? (state.facts.recent ? [{ normalizedPhone: phone }] : []) : []),
  },
  order: { findMany: (args: { select?: { normalizedPhone?: boolean } }) => record('order.findMany', args.select?.normalizedPhone ? state.facts.orders : state.facts.orders.map(({ id, sourceCreatedAt, createdAt }) => ({ id, sourceCreatedAt, createdAt }))) },
  abandonedCheckout: { count: () => record('abandonedCheckout.count', state.checkouts.length), findMany: (args: { skip: number; take: number }) => record('abandonedCheckout.findMany', state.checkouts.slice(args.skip, args.skip + args.take)) },
} }))
vi.mock('../../config/env', () => ({ env: {
  CHECKOUT_BASE_URL: 'https://www.drosamoda.com.br/checkout/', ABANDONED_CART_TEMPLATE: 'carrinho_abandonado_drosa_v2',
  ABANDONED_CART_DELAY_MINUTES: 30, ABANDONED_CART_MAX_AGE_HOURS: 168, ABANDONED_CART_COOLDOWN_HOURS: 24, REMARKETING_GLOBAL_COOLDOWN_HOURS: 24,
} }))
vi.mock('../../services/whatsappConsentService', () => ({ hasActiveWhatsappConsent: (candidate: string) => record('consent.findUnique', state.facts.consent && candidate === phone) }))
vi.mock('../../helpers/inboxTemplatePreview', () => ({ renderTemplatePreview: (_name: string, args: { templateVariables: { nome_cliente: string; link_checkout: string } }) => ({ renderedPreview: `Oi ${args.templateVariables.nome_cliente} ${args.templateVariables.link_checkout}` }) }))

import { evaluateAbandonedCheckoutEligibility, evaluateAbandonedCheckoutEligibilityBatch } from '../../services/abandonedCheckoutEligibilityService'
import { crmReadService } from '../../services/crmReadService'

const now = new Date('2026-09-12T12:00:00Z')
const base = (): CheckoutFixture => ({ id: 'checkout-1', normalizedPhone: phone, customerName: 'Cliente Teste', customerEmail: email, abandonedCheckoutUrl: 'https://www.drosamoda.com.br/checkout/test', status: 'abandoned', sourceCreatedAt: new Date('2026-09-11T11:00:00Z'), sourceUpdatedAt: new Date('2026-09-11T12:00:00Z'), abandonedAt: new Date('2026-09-11T12:00:00Z'), nuvemshopCheckoutId: 'n1', productsSummary: 'Produto', total: 10, currency: 'BRL' })

describe('abandoned checkout batch eligibility', () => {
  beforeEach(() => { state.facts = { suppressed: false, optOut: false, consent: true, template: true, sent: false, recent: false, orders: [] }; state.calls = []; state.checkouts = [] })

  const cases: Array<[string, (c: CheckoutFixture) => void, string | null]> = [
    ['eligible', () => {}, null],
    ['missing_phone', c => { c.normalizedPhone = null }, 'missing_phone'],
    ['invalid_phone', c => { c.normalizedPhone = '123' }, 'invalid_phone'],
    ['converted', c => { c.status = 'converted' }, 'converted'],
    ['skipped', c => { c.status = 'skipped' }, 'skipped'],
    ['opt_out', () => { state.facts.optOut = true }, 'opt_out'],
    ['suppression', () => { state.facts.suppressed = true }, 'opt_out'],
    ['consent_unproven', () => { state.facts.consent = false }, 'consent_unproven'],
    ['already_sent', () => { state.facts.sent = true }, 'already_sent'],
    ['cooldown_active', () => { state.facts.recent = true }, 'cooldown_active'],
    ['order_after_checkout', () => { state.facts.orders = [{ id: 'o1', normalizedPhone: phone, customerEmail: email, sourceCreatedAt: now, createdAt: now }] }, 'order_after_checkout'],
    ['order_timing_uncertain', () => { state.facts.orders = [{ id: 'o1', normalizedPhone: phone, customerEmail: email, sourceCreatedAt: null, createdAt: now }] }, 'order_timing_uncertain'],
    ['too_recent', c => { c.abandonedAt = now }, 'too_recent'],
    ['too_old', c => { c.abandonedAt = new Date('2026-08-01') }, 'too_old'],
    ['invalid_template', () => { state.facts.template = false }, 'invalid_template'],
    ['invalid_template_data', c => { c.customerName = '' }, 'invalid_template_data'],
    ['invalid_encoding', c => { c.customerName = '??' }, 'invalid_encoding'],
  ]
  it.each(cases)('matches the single evaluator for %s', async (_label, change, expected) => {
    const checkout = base(); change(checkout); state.checkouts = [checkout]
    const single = await evaluateAbandonedCheckoutEligibility(checkout as never, now)
    const [batch] = await evaluateAbandonedCheckoutEligibilityBatch([checkout as never], now)
    expect(batch).toEqual(single)
    if (expected) expect(batch.reasons).toContain(expected)
    else expect(batch.eligible).toBe(true)
  })

  it.each([1, 20, 50, 100])('keeps DB query count bounded for %i checkouts', async count => {
    state.checkouts = Array.from({ length: count }, (_, i) => ({ ...base(), id: `checkout-${i}` }))
    const result = await evaluateAbandonedCheckoutEligibilityBatch(state.checkouts as never, now)
    expect(result).toHaveLength(count)
    expect(result.every(x => x.eligible)).toBe(true)
    expect(state.calls).toHaveLength(7)
  })

  it('returns 100 checkout rows through the CRM service without per-row queries', async () => {
    state.checkouts = Array.from({ length: 100 }, (_, i) => ({ ...base(), id: `checkout-${i}` }))
    const result = await crmReadService.checkouts({ page: 1, pageSize: 100 })
    expect(result.data).toHaveLength(100)
    expect(result.data.every(x => x.eligible)).toBe(true)
    expect(state.calls).toHaveLength(10)
  })
})
