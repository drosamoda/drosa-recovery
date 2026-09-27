import { PrismaClient } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'

// BI & Inteligência — leitura das views bi_* JÁ EXISTENTES no banco de
// produção (as mesmas lidas pelo app BI drosamoda/drosa-recovery-bi-dashboard,
// lib/queries.ts). O SQL abaixo é o do repo canônico; as únicas diferenças são
// casts de TIPO (::text / ::int) para o JSON sair estável — datas como string
// crua (as views já agrupam por dia; reconverter reintroduziria deslocamento
// de fuso) e contagens bigint como número. Nenhum cálculo novo, nenhuma view
// nova, nenhuma tabela crua, nenhuma coluna com PII.
//
// Datasource: BI_DATABASE_URL (role drosa_bi_reader, menor privilégio) quando
// configurada; senão o DATABASE_URL do serviço, SEMPRE dentro de uma
// transação SET TRANSACTION READ ONLY — qualquer escrita falharia no Postgres.

const DAY_CAP = 90

export const BI_DATASETS = {
  messageDaily: (days: number) => ({
    sql: `select day::text as day, status, message_count::int as count
          from bi_message_daily_stats where day >= (current_date - $1::int) order by day asc`,
    params: [days],
  }),
  templateDaily: (days: number) => ({
    sql: `select template_name, meta_category, template_active, status, sum(message_count)::int as count
          from bi_template_daily_stats where day >= (current_date - $1::int)
          group by template_name, meta_category, template_active, status order by template_name asc`,
    params: [days],
  }),
  abandonedCartDaily: (days: number) => ({
    sql: `select day::text as day, total_abandoned::int, with_phone::int, with_consent::int, eligible::int,
                 message_sent::int, message_delivered::int, message_read::int,
                 purchased_after_contact::int as with_linked_order
          from bi_abandoned_cart_funnel_daily where day >= (current_date - $1::int) order by day asc`,
    params: [days],
  }),
  consentCurrent: () => ({
    sql: `select scope, status, phone_count::int as count from bi_consent_current_state order by scope asc, status asc`,
    params: [],
  }),
  consentDaily: (days: number) => ({
    sql: `select day::text as day, scope, event_type, event_count::int as count
          from bi_consent_daily_events where day >= (current_date - $1::int) order by day asc`,
    params: [days],
  }),
  ordersConsentDaily: (days: number) => ({
    sql: `select day::text as day, total_orders::int, orders_with_transactional_granted::int as transactional_granted,
                 orders_with_marketing_granted::int as marketing_granted, orders_eligible_for_message::int as eligible_for_message
          from bi_orders_consent_funnel_daily where day >= (current_date - $1::int) order by day asc`,
    params: [days],
  }),
  ordersDaily: (days: number) => ({
    sql: `select day::text as day, payment_status, order_status, order_count::int as count, total_amount::text as total_amount
          from bi_orders_daily_summary where day >= (current_date - $1::int) order by day asc`,
    params: [days],
  }),
  webhookDaily: (days: number) => ({
    sql: `select provider, topic, sum(event_count)::int as events, sum(event_count) filter (where processed)::int as processed,
                 sum(invalid_hmac_count)::int as invalid_hmac, sum(error_count)::int as errors, max(day)::text as last_day
          from bi_webhook_daily_summary where day >= (current_date - $1::int)
          group by provider, topic order by events desc`,
    params: [days],
  }),
  systemPulse: () => ({
    sql: `select last_order_at::text, last_webhook_nuvemshop_at::text, last_webhook_meta_at::text,
                 pending_messages::int, processing_messages::int, delivery_unknown_messages::int
          from bi_system_pulse`,
    params: [],
  }),
} as const

export type BiDataset = keyof typeof BI_DATASETS

export function isBiDataset(value: string): value is BiDataset {
  return Object.prototype.hasOwnProperty.call(BI_DATASETS, value)
}

export function clampDays(input: unknown): number {
  const n = Number(input)
  if (!Number.isInteger(n) || n < 1) return 30
  return Math.min(n, DAY_CAP)
}

let readerClient: PrismaClient | null = null
function biClient(): PrismaClient {
  if (!env.BI_DATABASE_URL) return prisma
  readerClient ??= new PrismaClient({ datasourceUrl: env.BI_DATABASE_URL })
  return readerClient
}

export function biDatasource(): 'bi_reader' | 'service_readonly_tx' {
  return env.BI_DATABASE_URL ? 'bi_reader' : 'service_readonly_tx'
}

export async function readBiDataset(name: BiDataset, days: number): Promise<unknown[]> {
  const { sql, params } = BI_DATASETS[name](days)
  const client = biClient()
  const [, rows] = await client.$transaction([
    client.$executeRawUnsafe('SET TRANSACTION READ ONLY'),
    client.$queryRawUnsafe<unknown[]>(sql, ...params),
  ])
  return rows
}
