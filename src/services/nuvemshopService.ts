import axios from 'axios'
import { env } from '../config/env'
import { subtractHours } from '../helpers/dateService'

type NuvemshopCheckout = {
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
    const lookbackHours = params.lookbackHours ?? env.ABANDONED_CART_LOOKBACK_HOURS
    const since = subtractHours(new Date(), lookbackHours)
    const sinceIso = since.toISOString()

    const client = buildNuvemshopClient()

    let page = 1
    const allCheckouts: NuvemshopCheckout[] = []

    while (true) {
      const response = await client.get<NuvemshopCheckout[]>('/checkouts', {
        params: {
          updated_at_min: sinceIso,
          per_page: 200,
          page,
        },
      })

      const data = response.data
      if (!Array.isArray(data) || data.length === 0) break

      // Filtragem local de segurança caso a API ignore o filtro de data
      const filtered = data.filter((c) => {
        const updatedAt = c.updated_at ? new Date(c.updated_at) : null
        const createdAt = c.created_at ? new Date(c.created_at) : null
        const ref = updatedAt ?? createdAt
        if (!ref) return true
        return ref >= since
      })

      allCheckouts.push(...filtered)

      // Se recebeu menos que o máximo, não há mais páginas
      if (data.length < 200) break
      page++
    }

    return allCheckouts
  },

  async fetchOrderById(orderId: string): Promise<unknown> {
    const client = buildNuvemshopClient()
    const response = await client.get(`/orders/${orderId}`)
    return response.data
  },

  async getOrder(orderId: string): Promise<unknown> {
    return nuvemshopService.fetchOrderById(orderId)
  },
}
