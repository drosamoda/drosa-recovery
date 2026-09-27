import { messageSemantics, pct, sumCart, sumOrdersConsent, templateSemantics } from '../biMetrics'

describe('biMetrics — dicionário semântico', () => {
  const rows = [
    { status: 'skipped', count: 900 },
    { status: 'pending', count: 5 },
    { status: 'sent', count: 10 },
    { status: 'delivered', count: 60 },
    { status: 'read', count: 30 },
    { status: 'failed', count: 4 },
    { status: 'unknown', count: 1 },
  ]

  it('mapeia status para Avaliadas/Bloqueadas/Disparadas/Aguardando/Entregues/Lidas', () => {
    expect(messageSemantics(rows)).toEqual({ evaluated: 1010, blocked: 900, queued: 5, dispatched: 100, awaitingDelivery: 10, delivered: 90, read: 30, failed: 4, unknown: 1 })
  })

  it('taxa de entrega usa Disparadas como denominador, nunca o total com skipped', () => {
    const m = messageSemantics(rows)
    expect(pct(m.delivered, m.dispatched)).toBe(90)
    // o calculo antigo do BI ((delivered+read)/total) daria ~8.9% — distorcido pelos bloqueados
    expect(pct(m.delivered, m.evaluated)).not.toBe(pct(m.delivered, m.dispatched))
  })

  it('pct não limita a 100 e devolve null sem denominador', () => {
    expect(pct(150, 100)).toBe(150)
    expect(pct(1, 0)).toBeNull()
  })

  it('carrinho: soma sem reordenar etapas; pedido vinculado fica fora do funil', () => {
    const c = sumCart([
      { day: 'a', total_abandoned: 10, with_phone: 8, with_consent: 2, eligible: 1, message_sent: 3, message_delivered: 2, message_read: 1, with_linked_order: 4 },
      { day: 'b', total_abandoned: 5, with_phone: 5, with_consent: 0, eligible: 0, message_sent: 0, message_delivered: 0, message_read: 0, with_linked_order: 0 },
    ])
    expect(c).toEqual({ evaluated: 15, withPhone: 13, withConsent: 2, eligible: 1, dispatched: 3, delivered: 2, read: 1, withLinkedOrder: 4 })
  })

  it('consentimento transacional e marketing são somados em paralelo sobre o mesmo total', () => {
    const o = sumOrdersConsent([{ day: 'a', total_orders: 10, transactional_granted: 7, marketing_granted: 2, eligible_for_message: 1 }])
    expect(o).toEqual({ orders: 10, transactional: 7, marketing: 2, eligible: 1 })
  })

  it('templates agregam com a mesma semântica', () => {
    const t = templateSemantics([
      { template_name: 'x', meta_category: null, template_active: null, status: 'delivered', count: 2 },
      { template_name: 'x', meta_category: null, template_active: null, status: 'skipped', count: 8 },
    ])
    expect(t[0].m).toMatchObject({ evaluated: 10, blocked: 8, dispatched: 2, delivered: 2 })
  })
})
