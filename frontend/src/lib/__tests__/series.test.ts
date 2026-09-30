import { cartSeries, hasAny, lastDays, messageSeries, ordersSeries } from '../series'
import { dashboardQuery } from '../period'
import { systemStatus } from '../systemStatus'
import type { HealthResponse } from '../types'

const NOW = new Date('2026-09-28T15:00:00Z') // 12:00 em Brasília

describe('series (determinísticas, sem dado inventado)', () => {
  it('lastDays usa o fuso de Brasília e termina hoje', () => {
    expect(lastDays(3, NOW)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28'])
  })

  it('messageSeries particiona por status exclusivo e zera dias sem linha', () => {
    const points = messageSeries(
      [
        { day: '2026-09-27', status: 'sent', count: 4 },
        { day: '2026-09-27', status: 'delivered', count: 3 },
        { day: '2026-09-27', status: 'read', count: 2 },
        { day: '2026-09-27', status: 'skipped', count: 9 },
        { day: '2026-09-27', status: 'pending', count: 1 },
        { day: '2026-09-27', status: 'processing', count: 1 },
        { day: '2026-09-27', status: 'failed', count: 5 },
        { day: '2026-09-26', status: 'read', count: 7 }, // dia extra devolvido pela view: entra (totais batem com o KPI)
      ],
      2,
      NOW,
    )
    expect(points).toEqual([
      { day: '2026-09-26', read: 7, delivered: 0, awaiting: 0, failed: 0, blocked: 0, queued: 0 },
      { day: '2026-09-27', read: 2, delivered: 3, awaiting: 4, failed: 5, blocked: 9, queued: 2 },
      { day: '2026-09-28', read: 0, delivered: 0, awaiting: 0, failed: 0, blocked: 0, queued: 0 },
    ])
  })

  it('cartSeries e ordersSeries somam só colunas reais', () => {
    const cart = cartSeries([{ day: '2026-09-28', total_abandoned: 10, with_phone: 9, with_consent: 2, eligible: 1, message_sent: 3, message_delivered: 2, message_read: 1, with_linked_order: 4 }], 1, NOW)
    expect(cart).toEqual([{ day: '2026-09-28', abandoned: 10, eligible: 1, dispatched: 3 }])
    const orders = ordersSeries(
      [
        { day: '2026-09-28', payment_status: 'paid', order_status: 'open', count: 2, total_amount: '10' },
        { day: '2026-09-28', payment_status: 'pending', order_status: 'open', count: 3, total_amount: '10' },
        { day: '2026-09-28', payment_status: 'voided', order_status: 'cancelled', count: 1, total_amount: '10' },
      ],
      1,
      NOW,
    )
    expect(orders).toEqual([{ day: '2026-09-28', paid: 2, pending: 3, other: 1 }])
    expect(hasAny(orders, ['paid'])).toBe(true)
    expect(hasAny([{ a: 0 }], ['a'])).toBe(false)
  })
})

describe('período global', () => {
  it('today/7d/30d vão direto; 90d usa o custom que o backend já aceita', () => {
    expect(dashboardQuery('7d')).toBe('period=7d')
    expect(dashboardQuery('90d', NOW)).toMatch(/^period=custom&from=2026-07-01/)
  })
})

describe('systemStatus', () => {
  const base: HealthResponse = {
    meta: { configured: true, latestEvidence: null },
    nuvemshop: { configured: true, latestEvidence: null },
    recoveryEngine: { pending: 3, processing: 0, failed: 0, unknown: 0, oldestPending: null },
    inboxMirror: { failed: 0, latestSuccess: null },
    jobFreshness: null,
    runtime: {},
  }
  it('fila sozinha não é alerta; falha é crítica; sem dado é desconhecido', () => {
    expect(systemStatus(base).level).toBe('ok')
    expect(systemStatus({ ...base, recoveryEngine: { ...base.recoveryEngine, failed: 2 } }).level).toBe('critical')
    expect(systemStatus({ ...base, inboxMirror: { failed: 1, latestSuccess: null } }).level).toBe('warning')
    expect(systemStatus(undefined).level).toBe('unknown')
  })
})
