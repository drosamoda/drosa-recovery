import axios from 'axios'
import { env } from '../config/env'
import {
  recordEmailConsentEventsBatch,
  type RecordConsentEventInput,
  type RecordConsentEventsBatchResult,
} from '../services/emailConsentService'
import { normalizeEmail } from '../services/emailConsentSignals'

interface NuvemshopCustomerConsent {
  id?: number | string
  email?: string | null
  accepts_marketing?: boolean | null
  accepts_marketing_updated_at?: string | null
}

type HttpLikeError = {
  code?: unknown
  response?: { status?: unknown }
}

const PAGE_SIZE = 200
const MAX_PAGES = 250
const MAX_ATTEMPTS = 4

export class EmailConsentSyncError extends Error {
  constructor(
    readonly code: 'CONFIG_MISSING' | 'UPSTREAM_UNAVAILABLE' | 'INVALID_RESPONSE' | 'PAGINATION_LIMIT',
    readonly upstreamStatus: number | null = null,
  ) {
    super(code)
    this.name = 'EmailConsentSyncError'
  }
}
export interface EmailConsentSyncResult {
  customersFetched: number
  pagesFetched: number
  expectedTotal: number | null
  liveOptIn: number
  liveOptOut: number
  skippedNoEmail: number
  skippedInvalidEmail: number
  skippedUnknownPreference: number
  skippedInvalidUpdatedAt: number
  skippedInvalidCustomerId: number
  duplicateEmailRows: number
  signalsPrepared: number
  uniqueHashes: number
  eventsInserted: number
  statesRecomputed: number
  apiRequests: number
  retryableErrors: number
  rateLimitErrors: number
}

interface PageResult {
  data: NuvemshopCustomerConsent[]
  total: number | null
}

interface SyncStats {
  apiRequests: number
  retryableErrors: number
  rateLimitErrors: number
}

function validDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
function upstreamStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as HttpLikeError).response?.status
  return typeof status === 'number' ? status : null
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as HttpLikeError).code
  return typeof code === 'string' ? code : null
}

function isRetryable(error: unknown): boolean {
  const status = upstreamStatus(error)
  if (status === 429 || (status !== null && status >= 500 && status <= 599)) return true
  return ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ERR_NETWORK'].includes(errorCode(error) ?? '')
}

function parseTotal(headers: unknown): number | null {
  if (!headers || typeof headers !== 'object') return null
  const candidate = headers as Record<string, unknown> & { get?: (name: string) => unknown }
  const raw = typeof candidate.get === 'function'
    ? candidate.get('x-total-count')
    : Object.entries(candidate).find(([key]) => key.toLowerCase() === 'x-total-count')?.[1]
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}
async function fetchPage(
  page: number,
  stats: SyncStats,
  sleep: (ms: number) => Promise<void>,
): Promise<PageResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    stats.apiRequests++
    try {
      const response = await axios.get<NuvemshopCustomerConsent[]>(
        `https://api.nuvemshop.com.br/${env.NUVEMSHOP_API_VERSION}/${env.NUVEMSHOP_STORE_ID}/customers`,
        {
          params: {
            page,
            per_page: PAGE_SIZE,
            fields: 'id,email,accepts_marketing,accepts_marketing_updated_at',
          },
          headers: {
            Authorization: `Bearer ${env.NUVEMSHOP_ACCESS_TOKEN}`,
            'User-Agent': env.NUVEMSHOP_USER_AGENT,
            Accept: 'application/json',
          },
          timeout: 15000,
        },
      )
      if (!Array.isArray(response.data)) throw new EmailConsentSyncError('INVALID_RESPONSE', response.status ?? null)
      return { data: response.data, total: parseTotal(response.headers) }
    } catch (error) {
      if (error instanceof EmailConsentSyncError) throw error
      const status = upstreamStatus(error)
      if (status === 429) stats.rateLimitErrors++
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
        throw new EmailConsentSyncError('UPSTREAM_UNAVAILABLE', status)
      }
      stats.retryableErrors++
      await sleep(1500 * attempt)
    }
  }
  throw new EmailConsentSyncError('UPSTREAM_UNAVAILABLE')
}
export async function runEmailConsentSync(
  options: {
    sleep?: (ms: number) => Promise<void>
    capturedAt?: Date
    writeBatch?: (events: readonly RecordConsentEventInput[]) => Promise<RecordConsentEventsBatchResult>
  } = {},
): Promise<EmailConsentSyncResult> {
  if (!env.NUVEMSHOP_ACCESS_TOKEN || !env.NUVEMSHOP_STORE_ID) {
    throw new EmailConsentSyncError('CONFIG_MISSING')
  }

  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const capturedAt = options.capturedAt ?? new Date()
  const writeBatch = options.writeBatch ?? ((events) => recordEmailConsentEventsBatch(events))
  const stats: SyncStats = { apiRequests: 0, retryableErrors: 0, rateLimitErrors: 0 }
  const events: RecordConsentEventInput[] = []
  const seenEmails = new Set<string>()

  let customersFetched = 0
  let pagesFetched = 0
  let expectedTotal: number | null = null
  let liveOptIn = 0
  let liveOptOut = 0
  let skippedNoEmail = 0
  let skippedInvalidEmail = 0
  let skippedUnknownPreference = 0
  let skippedInvalidUpdatedAt = 0
  let skippedInvalidCustomerId = 0
  let duplicateEmailRows = 0
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await fetchPage(page, stats, sleep)
    pagesFetched++
    if (page === 1) expectedTotal = result.total

    for (const customer of result.data) {
      customersFetched++
      const rawEmail = typeof customer.email === 'string' ? customer.email : ''
      if (!rawEmail.trim()) {
        skippedNoEmail++
        continue
      }
      const email = normalizeEmail(rawEmail)
      if (email === null) {
        skippedInvalidEmail++
        continue
      }
      if (seenEmails.has(email)) duplicateEmailRows++
      seenEmails.add(email)

      if (typeof customer.accepts_marketing !== 'boolean') {
        skippedUnknownPreference++
        continue
      }
      const sourceUpdatedAt = validDate(customer.accepts_marketing_updated_at)
      if (sourceUpdatedAt === null) {
        skippedInvalidUpdatedAt++
        continue
      }
      const customerId = customer.id === undefined || customer.id === null ? '' : String(customer.id).trim()
      if (!customerId) {
        skippedInvalidCustomerId++
        continue
      }

      if (customer.accepts_marketing) liveOptIn++
      else liveOptOut++
      events.push({
        email,
        customerId,
        status: customer.accepts_marketing ? 'OPT_IN' : 'OPT_OUT',
        source: 'NUVEMSHOP_CUSTOMER_API',
        evidenceRef: `customer:${customerId}:accepts_marketing:${sourceUpdatedAt.toISOString()}`,
        sourceUpdatedAt,
        capturedAt,
      })
    }
    if (result.data.length === 0) break
    if (expectedTotal !== null && customersFetched >= expectedTotal) break
    if (result.data.length < PAGE_SIZE) break
    if (page === MAX_PAGES) throw new EmailConsentSyncError('PAGINATION_LIMIT')
    await sleep(650)
  }

  const written = await writeBatch(events)
  return {
    customersFetched,
    pagesFetched,
    expectedTotal,
    liveOptIn,
    liveOptOut,
    skippedNoEmail,
    skippedInvalidEmail,
    skippedUnknownPreference,
    skippedInvalidUpdatedAt,
    skippedInvalidCustomerId,
    duplicateEmailRows,
    signalsPrepared: events.length,
    uniqueHashes: written.uniqueHashes,
    eventsInserted: written.eventsInserted,
    statesRecomputed: written.statesRecomputed,
    apiRequests: stats.apiRequests,
    retryableErrors: stats.retryableErrors,
    rateLimitErrors: stats.rateLimitErrors,
  }
}
