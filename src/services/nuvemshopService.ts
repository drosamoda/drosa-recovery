import axios from 'axios'
import { env } from '../config/env'
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

type FetchParams = {
  lookbackHours?: number
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

function buildNuvemshopClient() {
  return axios.create({
    baseURL: `https://api.nuvemshop.com.br/${env.NUVEMSHOP_API_VERSION}/${env.NUVEMSHOP_STORE_ID}`,
    headers: {
      Authentication: `bearer ${env.NUVEMSHOP_ACCESS_TOKEN}`,
      'User-Agent': env.NUVEMSHOP_USER_AGENT,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  })
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
      const response = await client.get<NuvemshopCheckout[]>('/checkouts', {
        params: {
          per_page: 200,
          page,
        },
      })

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

      for (const checkout of filtered) {
        if (!needsCheckoutDetail(checkout)) {
          allCheckouts.push(checkout)
          continue
        }
        try {
          const detail = await client.get<NuvemshopCheckout>(`/checkouts/${checkout.id}`)
          allCheckouts.push({ ...checkout, ...detail.data })
        } catch {
          // The list payload is still useful and remains fail-closed at eligibility.
          allCheckouts.push(checkout)
        }
      }

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
}
