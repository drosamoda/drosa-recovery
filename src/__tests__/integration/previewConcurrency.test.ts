import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { runAbandonedCheckoutsPreview } from '../../jobs/previewAbandonedCheckouts'

const state = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  failId: null as string | null,
  writes: vi.fn(() => { throw new Error('Preview attempted a write') }),
  evaluate: vi.fn(async (checkout: { id: string; normalizedPhone: string }) => {
    state.active++
    state.peak = Math.max(state.peak, state.active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    state.active--
    if (checkout.id === state.failId) throw Object.assign(new Error('candidate failed'), { code: 'TEST_FAILURE' })
    return {
      eligible: true,
      reasons: [],
      warnings: [],
      checkoutId: checkout.id,
      normalizedPhone: checkout.normalizedPhone,
      templateName: 'carrinho_abandonado_drosa_v2',
      templateParameters: ['Cliente', 'https://example.test/checkout'],
      renderedPreview: 'Preview seguro',
    }
  }),
}))

vi.mock('../../services/abandonedCheckoutEligibilityService', () => ({
  evaluateAbandonedCheckoutEligibility: state.evaluate,
}))

vi.mock('../../config/prisma', () => {
  const table = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    create: state.writes,
    update: state.writes,
    updateMany: state.writes,
    delete: state.writes,
    deleteMany: state.writes,
    upsert: state.writes,
  })
  return { prisma: { abandonedCheckout: table(), messageLog: table(), chatMessage: table() } }
})

function checkout(index: number) {
  return {
    id: `checkout-${index}`,
    normalizedPhone: `551199999${String(index).padStart(4, '0')}`,
  }
}

describe('abandoned checkout preview concurrency', () => {
  const originalConcurrency = env.PREVIEW_CONCURRENCY

  beforeEach(() => {
    vi.clearAllMocks()
    state.active = 0
    state.peak = 0
    state.failId = null
    env.PREVIEW_CONCURRENCY = 2
  })

  afterEach(() => {
    env.PREVIEW_CONCURRENCY = originalConcurrency
  })

  it('evaluates 100 candidates without exceeding configured concurrency or writing', async () => {
    vi.mocked(prisma.abandonedCheckout.findMany).mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, index) => checkout(index)) as never,
    )

    const startedAt = performance.now()
    const result = await runAbandonedCheckoutsPreview()
    const durationMs = Math.round(performance.now() - startedAt)

    expect(result).toMatchObject({ found: 100, eligible: 100, skipped: 0, errors: 0, sent: 0 })
    expect(state.evaluate).toHaveBeenCalledTimes(100)
    expect(state.peak).toBeGreaterThan(1)
    expect(state.peak).toBeLessThanOrEqual(2)
    expect(state.writes).not.toHaveBeenCalled()
    console.info(JSON.stringify({
      candidate_count: 100,
      configured_concurrency: env.PREVIEW_CONCURRENCY,
      peak_concurrency: state.peak,
      duration_ms: durationMs,
      success: result.eligible,
      errors: result.errors,
    }))
  })

  it('isolates one candidate error without failing the remaining batch or writing', async () => {
    state.failId = 'checkout-4'
    vi.mocked(prisma.abandonedCheckout.findMany).mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, index) => checkout(index)) as never,
    )

    const result = await runAbandonedCheckoutsPreview()

    expect(result).toMatchObject({ found: 10, eligible: 9, skipped: 0, errors: 1, sent: 0 })
    expect(result.reasons).toMatchObject({ evaluation_error: 1 })
    expect(result.data).toContainEqual(expect.objectContaining({
      checkoutId: 'checkout-4',
      eligible: false,
      reasons: ['evaluation_error'],
      error: 'candidate_evaluation_failed',
    }))
    expect(state.evaluate).toHaveBeenCalledTimes(10)
    expect(state.peak).toBeLessThanOrEqual(2)
    expect(state.writes).not.toHaveBeenCalled()
  })
})
