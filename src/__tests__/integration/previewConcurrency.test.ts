import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { runAbandonedCheckoutsPreview } from '../../jobs/previewAbandonedCheckouts'

// runAbandonedCheckoutsPreview usava evaluateAbandonedCheckoutEligibility por checkout (N+1) —
// reproduzido ao vivo como um hang de 45s+ sob o connection_limit=2 do Preview assim que este
// caminho passou a ser exercitado de ponta a ponta pela primeira vez (via Oportunidades da IA).
// Agora usa evaluateAbandonedCheckoutEligibilityBatch (mesma correção já aplicada ao Carrinho).
// Este arquivo testa só a agregação/preview-only de runAbandonedCheckoutsPreview — a paridade
// do batch com o caminho por linha já é coberta em abandonedCheckoutEligibilityBatch.test.ts.
const state = vi.hoisted(() => {
  const tracker = { failId: null as string | null }
  const writes = vi.fn((): never => { throw new Error('Preview attempted a write') })
  const evaluateBatch = vi.fn(async (checkouts: Array<{ id: string; normalizedPhone: string }>) => {
    return checkouts.map((c) => c.id === tracker.failId ? null : {
      eligible: true,
      reasons: [],
      warnings: [],
      checkoutId: c.id,
      normalizedPhone: c.normalizedPhone,
      templateName: 'carrinho_abandonado_drosa_v2',
      templateParameters: ['Cliente', 'https://example.test/checkout'],
      renderedPreview: 'Preview seguro',
    })
  })
  return {
    get failId() { return tracker.failId },
    set failId(value: string | null) { tracker.failId = value },
    writes,
    evaluateBatch,
  }
})

vi.mock('../../services/abandonedCheckoutEligibilityService', () => ({
  evaluateAbandonedCheckoutEligibilityBatch: state.evaluateBatch,
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

describe('abandoned checkout preview (batch, no N+1)', () => {
  const originalConcurrency = env.PREVIEW_CONCURRENCY

  beforeEach(() => {
    vi.clearAllMocks()
    state.failId = null
    env.PREVIEW_CONCURRENCY = 2
  })

  afterEach(() => {
    env.PREVIEW_CONCURRENCY = originalConcurrency
  })

  it('evaluates 100 candidates in a single batch call, without writing', async () => {
    vi.mocked(prisma.abandonedCheckout.findMany).mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, index) => checkout(index)) as never,
    )

    const startedAt = performance.now()
    const result = await runAbandonedCheckoutsPreview()
    const durationMs = Math.round(performance.now() - startedAt)

    expect(result).toMatchObject({ found: 100, eligible: 100, skipped: 0, errors: 0, sent: 0 })
    // A trava real contra reintroduzir o N+1: uma chamada batched, nunca 100 individuais.
    expect(state.evaluateBatch).toHaveBeenCalledTimes(1)
    expect(state.writes).not.toHaveBeenCalled()
    console.info(JSON.stringify({ candidate_count: 100, duration_ms: durationMs, success: result.eligible, errors: result.errors }))
  })

  it('isolates um candidato cuja avaliação falhou (batch retorna null) sem derrubar o restante nem escrever', async () => {
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
    expect(state.evaluateBatch).toHaveBeenCalledTimes(1)
    expect(state.writes).not.toHaveBeenCalled()
  })
})
