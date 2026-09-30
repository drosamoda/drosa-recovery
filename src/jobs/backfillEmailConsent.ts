import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { resolveEmailConsent } from '../services/emailConsentResolver'
import {
  BackfillCheckoutRow,
  BackfillOrderRow,
  BackfillPreview,
  BackfillWriteResult,
  buildBackfillEvents,
  hashEmail,
  previewBackfill,
  writeBackfill,
} from '../services/emailConsentService'

// Backfill do livro-razão de consentimento de e-mail a partir dos payloads já
// gravados (pedidos e checkouts abandonados). É DRY-RUN por padrão: só a
// escrita explícita (dryRun: false) toca o banco, e ela exige o
// EMAIL_HASH_PEPPER real e nunca roda em modo Preview read-only.
//
// As consultas devolvem SÓ as duas chaves de consentimento do JSON
// (accepts_marketing e seu timestamp) — nunca o objeto `customer` inteiro, que
// traz nome, telefone, documento e endereço. O e-mail sai da consulta apenas
// para ser transformado em hash em memória; a saída do job são agregados.

export interface BackfillEmailConsentOptions {
  // Padrão true. Só `false` (explícito) grava.
  dryRun?: boolean
  batchSize?: number
  // Backfill INCREMENTAL: só pedidos/checkouts com data de captura >= since (ex.: 2026-09-24).
  // Sem since = comportamento histórico (tudo).
  since?: Date
  // Pepper para a escrita. Sem ele, usa env.EMAIL_HASH_PEPPER. No dry-run,
  // se nenhum estiver configurado, usa um pepper EFÊMERO (os hashes só
  // servem para agrupar em memória e nunca são persistidos).
  pepper?: string
}

export type UniverseStateCounts = {
  CONFIRMED_OPT_IN: number
  CONFIRMED_OPT_OUT: number
  UNKNOWN: number
  NOT_COLLECTED: number
}

// Relatório agregado do backfill incremental. Sem e-mail, hash individual, nome ou telefone.
export interface IncrementalBackfillReport {
  since: string
  ordersSeen: number
  checkoutsSeen: number
  wouldCreateOptIn: number
  wouldCreateOptOut: number
  // Ausência de sinal NÃO gera evento (estado continua sem evidência): sempre 0 eventos UNKNOWN.
  wouldCreateUnknown: 0
  rowsWithoutSignal: number
  duplicates: number
  // e-mails com OPT_IN e OPT_OUT na mesma janela (a resolução decide por data do sinal)
  conflicts: number
}

export interface BackfillEmailConsentResult {
  mode: 'DRY_RUN' | 'WRITE'
  ordersRead: number
  checkoutsRead: number
  preview: BackfillPreview
  // Mesma população da auditoria de 21/09/2026: customers.email ∪ e-mails de
  // pedidos pagos. Permite conferir o dry-run contra os números já medidos.
  universe: { size: number; byState: UniverseStateCounts }
  write: BackfillWriteResult | null
  incremental: IncrementalBackfillReport | null
}

export class EmailConsentBackfillRefusedError extends Error {}

interface RawOrderRow {
  nuvemshopOrderId: string
  email: string | null
  customerId: string | null
  capturedAt: Date
  rawPayload: unknown
}

interface RawCheckoutRow {
  nuvemshopCheckoutId: string
  email: string | null
  customerId: string | null
  capturedAt: Date
  rawPayload: unknown
}

// Toda leitura roda em transação READ ONLY — o banco recusa qualquer escrita
// dentro dela, mesmo que a role tivesse permissão (defesa além dos grants).
async function inReadOnlyTx<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return run(tx)
    },
    { timeout: 120_000, maxWait: 60_000 },
  )
}

// Mesmas expressões de e-mail/data já usadas (e validadas no banco real) na
// auditoria de consentimento. O objeto `customer` é reduzido às 2 chaves.
async function readOrderRows(since: Date | null): Promise<BackfillOrderRow[]> {
  const rows = await inReadOnlyTx((tx) => tx.$queryRaw<RawOrderRow[]>(Prisma.sql`
    WITH oc AS (
      SELECT o."nuvemshopOrderId" AS "nuvemshopOrderId",
             NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), cu.email))),'') AS email,
             o."customerId" AS "customerId",
             COALESCE(o."sourceUpdatedAt", o."sourceCreatedAt", o."createdAt") AS "capturedAt",
             CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN o."rawPayload"->'customer' END AS c_root,
             CASE WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN o."rawPayload"->'fetchedOrderPayload'->'customer' END AS c_fetched
      FROM orders o LEFT JOIN customers cu ON cu.id = o."customerId"
    )
    SELECT "nuvemshopOrderId", email, "customerId", "capturedAt",
           CASE WHEN c_root IS NOT NULL THEN
                  jsonb_build_object('customer', jsonb_build_object(
                    'accepts_marketing', c_root->'accepts_marketing',
                    'accepts_marketing_updated_at', c_root->'accepts_marketing_updated_at'))
                WHEN c_fetched IS NOT NULL THEN
                  jsonb_build_object('fetchedOrderPayload', jsonb_build_object('customer', jsonb_build_object(
                    'accepts_marketing', c_fetched->'accepts_marketing',
                    'accepts_marketing_updated_at', c_fetched->'accepts_marketing_updated_at')))
           END AS "rawPayload"
    FROM oc
    WHERE ${since}::timestamp IS NULL OR "capturedAt" >= ${since}`))
  return rows.map((row) => ({
    nuvemshopOrderId: row.nuvemshopOrderId,
    email: row.email,
    customerId: row.customerId,
    rawPayload: row.rawPayload,
    capturedAt: row.capturedAt,
  }))
}

async function readCheckoutRows(since: Date | null): Promise<BackfillCheckoutRow[]> {
  const rows = await inReadOnlyTx((tx) => tx.$queryRaw<RawCheckoutRow[]>(Prisma.sql`
    SELECT a."nuvemshopCheckoutId" AS "nuvemshopCheckoutId",
           NULLIF(lower(btrim(a."customerEmail")),'') AS email,
           a."customerId" AS "customerId",
           COALESCE(a."sourceUpdatedAt", a."sourceCreatedAt", a."lastSeenAt") AS "capturedAt",
           jsonb_build_object(
             'contact_accepts_marketing', a."rawPayload"->'contact_accepts_marketing',
             'contact_accepts_marketing_updated_at', a."rawPayload"->'contact_accepts_marketing_updated_at') AS "rawPayload"
    FROM abandoned_checkouts a
    WHERE a."rawPayload" ? 'contact_accepts_marketing'
      AND (${since}::timestamp IS NULL OR COALESCE(a."sourceUpdatedAt", a."sourceCreatedAt", a."lastSeenAt") >= ${since})`))
  return rows.map((row) => ({
    nuvemshopCheckoutId: row.nuvemshopCheckoutId,
    email: row.email,
    customerId: row.customerId,
    rawPayload: row.rawPayload,
    capturedAt: row.capturedAt,
  }))
}

async function readUniverseEmails(): Promise<string[]> {
  const rows = await inReadOnlyTx((tx) => tx.$queryRaw<Array<{ em: string }>>(Prisma.sql`
    WITH cust AS (SELECT NULLIF(lower(btrim(c.email)),'') AS em FROM customers c),
    ord_paid AS (
      SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), c.email))),'') AS em
      FROM orders o LEFT JOIN customers c ON c.id = o."customerId"
      WHERE o."paymentStatus" = 'paid' AND lower(o.status) NOT IN ('cancelled','canceled','refunded'))
    SELECT em FROM cust WHERE em IS NOT NULL
    UNION
    SELECT em FROM ord_paid WHERE em IS NOT NULL`))
  return rows.map((row) => row.em)
}

function emptyStateCounts(): UniverseStateCounts {
  return { CONFIRMED_OPT_IN: 0, CONFIRMED_OPT_OUT: 0, UNKNOWN: 0, NOT_COLLECTED: 0 }
}

export async function runBackfillEmailConsent(
  options: BackfillEmailConsentOptions = {},
): Promise<BackfillEmailConsentResult> {
  const dryRun = options.dryRun !== false

  let pepper = options.pepper ?? env.EMAIL_HASH_PEPPER
  if (!dryRun) {
    if (env.CRM_PREVIEW_READONLY) {
      throw new EmailConsentBackfillRefusedError('Escrita recusada: ambiente em modo Preview read-only.')
    }
    // Falha alto (EmailHashPepperNotConfiguredError) se o pepper real faltar.
    hashEmail('pepper-check@example.com', pepper)
  } else if (pepper.length === 0) {
    pepper = randomBytes(32).toString('hex')
  }

  // Sequencial de propósito: as roles do banco têm poucas conexões (mesmo
  // motivo do emailAudienceEngine, que também consulta uma de cada vez).
  const since = options.since ?? null
  const orders = await readOrderRows(since)
  const checkouts = await readCheckoutRows(since)
  const universeEmails = await readUniverseEmails()
  const plan = buildBackfillEvents({ orders, checkouts }, pepper)
  const preview = previewBackfill(plan)

  const stateByHash = new Map<string, keyof UniverseStateCounts>()
  const eventsByHash = new Map<string, typeof plan.events>()
  for (const event of plan.events) {
    const list = eventsByHash.get(event.emailHash) ?? []
    list.push(event)
    eventsByHash.set(event.emailHash, list)
  }
  for (const [hash, events] of eventsByHash) {
    stateByHash.set(hash, resolveEmailConsent(events).state as keyof UniverseStateCounts)
  }

  const universeHashes = new Set<string>()
  for (const email of universeEmails) {
    try {
      universeHashes.add(hashEmail(email, pepper))
    } catch {
      // e-mail fora do formato: não faz parte do universo enviável
    }
  }
  const universeCounts = emptyStateCounts()
  for (const hash of universeHashes) universeCounts[stateByHash.get(hash) ?? 'NOT_COLLECTED']++

  // Duplicatas: eventos da janela que JÁ existem no livro-razão (mesma chave hash+fonte+evidência).
  // Com pepper efêmero (dry-run sem pepper real) os hashes não casam: reporta 0 de forma honesta.
  let duplicates = 0
  if (since !== null && env.EMAIL_HASH_PEPPER.length > 0 && pepper === env.EMAIL_HASH_PEPPER && plan.events.length > 0) {
    const refs = plan.events.map((event) => event.evidenceRef)
    const known = new Set<string>()
    for (let i = 0; i < refs.length; i += 1000) {
      const existing = await prisma.emailConsentEvent.findMany({
        where: { evidenceRef: { in: refs.slice(i, i + 1000) } },
        select: { emailHash: true, source: true, evidenceRef: true },
      })
      for (const row of existing) known.add(`${row.emailHash}|${row.source}|${row.evidenceRef}`)
    }
    duplicates = plan.events.filter((event) => known.has(`${event.emailHash}|${event.source}|${event.evidenceRef}`)).length
  }
  const statusByHash = new Map<string, Set<string>>()
  for (const event of plan.events) {
    const set = statusByHash.get(event.emailHash) ?? new Set<string>()
    set.add(event.status)
    statusByHash.set(event.emailHash, set)
  }
  const incremental: IncrementalBackfillReport | null = since === null ? null : {
    since: since.toISOString(),
    ordersSeen: orders.length,
    checkoutsSeen: checkouts.length,
    wouldCreateOptIn: plan.events.filter((event) => event.status === 'OPT_IN').length,
    wouldCreateOptOut: plan.events.filter((event) => event.status === 'OPT_OUT').length,
    wouldCreateUnknown: 0,
    rowsWithoutSignal: plan.skipped.noSignal,
    duplicates,
    conflicts: [...statusByHash.values()].filter((set) => set.has('OPT_IN') && set.has('OPT_OUT')).length,
  }

  const write = dryRun ? null : await writeBackfill(plan, options.batchSize)

  const result: BackfillEmailConsentResult = {
    mode: dryRun ? 'DRY_RUN' : 'WRITE',
    ordersRead: orders.length,
    checkoutsRead: checkouts.length,
    preview,
    universe: { size: universeHashes.size, byState: universeCounts },
    write,
    incremental,
  }
  logger.info('[backfillEmailConsent] concluido', {
    mode: result.mode,
    eventsTotal: preview.eventsTotal,
    emailsWithEvents: preview.emailsWithEvents,
    universeSize: result.universe.size,
  })
  return result
}
