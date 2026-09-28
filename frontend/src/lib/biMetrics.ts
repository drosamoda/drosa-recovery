// Semântica do módulo BI & Inteligência. Só SOMA linhas que as views bi_*
// já devolvem e as renomeia pelo dicionário aprovado — nenhuma regra nova.
// Diferenças deliberadas em relação ao app BI antigo (lib/message-metrics.ts):
// - taxa de entrega/leitura usa DISPARADAS como denominador, nunca o total
//   (o total inclui bloqueadas/skipped e fila, que nunca poderiam ser entregues);
// - "Enviadas" não existe: sent = "Aguardando entrega";
// - funil de carrinho separado em dois grupos realmente subordinados;
// - consentimento transacional × marketing lado a lado (paralelos), nunca em sequência.

export interface MessageDailyRow {
  day: string
  status: string
  count: number
}

export interface MessageSemantics {
  evaluated: number
  blocked: number
  queued: number
  dispatched: number
  awaitingDelivery: number
  delivered: number
  read: number
  failed: number
  unknown: number
}

export function messageSemantics(rows: { status: string; count: number }[]): MessageSemantics {
  const by = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + r.count, 0)
  const sent = by('sent'), delivered = by('delivered'), read = by('read')
  return {
    evaluated: rows.reduce((a, r) => a + r.count, 0),
    blocked: by('skipped'),
    queued: by('pending') + by('processing'),
    dispatched: sent + delivered + read,
    awaitingDelivery: sent,
    delivered: delivered + read,
    read,
    failed: by('failed'),
    unknown: by('unknown'),
  }
}

/** Percentual com denominador explícito; null quando o denominador é 0. Nunca limitado a 100. */
export function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null
}

export function formatPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`
}

export interface CartDailyRow {
  day: string
  total_abandoned: number
  with_phone: number
  with_consent: number
  eligible: number
  message_sent: number
  message_delivered: number
  message_read: number
  with_linked_order: number
}

export function sumCart(rows: CartDailyRow[]) {
  const s = (k: keyof Omit<CartDailyRow, 'day'>) => rows.reduce((a, r) => a + r[k], 0)
  return {
    evaluated: s('total_abandoned'),
    withPhone: s('with_phone'),
    withConsent: s('with_consent'),
    eligible: s('eligible'),
    dispatched: s('message_sent'),
    delivered: s('message_delivered'),
    read: s('message_read'),
    withLinkedOrder: s('with_linked_order'),
  }
}

export interface OrdersConsentRow {
  day: string
  total_orders: number
  transactional_granted: number
  marketing_granted: number
  eligible_for_message: number
}

export function sumOrdersConsent(rows: OrdersConsentRow[]) {
  return rows.reduce(
    (a, r) => ({
      orders: a.orders + r.total_orders,
      transactional: a.transactional + r.transactional_granted,
      marketing: a.marketing + r.marketing_granted,
      eligible: a.eligible + r.eligible_for_message,
    }),
    { orders: 0, transactional: 0, marketing: 0, eligible: 0 },
  )
}

export interface OrdersDailyRow {
  day: string
  payment_status: string
  order_status: string
  count: number
  total_amount: string
}

export function ordersByPaymentStatus(rows: OrdersDailyRow[]) {
  const map = new Map<string, { status: string; count: number; amount: number }>()
  for (const r of rows) {
    const e = map.get(r.payment_status) ?? { status: r.payment_status, count: 0, amount: 0 }
    e.count += r.count
    e.amount += Number(r.total_amount) || 0
    map.set(r.payment_status, e)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

export interface TemplateDailyRow {
  template_name: string
  meta_category: string | null
  template_active: boolean | null
  status: string
  count: number
}

export function templateSemantics(rows: TemplateDailyRow[]) {
  const byName = new Map<string, { name: string; category: string | null; active: boolean | null; rows: { status: string; count: number }[] }>()
  for (const r of rows) {
    const e = byName.get(r.template_name) ?? { name: r.template_name, category: r.meta_category, active: r.template_active, rows: [] }
    e.rows.push({ status: r.status, count: r.count })
    byName.set(r.template_name, e)
  }
  return [...byName.values()].map((t) => ({ ...t, m: messageSemantics(t.rows) })).sort((a, b) => b.m.evaluated - a.m.evaluated)
}
