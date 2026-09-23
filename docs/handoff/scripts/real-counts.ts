// Validação do engine de e-mail contra o Postgres REAL (somente leitura, sem PII na saída).
// A credencial vem SÓ do ambiente do processo (nunca impressa).
const REPO = 'C:/Users/peter/OneDrive/Peter/particular/Documentos/desafio pai e filho/drosa-recovery-crm-ops'
const url = process.env.REAL_DB_URL
if (!url) { console.error('REAL_DB_URL ausente'); process.exit(2) }
process.env.NODE_ENV = 'production'
process.env.DATABASE_URL = url
process.env.DIRECT_URL = url
process.env.CRM_PREVIEW_READONLY = 'true'
process.env.CRM_READ_SECRET = 'not-used'
process.chdir(REPO)

// eslint-disable-next-line @typescript-eslint/no-var-requires
const engine = require(REPO + '/src/services/emailAudienceEngine')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require(REPO + '/src/config/prisma')

async function main() {
  const t0 = Date.now()
  const snapshot = await engine.getEmailAudienceSnapshot({ force: true })
  const ms = Date.now() - t0
  const seg = (k: string) => snapshot.segments.find((s: { segmentKey: string }) => s.segmentKey === k)
  const line = (k: string) => { const s = seg(k); return `${k.padEnd(26)} audience=${String(s.audienceCount).padStart(7)} validEmail=${String(s.withValidEmailCount).padStart(7)} status=${s.status} quality=${s.dataQuality.level}` }
  console.log(`snapshot em ${ms}ms · generatedAt=${snapshot.generatedAt}`)
  console.log('BASE', JSON.stringify(snapshot.base))
  console.log('RECENCY_CHECK', JSON.stringify(snapshot.recencyCheck))
  for (const k of ['ALL_EMAIL_CUSTOMERS', 'ONE_TIME_BUYERS', 'REPEAT_BUYERS', 'VIP_CUSTOMERS', 'RECENT_BUYERS_0_30D', 'LAPSED_31_60D', 'LAPSED_61_90D', 'LAPSED_91_180D', 'LAPSED_181_365D', 'DORMANT_365D_PLUS', 'NO_PURCHASE_CUSTOMERS', 'HIGH_VALUE_NON_VIP', 'RECENT_CART_ABANDONER', 'UNDATED_BUYERS']) console.log(line(k))

  // Invariantes (aritmética pura sobre os números do engine)
  const n = (k: string) => seg(k).audienceCount as number
  const checks: Array<[string, boolean, string]> = []
  checks.push(['ONE_TIME + REPEAT + NO_PURCHASE == ALL', n('ONE_TIME_BUYERS') + n('REPEAT_BUYERS') + n('NO_PURCHASE_CUSTOMERS') === n('ALL_EMAIL_CUSTOMERS'), `${n('ONE_TIME_BUYERS')}+${n('REPEAT_BUYERS')}+${n('NO_PURCHASE_CUSTOMERS')} vs ${n('ALL_EMAIL_CUSTOMERS')}`])
  const buckets = ['RECENT_BUYERS_0_30D', 'LAPSED_31_60D', 'LAPSED_61_90D', 'LAPSED_91_180D', 'LAPSED_181_365D', 'DORMANT_365D_PLUS'].reduce((a, k) => a + n(k), 0)
  checks.push(['soma dos 6 buckets + sem data == compradores', buckets + n('UNDATED_BUYERS') === n('ONE_TIME_BUYERS') + n('REPEAT_BUYERS'), `${buckets}+${n('UNDATED_BUYERS')} vs ${n('ONE_TIME_BUYERS') + n('REPEAT_BUYERS')}`])
  checks.push(['recencyCheck.overlapFree', snapshot.recencyCheck.overlapFree === true, String(snapshot.recencyCheck.overlapFree)])
  checks.push(['VIP ⊆ REPEAT (VIP exige >=3 pedidos)', n('VIP_CUSTOMERS') <= n('REPEAT_BUYERS'), `${n('VIP_CUSTOMERS')} <= ${n('REPEAT_BUYERS')}`])
  checks.push(['ALL == emailKnown', n('ALL_EMAIL_CUSTOMERS') === snapshot.base.emailKnown, `${n('ALL_EMAIL_CUSTOMERS')} vs ${snapshot.base.emailKnown}`])
  for (const s of snapshot.segments.filter((x: { status: string }) => x.status === 'READY')) {
    const sum = Object.values(s.trackBreakdown as Record<string, number>).reduce((a, b) => a + b, 0)
    checks.push([`trilhas somam a audiência de ${s.segmentKey}`, sum === s.audienceCount, `${sum} vs ${s.audienceCount}`])
  }

  // Verificação INDEPENDENTE dos buckets: mesma definição de negócio, formulação SQL diferente
  // (extract(epoch) em vez de aritmética JS) — confirma a lógica de datas contra o banco real.
  const rows = await prisma.$queryRawUnsafe(`
    WITH ord AS (
      SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"), ''), c.email))), '') AS em, o."sourceCreatedAt" AS at
      FROM orders o LEFT JOIN customers c ON c.id = o."customerId"
      WHERE o."paymentStatus" = 'paid' AND lower(o.status) NOT IN ('cancelled','canceled','refunded')
    ), agg AS (
      SELECT em, count(*)::int n, max(at) last_at FROM ord WHERE em IS NOT NULL GROUP BY em
    ), aged AS (
      SELECT n, floor(extract(epoch FROM (now() AT TIME ZONE 'UTC') - last_at) / 86400)::int AS age FROM agg WHERE last_at IS NOT NULL
    )
    SELECT
      (SELECT count(*) FROM agg WHERE n = 1)::int AS one_time,
      (SELECT count(*) FROM agg WHERE n >= 2)::int AS repeat,
      count(*) FILTER (WHERE age BETWEEN 0 AND 30)::int AS b0_30,
      count(*) FILTER (WHERE age BETWEEN 31 AND 60)::int AS b31_60,
      count(*) FILTER (WHERE age BETWEEN 61 AND 90)::int AS b61_90,
      count(*) FILTER (WHERE age BETWEEN 91 AND 180)::int AS b91_180,
      count(*) FILTER (WHERE age BETWEEN 181 AND 365)::int AS b181_365,
      count(*) FILTER (WHERE age > 365)::int AS b365_plus,
      count(*) FILTER (WHERE age < 0)::int AS future
    FROM aged`) as Array<Record<string, number>>
  const r = rows[0]
  console.log('INDEPENDENT_SQL', JSON.stringify(r))
  const cmp = (label: string, engineKey: string, sqlVal: number) => checks.push([`independente: ${label}`, Math.abs(n(engineKey) - sqlVal) <= 5, `engine=${n(engineKey)} sql=${sqlVal} (tolerância 5 por relógio entre chamadas)`])
  cmp('1 compra (todos, inclui sem data)', 'ONE_TIME_BUYERS', r.one_time)
  cmp('2+ compras', 'REPEAT_BUYERS', r.repeat)
  cmp('0–30d', 'RECENT_BUYERS_0_30D', r.b0_30)
  cmp('31–60d', 'LAPSED_31_60D', r.b31_60)
  cmp('61–90d', 'LAPSED_61_90D', r.b61_90)
  cmp('91–180d', 'LAPSED_91_180D', r.b91_180)
  cmp('181–365d', 'LAPSED_181_365D', r.b181_365)
  cmp('365+', 'DORMANT_365D_PLUS', r.b365_plus)
  checks.push(['nenhuma data de compra no futuro', r.future === 0, `future=${r.future}`])

  let failed = 0
  for (const [label, ok, detail] of checks) { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${detail})`) }
  console.log(`RESULT ${failed === 0 ? 'ALL_PASS' : failed + '_FAIL'} (${checks.length} checks)`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(async (e: Error) => { console.error('ERR', e.message.split('\n')[0]); try { await prisma.$disconnect() } catch { /* noop */ } process.exit(1) })
