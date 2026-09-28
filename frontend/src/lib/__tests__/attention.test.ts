import { buildAttentionItems } from '../attention'
import type { HealthResponse } from '../types'

function health(over: Partial<HealthResponse> = {}): HealthResponse {
  return {
    meta: { configured: true, latestEvidence: { createdAt: '2026-09-28T10:00:00Z', processed: true, hmacValid: true, error: null } },
    nuvemshop: { configured: true, latestEvidence: { createdAt: '2026-09-28T10:00:00Z', processed: true, hmacValid: true, error: null } },
    recoveryEngine: { pending: 0, processing: 0, failed: 0, unknown: 0, oldestPending: null },
    inboxMirror: { failed: 0, latestSuccess: null },
    runtime: { cron: false },
    ...over,
  }
}

describe('Action Center', () => {
  it('sem problemas: nenhum item (cron desligado não é alerta)', () => {
    expect(buildAttentionItems(health())).toEqual([])
  })

  it('falhas, webhook com erro e desconhecidas viram itens com link, ordenados por severidade', () => {
    const items = buildAttentionItems(
      health({
        recoveryEngine: { pending: 2, processing: 0, failed: 282, unknown: 3, oldestPending: '2026-09-28T09:00:00Z' },
        nuvemshop: { configured: true, latestEvidence: { createdAt: '2026-09-28T10:00:00Z', processed: false, hmacValid: true, error: 'order not found' } },
      }),
    )
    expect(items.map((i) => i.key)).toEqual(['failed', 'nuvemshop', 'unknown', 'queue'])
    expect(items[0]).toMatchObject({ severity: 'danger', title: '282 mensagens com falha', to: '/messages?status=failed' })
    expect(items[1].title).toMatch(/erro registrado/)
  })

  it('limita a 5 itens', () => {
    const items = buildAttentionItems(
      health({
        recoveryEngine: { pending: 1, processing: 0, failed: 1, unknown: 1, oldestPending: null },
        inboxMirror: { failed: 1, latestSuccess: null },
        meta: { configured: false, latestEvidence: null },
        nuvemshop: { configured: true, latestEvidence: { createdAt: '2026-09-28T10:00:00Z', processed: true, hmacValid: false, error: null } },
      }),
    )
    expect(items).toHaveLength(5)
  })
})
