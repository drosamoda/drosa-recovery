'use strict'
// AUDITORIA READ-ONLY: preferencia de marketing ATUAL (Nuvemshop /customers) x snapshots do banco.
// Segredos: token so via env do processo (NUVEMSHOP_AUDIT_TOKEN / NUVEMSHOP_AUDIT_STORE_ID); a URL do banco
// so e lida do .env.preview.local em memoria. Nada e gravado em arquivo. Saida = SO contagens agregadas.
// Modos: probe (1 request per_page=1) | full (paginacao per_page=200 + comparacao com o banco).
const fs = require('fs')
const REPO = 'C:/Users/peter/OneDrive/Peter/particular/Documentos/desafio pai e filho/drosa-recovery-crm-ops'
const MODE = process.argv[2]
const UA = 'DrosaRecovery (contato@drosamoda.com.br)'
const FIELDS = 'id,email,accepts_marketing,accepts_marketing_updated_at'
const stats = { requests: 0, rateLimitErrors: 0 }
const out = (k, v) => console.log(`${k}=${v}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const token = process.env.NUVEMSHOP_AUDIT_TOKEN
const store = process.env.NUVEMSHOP_AUDIT_STORE_ID
if (!token || !store || !/^\d+$/.test(store)) {
  out('CREDENCIAL', 'AUSENTE_OU_INVALIDA')
  process.exit(2)
}

async function get(page, perPage) {
  const url = `https://api.nuvemshop.com.br/v1/${store}/customers?per_page=${perPage}&page=${page}&fields=${FIELDS}`
  for (let attempt = 0; attempt < 4; attempt++) {
    stats.requests++
    let res
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA, Accept: 'application/json' } })
    } catch (e) {
      return { status: 0, body: null, error: e && e.name ? e.name : 'fetch_error' }
    }
    if (res.status === 429) {
      stats.rateLimitErrors++
      await sleep(2500 * (attempt + 1))
      continue
    }
    let body = null
    if (res.status === 200) {
      try { body = await res.json() } catch { return { status: 200, body: null, error: 'json_invalido' } }
    }
    return {
      status: res.status,
      body,
      remaining: Number(res.headers.get('x-rate-limit-remaining')),
      total: Number(res.headers.get('x-total-count')),
    }
  }
  return { status: 429, body: null }
}

function isValidDate(v) {
  return typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
}

async function probe() {
  const r = await get(1, 1)
  out('HTTP_STATUS', r.status)
  if (r.status === 401) { out('RESULT', 'AUTENTICACAO_INVALIDA'); return false }
  if (r.status === 403) { out('READ_CUSTOMERS_SCOPE_AVAILABLE', 'NO'); return false }
  if (r.status !== 200 || !Array.isArray(r.body)) { out('RESULT', `RESPOSTA_INESPERADA ${r.error || ''}`); return false }
  out('READ_CUSTOMERS_SCOPE_AVAILABLE', 'YES')
  out('RESPONSE_ARRAY_LENGTH', r.body.length)
  out('X_TOTAL_COUNT_HEADER', Number.isFinite(r.total) ? r.total : 'ausente')
  const first = r.body[0]
  if (!first || typeof first !== 'object') { out('RESULT', 'SEM_CLIENTES_PARA_VALIDAR_CAMPOS'); return false }
  const hasAM = 'accepts_marketing' in first
  const hasTs = 'accepts_marketing_updated_at' in first
  out('NUVEMSHOP_LIVE_CONSENT_FIELD', hasAM ? 'YES' : 'NO')
  out('NUVEMSHOP_LIVE_CONSENT_TIMESTAMP', hasTs ? 'YES' : 'NO')
  out('SAMPLE_ACCEPTS_MARKETING_TYPE', hasAM ? (first.accepts_marketing === null ? 'null' : typeof first.accepts_marketing) : 'ausente')
  out('SAMPLE_UPDATED_AT_TYPE', hasTs ? (first.accepts_marketing_updated_at === null ? 'null' : typeof first.accepts_marketing_updated_at) : 'ausente')
  return hasAM && hasTs
}

const SQL = `
WITH cust AS (SELECT NULLIF(lower(btrim(c.email)),'') AS em FROM customers c),
ord_paid AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), c.email))),'') AS em FROM orders o LEFT JOIN customers c ON c.id=o."customerId" WHERE o."paymentStatus"='paid' AND lower(o.status) NOT IN ('cancelled','canceled','refunded')),
pool AS (SELECT em FROM cust WHERE em IS NOT NULL UNION SELECT em FROM ord_paid WHERE em IS NOT NULL),
oc AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), cu.email))),'') AS em,
              COALESCE(o."sourceUpdatedAt", o."sourceCreatedAt", o."createdAt") AS at,
              CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN o."rawPayload"->'customer' WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN o."rawPayload"->'fetchedOrderPayload'->'customer' END AS c
       FROM orders o LEFT JOIN customers cu ON cu.id=o."customerId"),
ev AS (
  SELECT em, at, c->'accepts_marketing' AS val FROM oc WHERE em IS NOT NULL AND c IS NOT NULL AND c ? 'accepts_marketing'
  UNION ALL
  SELECT NULLIF(lower(btrim(a."customerEmail")),''), COALESCE(a."sourceUpdatedAt", a."sourceCreatedAt", a."lastSeenAt"), a."rawPayload"->'contact_accepts_marketing'
  FROM abandoned_checkouts a WHERE a."rawPayload" ? 'contact_accepts_marketing' AND NULLIF(lower(btrim(a."customerEmail")),'') IS NOT NULL
),
ev_bool AS (SELECT * FROM ev WHERE jsonb_typeof(val)='boolean'),
latest AS (SELECT DISTINCT ON (em) em, at, val FROM ev_bool ORDER BY em, at DESC NULLS LAST),
anykey AS (SELECT DISTINCT em FROM ev),
conflict AS (SELECT em FROM ev_bool GROUP BY em HAVING count(DISTINCT val) > 1)
SELECT p.em AS em, (l.em IS NOT NULL) AS has_val, COALESCE(l.val = 'true'::jsonb, false) AS val_true, l.at AS at,
       (cf.em IS NOT NULL) AS conflict, (k.em IS NOT NULL) AS anykey
FROM pool p LEFT JOIN latest l ON l.em = p.em LEFT JOIN anykey k ON k.em = p.em LEFT JOIN conflict cf ON cf.em = p.em`

function redact(msg) {
  return String(msg)
    .replace(/postgres(ql)?:\/\/\S+/gi, '<db-url>')
    .replace(/\S*(supabase|pooler)\S*/gi, '<host>')
    .split('\n').slice(-1)[0].slice(0, 160)
}

async function loadDbBase() {
  const { PrismaClient } = require(`${REPO}/node_modules/@prisma/client`)
  const text = fs.readFileSync(`${REPO}/.env.preview.local`, 'utf8')
  const pick = (key) => {
    const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
    return m ? m[1].trim().replace(/^"|"$/g, '') : null
  }
  const candidates = [pick('DIRECT_URL'), pick('DATABASE_URL')].filter(Boolean)
  let lastErr = 'sem_url'
  for (const candidate of candidates) {
    let prisma = null
    try {
      const u = new URL(candidate)
      u.searchParams.set('connection_limit', '1')
      u.searchParams.set('pool_timeout', '60')
      prisma = new PrismaClient({ datasources: { db: { url: u.toString() } }, log: [] })
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        return tx.$queryRawUnsafe(SQL)
      }, { timeout: 120000, maxWait: 60000 })
      await prisma.$disconnect()
      return rows
    } catch (e) {
      lastErr = redact(e && e.message)
      if (prisma) { try { await prisma.$disconnect() } catch { /* ignore */ } }
    }
  }
  out('DB_ERROR', lastErr)
  return null
}

async function full() {
  // 1) Coleta viva (sequencial, ritmo controlado). So memoria.
  const live = new Map() // email normalizado -> { t, f, n }
  const liveAll = { customers: 0, emailless: 0, dupEmails: 0, am_true: 0, am_false: 0, am_null: 0, am_keyAbsent: 0, ts_present: 0, ts_missing: 0 }
  let page = 1
  let endedBy = 'ultima_pagina'
  for (; page <= 200; page++) {
    const r = await get(page, 200)
    if (r.status === 404 && page > 1) { endedBy = '404_alem_da_ultima'; break }
    if (r.status !== 200 || !Array.isArray(r.body)) {
      out('LIVE_FETCH_ABORTED', `status=${r.status} pagina=${page}`)
      out('API_REQUESTS_TOTAL_THIS_RUN', stats.requests)
      return
    }
    for (const c of r.body) {
      liveAll.customers++
      if (!('accepts_marketing' in c)) liveAll.am_keyAbsent++
      if (c.accepts_marketing === true) liveAll.am_true++
      else if (c.accepts_marketing === false) liveAll.am_false++
      else liveAll.am_null++
      if (isValidDate(c.accepts_marketing_updated_at)) liveAll.ts_present++
      else liveAll.ts_missing++
      const key = typeof c.email === 'string' ? c.email.trim().toLowerCase() : ''
      if (!key) { liveAll.emailless++; continue }
      const cur = live.get(key) || { t: false, f: false, n: false, tsPresent: false }
      if (live.has(key)) liveAll.dupEmails++
      if (c.accepts_marketing === true) cur.t = true
      else if (c.accepts_marketing === false) cur.f = true
      else cur.n = true
      if (isValidDate(c.accepts_marketing_updated_at)) cur.tsPresent = true
      live.set(key, cur)
    }
    if (r.body.length < 200) break
    await sleep(r.remaining !== undefined && r.remaining < 5 ? 1500 : 650)
  }
  out('LIVE_PAGES_FETCHED', page)
  out('LIVE_PAGINATION_ENDED_BY', endedBy)
  out('LIVE_ALL_CUSTOMERS', liveAll.customers)
  out('LIVE_ALL_ACCEPTS_MARKETING_TRUE', liveAll.am_true)
  out('LIVE_ALL_ACCEPTS_MARKETING_FALSE', liveAll.am_false)
  out('LIVE_ALL_ACCEPTS_MARKETING_NULL_OR_ABSENT', liveAll.am_null)
  out('LIVE_ALL_KEY_ACCEPTS_MARKETING_ABSENT', liveAll.am_keyAbsent)
  out('LIVE_ALL_UPDATED_AT_PRESENT', liveAll.ts_present)
  out('LIVE_ALL_UPDATED_AT_MISSING', liveAll.ts_missing)
  out('LIVE_ALL_WITHOUT_EMAIL', liveAll.emailless)
  out('LIVE_DUPLICATE_EMAIL_ROWS', liveAll.dupEmails)

  // 2) Base do CRM (somente leitura, em memoria).
  const rows = await loadDbBase()
  if (!rows) return
  const now = Date.now()
  const bucketOf = (at) => {
    if (!at) return 'sem_data'
    const d = (now - new Date(at).getTime()) / 86400000
    return d <= 30 ? '0_30d' : d <= 90 ? '31_90d' : d <= 180 ? '91_180d' : '181d_mais'
  }

  // 3) Comparacao agregada.
  const cat = {}
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1 }
  const m = { found: 0, notFound: 0, liveTrue: 0, liveFalse: 0, liveNull: 0, liveConflict: 0, tsPresent: 0, tsMissing: 0 }
  const notFoundByDb = {}
  const conflictVsLive = {}
  const ageDbTrue = {} // bucket -> { total, liveFalse }
  const ageDbFalse = {}
  for (const row of rows) {
    const dbVal = row.has_val ? (row.val_true ? 'TRUE' : 'FALSE') : 'NOT_COLLECTED'
    const l = live.get(row.em)
    if (!l) {
      m.notFound++
      bump(notFoundByDb, dbVal)
      continue
    }
    m.found++
    let liveVal
    if (l.t && l.f) liveVal = 'CONFLICT'
    else if (l.t) liveVal = 'TRUE'
    else if (l.f) liveVal = 'FALSE'
    else liveVal = 'NULL'
    if (liveVal === 'TRUE') m.liveTrue++
    else if (liveVal === 'FALSE') m.liveFalse++
    else if (liveVal === 'NULL') m.liveNull++
    else m.liveConflict++
    if (l.tsPresent) m.tsPresent++
    else m.tsMissing++
    bump(cat, `${dbVal}__${liveVal}`)
    if (row.conflict) bump(conflictVsLive, liveVal)
    const b = bucketOf(row.at)
    if (dbVal === 'TRUE') { ageDbTrue[b] = ageDbTrue[b] || { total: 0, liveFalse: 0 }; ageDbTrue[b].total++; if (liveVal === 'FALSE') ageDbTrue[b].liveFalse++ }
    if (dbVal === 'FALSE') { ageDbFalse[b] = ageDbFalse[b] || { total: 0, liveTrue: 0 }; ageDbFalse[b].total++; if (liveVal === 'TRUE') ageDbFalse[b].liveTrue++ }
  }
  const c = (k) => cat[k] || 0
  out('CRM_EMAIL_BASE', rows.length)
  out('FOUND_IN_LIVE_CUSTOMERS', m.found)
  out('NOT_FOUND_IN_LIVE_CUSTOMERS', m.notFound)
  out('NOT_FOUND_DB_TRUE', notFoundByDb.TRUE || 0)
  out('NOT_FOUND_DB_FALSE', notFoundByDb.FALSE || 0)
  out('NOT_FOUND_DB_NOT_COLLECTED', notFoundByDb.NOT_COLLECTED || 0)
  out('LIVE_OPTED_IN', m.liveTrue)
  out('NOT_OPTED_IN', m.liveFalse)
  out('UNKNOWN', m.liveNull)
  out('LIVE_DUPLICATE_CONFLICT_TRUE_AND_FALSE', m.liveConflict)
  out('LIVE_UPDATED_AT_PRESENT', m.tsPresent)
  out('LIVE_UPDATED_AT_MISSING', m.tsMissing)
  out('UNCHANGED_TRUE', c('TRUE__TRUE'))
  out('UNCHANGED_FALSE', c('FALSE__FALSE'))
  out('DB_TRUE_LIVE_FALSE', c('TRUE__FALSE'))
  out('DB_FALSE_LIVE_TRUE', c('FALSE__TRUE'))
  out('DB_VALUE_LIVE_NULL', c('TRUE__NULL') + c('FALSE__NULL'))
  out('DB_TRUE_LIVE_NULL', c('TRUE__NULL'))
  out('DB_FALSE_LIVE_NULL', c('FALSE__NULL'))
  out('DB_NOT_COLLECTED_LIVE_TRUE', c('NOT_COLLECTED__TRUE'))
  out('DB_NOT_COLLECTED_LIVE_FALSE', c('NOT_COLLECTED__FALSE'))
  out('DB_NOT_COLLECTED_LIVE_NULL', c('NOT_COLLECTED__NULL'))
  out('DB_ANY_LIVE_TRUE_AND_FALSE_DUPLICATE', c('TRUE__CONFLICT') + c('FALSE__CONFLICT') + c('NOT_COLLECTED__CONFLICT'))
  out('STALE_OPT_IN_COUNT', c('TRUE__FALSE'))
  out('RECOVERED_OPT_IN_COUNT', c('FALSE__TRUE'))
  out('DB_SNAPSHOT_CONFLICT_ROWS_VS_LIVE', JSON.stringify(conflictVsLive))
  out('FRESHNESS_DB_TRUE_BY_SNAPSHOT_AGE__total_e_liveFalse', JSON.stringify(ageDbTrue))
  out('FRESHNESS_DB_FALSE_BY_SNAPSHOT_AGE__total_e_liveTrue', JSON.stringify(ageDbFalse))
  out('API_REQUESTS_TOTAL_THIS_RUN', stats.requests)
  out('RATE_LIMIT_ERRORS', stats.rateLimitErrors)
}

;(async () => {
  if (MODE === 'probe') {
    const ok = await probe()
    out('PROBE_PASSED', ok ? 'YES' : 'NO')
    out('API_REQUESTS_TOTAL_THIS_RUN', stats.requests)
    out('RATE_LIMIT_ERRORS', stats.rateLimitErrors)
  } else if (MODE === 'full') {
    await full()
  } else {
    out('USO', 'node script.js probe|full')
  }
})().catch((e) => { out('ERRO_INESPERADO', redact(e && e.message)); process.exit(1) })
