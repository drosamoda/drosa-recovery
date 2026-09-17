import axios from 'axios'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { subtractHours } from '../helpers/dateService'

export type NuvemshopCheckout = {
  id: number | string
  token?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  total?: string
  currency?: string
  products?: Array<{ name?: string; quantity?: number }>
  checkout_url?: string
  abandoned_checkout_url?: string
  created_at?: string
  updated_at?: string
  [key: string]: unknown
}

export type NuvemshopOrder = {
  id: number | string
  number?: number | string
  status?: string
  payment_status?: string
  payment_details?: { method?: string }
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  total?: string | number
  currency?: string
  checkout_url?: string
  created_at?: string
  updated_at?: string
  // Metadados custom do pedido (setados via API ou order:add:extra do checkout).
  extra?: unknown
  [key: string]: unknown
}

type FetchParams = {
  lookbackHours?: number
}

type HttpLikeError = {
  code?: string
  response?: {
    status?: number
    data?: unknown
  }
}

type HeaderLike = Record<string, unknown> & {
  get?: (name: string) => unknown
}

const CHECKOUT_DETAIL_CONCURRENCY = 4
const ORDER_PAGE_SIZE = 50
const ORDER_PAGE_MAX_ATTEMPTS = 3

export class NuvemshopHistoryUnavailableError extends Error {
  readonly upstreamStatus = 404

  constructor(
    readonly requestedCreatedAtMax: Date,
    readonly oldestAvailableAt: Date
  ) {
    super('Nuvemshop order history is unavailable for the requested period')
    this.name = 'NuvemshopHistoryUnavailableError'
  }
}

function validDate(value?: string): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function needsCheckoutDetail(checkout: NuvemshopCheckout): boolean {
  return !checkout.contact_phone || !checkout.contact_name ||
    !(checkout.abandoned_checkout_url || checkout.checkout_url) || !checkout.created_at
}

function isTransientCheckoutPageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as HttpLikeError
  if (['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(candidate.code ?? '')) {
    return true
  }

  const status = candidate.response?.status
  return status === 429 || (typeof status === 'number' && status >= 500 && status <= 599)
}

function getHeader(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== 'object') return undefined

  const candidate = headers as HeaderLike
  if (typeof candidate.get === 'function') {
    const value = candidate.get(name)
    if (value !== undefined && value !== null) return value
  }

  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(candidate)) {
    if (key.toLowerCase() === wanted) return value
  }

  return undefined
}

function parseTotalCount(headers: unknown): number | null {
  const raw = getHeader(headers, 'x-total-count')
  const parsed = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN

  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.floor(parsed)
}

function linkPaginationState(headers: unknown): 'next' | 'terminal' | 'unknown' {
  const raw = getHeader(headers, 'link')
  if (raw === undefined || raw === null) return 'unknown'

  const value = Array.isArray(raw) ? raw.join(',') : String(raw)
  if (!value.trim()) return 'unknown'

  const hasNext = /rel\s*=\s*(?:"[^"]*\bnext\b[^"]*"|'[^']*\bnext\b[^']*'|next)(?:\s*;|\s*,|\s*$)/i.test(value)
  return hasNext ? 'next' : 'terminal'
}

function getUpstreamStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as HttpLikeError).response?.status
  return typeof status === 'number' ? status : null
}

function isNuvemshopEmptyHistoryPage(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as HttpLikeError
  if (candidate.response?.status !== 404) return false

  const data = candidate.response.data
  if (!data || typeof data !== 'object') return false

  const description = (data as { description?: unknown }).description
  return typeof description === 'string' && description.trim().toLowerCase() === 'last page is 0'
}

async function fetchOldestVisibleOrderDate(
  client: ReturnType<typeof buildNuvemshopClient>
): Promise<Date | null> {
  const firstPage = await client.get<NuvemshopOrder[]>('/orders', {
    params: { page: 1, per_page: 1, fields: 'id,created_at' },
    timeout: 30000,
  })
  const totalCount = parseTotalCount(firstPage.headers)
  if (totalCount === null || totalCount < 1) return null

  const lastPage = await client.get<NuvemshopOrder[]>('/orders', {
    params: { page: totalCount, per_page: 1, fields: 'id,created_at' },
    timeout: 30000,
  })
  const oldest = Array.isArray(lastPage.data) ? lastPage.data[0] : undefined
  return validDate(oldest?.created_at)
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as HttpLikeError).code
  return typeof code === 'string' && code ? code : null
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
  return results
}

function buildNuvemshopClient() {
  return axios.create({
    baseURL: `https://api.nuvemshop.com.br/${env.NUVEMSHOP_API_VERSION}/${env.NUVEMSHOP_STORE_ID}`,
    headers: {
      Authorization: `Bearer ${env.NUVEMSHOP_ACCESS_TOKEN}`,
      'User-Agent': env.NUVEMSHOP_USER_AGENT,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  })
}

async function fetchCheckoutPage(
  client: ReturnType<typeof buildNuvemshopClient>,
  page: number
) {
  const request = () => client.get<NuvemshopCheckout[]>('/checkouts', {
    params: {
      per_page: 200,
      page,
    },
  })

  try {
    return await request()
  } catch (error) {
    if (!isTransientCheckoutPageError(error)) throw error
    return request()
  }
}

async function fetchOrderPage(
  client: ReturnType<typeof buildNuvemshopClient>,
  page: number,
  createdAtMin: Date,
  createdAtMax: Date
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.get<NuvemshopOrder[]>('/orders', {
        params: {
          page,
          per_page: ORDER_PAGE_SIZE,
          created_at_min: createdAtMin.toISOString(),
          created_at_max: createdAtMax.toISOString(),
        },
        timeout: 30000,
      })
    } catch (error) {
      if (attempt < ORDER_PAGE_MAX_ATTEMPTS && isTransientCheckoutPageError(error)) {
        continue
      }

      logger.error('[nuvemshopService] order page fetch failed', {
        operation: 'nuvemshop_orders_page',
        page,
        createdAtMin: createdAtMin.toISOString(),
        createdAtMax: createdAtMax.toISOString(),
        upstreamStatus: getUpstreamStatus(error),
        errorCode: getErrorCode(error),
      })
      throw error
    }
  }
}

export const nuvemshopService = {
  async fetchAbandonedCheckouts(params: FetchParams = {}): Promise<NuvemshopCheckout[]> {
    const lookbackHours = Math.max(
      params.lookbackHours ?? env.ABANDONED_CART_LOOKBACK_HOURS,
      env.ABANDONED_CART_OVERLAP_HOURS
    )
    const since = subtractHours(new Date(), lookbackHours)
    const client = buildNuvemshopClient()

    let page = 1
    const allCheckouts: NuvemshopCheckout[] = []

    for (;;) {
      const response = await fetchCheckoutPage(client, page)

      const data = response.data
      if (!Array.isArray(data) || data.length === 0) break

      // Filtragem local de segurança caso a API ignore o filtro de data
      const filtered = data.filter((c) => {
        const updatedAt = validDate(c.updated_at)
        const createdAt = validDate(c.created_at)
        const ref = updatedAt ?? createdAt
        if (!ref) return true
        return ref >= since
      })

      const enriched = await mapWithConcurrency(
        filtered,
        CHECKOUT_DETAIL_CONCURRENCY,
        async (checkout) => {
          if (!needsCheckoutDetail(checkout)) return checkout

          try {
            const detail = await client.get<NuvemshopCheckout>(`/checkouts/${checkout.id}`)
            return { ...checkout, ...detail.data }
          } catch {
            // The list payload is still useful and remains fail-closed at eligibility.
            return checkout
          }
        }
      )

      allCheckouts.push(...enriched)

      // Se recebeu menos que o máximo, não há mais páginas
      if (data.length < 200) break
      page++
    }

    return allCheckouts
  },

  async fetchCheckoutById(checkoutId: string | number): Promise<NuvemshopCheckout> {
    const client = buildNuvemshopClient()
    const response = await client.get<NuvemshopCheckout>(`/checkouts/${checkoutId}`)
    return response.data
  },

  async fetchOrderById(orderId: string | number): Promise<unknown> {
    const client = buildNuvemshopClient()
    const response = await client.get(`/orders/${orderId}`)
    return response.data
  },

  async getOrder(orderId: string | number): Promise<unknown> {
    return nuvemshopService.fetchOrderById(orderId)
  },

  async fetchOrders(params: { createdAtMin: Date; createdAtMax: Date }): Promise<NuvemshopOrder[]> {
    const client = buildNuvemshopClient()
    const orders: NuvemshopOrder[] = []

    for (let page = 1; ; page++) {
      let response
      try {
        response = await fetchOrderPage(client, page, params.createdAtMin, params.createdAtMax)
      } catch (error) {
        if (page !== 1 || !isNuvemshopEmptyHistoryPage(error)) throw error

        const oldestAvailableAt = await fetchOldestVisibleOrderDate(client)
        if (!oldestAvailableAt || params.createdAtMax >= oldestAvailableAt) throw error

        throw new NuvemshopHistoryUnavailableError(params.createdAtMax, oldestAvailableAt)
      }
      const data = Array.isArray(response.data) ? response.data : []
      orders.push(...data)

      const totalCount = parseTotalCount(response.headers)
      if (totalCount !== null) {
        if (orders.length >= totalCount) break
        continue
      }

      const linkState = linkPaginationState(response.headers)
      if (linkState === 'terminal') break
      if (linkState === 'next') continue

      if (data.length < ORDER_PAGE_SIZE) break
    }

    return orders
  },
}
