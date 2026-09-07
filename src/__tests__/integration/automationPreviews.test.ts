import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import app from '../../index'
import { prisma } from '../../config/prisma'
import { runAbandonedCheckoutsPreview } from '../../jobs/previewAbandonedCheckouts'
import { remarketingPreview } from '../../services/remarketingService'

const state = vi.hoisted(() => ({ writes: vi.fn(() => { throw new Error('Preview attempted a write') }) }))
vi.mock('../../config/prisma', () => {
  const table = () => ({ findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null), create: state.writes, update: state.writes,
    updateMany: state.writes, delete: state.writes, deleteMany: state.writes, upsert: state.writes })
  return { prisma: { abandonedCheckout: table(), order: table(), customer: table(), suppression: table(),
    messageLog: table(), whatsappTemplate: table(), conversation: table(), chatMessage: table(),
    $executeRaw: state.writes, $executeRawUnsafe: state.writes } }
})

describe('read-only automation previews', () => {
  it.each(['/jobs/abandoned-checkouts-preview', '/jobs/remarketing-preview'])('rejects unauthenticated %s', async (url) => {
    expect((await request(app).post(url)).status).toBe(401)
  })
  it('cart preview reads an invalid candidate without writing timestamps or messages', async () => {
    vi.mocked(prisma.abandonedCheckout.findMany).mockResolvedValueOnce([{
      id: 'checkout', normalizedPhone: '', customerName: '', customerEmail: null, abandonedCheckoutUrl: '',
      status: 'abandoned', sourceCreatedAt: null, sourceUpdatedAt: null, abandonedAt: null,
    }] as never)
    const result = await runAbandonedCheckoutsPreview()
    expect(result).toMatchObject({ found: 1, eligible: 0, sent: 0 })
    expect(result.reasons).toMatchObject({ missing_phone: 1, missing_recovery_url: 1, order_timing_uncertain: 1 })
    expect(state.writes).not.toHaveBeenCalled()
  })
  it('all-segment preview never creates a run or recipient and never sends', async () => {
    const result = await remarketingPreview()
    expect(result.sent).toBe(0)
    expect(Object.keys(result.segments)).toHaveLength(7)
    expect(state.writes).not.toHaveBeenCalled()
  })
})
