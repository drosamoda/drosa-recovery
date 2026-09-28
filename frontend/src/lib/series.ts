// Séries temporais DETERMINÍSTICAS a partir das linhas que as views bi_* já
// devolvem. Nenhum valor é estimado: dias sem linha viram 0 (ausência de
// evento no dia), nunca interpolação.
import type { CartDailyRow, MessageDailyRow, OrdersDailyRow } from './biMetrics'

const SP_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Últimos `days` dias (YYYY-MM-DD, fuso de Brasília — o mesmo das views), do mais antigo ao mais recente. */
export function lastDays(days: number, now: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(SP_DAY.format(new Date(now.getTime() - i * 86_400_000)))
  return out
}

export function shortDay(day: string): string {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}

export interface MessageDayPoint {
  day: string
  read: number
  delivered: number
  awaiting: number
  failed: number
  blocked: number
  queued: number
}

/** Partição por dia em estados mutuamente exclusivos. `delivered` aqui = entregue e ainda não lida. */
export function messageSeries(rows: MessageDailyRow[], days: number, now?: Date): MessageDayPoint[] {
  const map = new Map<string, MessageDayPoint>()
  for (const day of windowDays(rows, days, now)) map.set(day, { day, read: 0, delivered: 0, awaiting: 0, failed: 0, blocked: 0, queued: 0 })
  for (const r of rows) {
    const p = map.get(r.day)
    if (!p) continue
    if (r.status === 'read') p.read += r.count
    else if (r.status === 'delivered') p.delivered += r.count
    else if (r.status === 'sent') p.awaiting += r.count
    else if (r.status === 'failed') p.failed += r.count
    else if (r.status === 'skipped') p.blocked += r.count
    else if (r.status === 'pending' || r.status === 'processing') p.queued += r.count
  }
  return [...map.values()]
}

export interface CartDayPoint {
  day: string
  abandoned: number
  eligible: number
  dispatched: number
}

export function cartSeries(rows: CartDailyRow[], days: number, now?: Date): CartDayPoint[] {
  const map = new Map<string, CartDayPoint>()
  for (const day of windowDays(rows, days, now)) map.set(day, { day, abandoned: 0, eligible: 0, dispatched: 0 })
  for (const r of rows) {
    const p = map.get(r.day)
    if (!p) continue
    p.abandoned += r.total_abandoned
    p.eligible += r.eligible
    p.dispatched += r.message_sent
  }
  return [...map.values()]
}

export interface OrdersDayPoint {
  day: string
  paid: number
  pending: number
  other: number
}

/** Pedidos por dia separados por status de pagamento — quantidade, não faturamento. */
export function ordersSeries(rows: OrdersDailyRow[], days: number, now?: Date): OrdersDayPoint[] {
  const map = new Map<string, OrdersDayPoint>()
  for (const day of windowDays(rows, days, now)) map.set(day, { day, paid: 0, pending: 0, other: 0 })
  for (const r of rows) {
    const p = map.get(r.day)
    if (!p) continue
    if (r.payment_status === 'paid') p.paid += r.count
    else if (r.payment_status === 'pending') p.pending += r.count
    else p.other += r.count
  }
  return [...map.values()]
}

/** Janela = últimos N dias + qualquer dia que a view devolveu (mesma base dos totais dos KPIs). */
function windowDays(rows: { day: string }[], days: number, now?: Date): string[] {
  return [...new Set([...lastDays(days, now), ...rows.map((r) => r.day)])].sort()
}

export function hasAny<T extends object>(points: T[], keys: (keyof T)[]): boolean {
  return points.some((p) => keys.some((k) => Number(p[k]) > 0))
}
