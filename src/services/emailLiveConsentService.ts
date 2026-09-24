import axios from 'axios'
import { env } from '../config/env'
import { recordEmailConsentEvent } from './emailConsentService'
import { normalizeEmail } from './emailConsentSignals'

interface NuvemshopCustomerConsent {
  id: number
  email?: string | null
  accepts_marketing?: boolean | null
  accepts_marketing_updated_at?: string | null
}

export type LiveEmailConsentRefreshResult =
  | { ok: true; matchedCustomers: number; recordedEvents: number }
  | { ok: false; reason: 'INVALID_EMAIL' | 'NOT_FOUND' | 'UNKNOWN_PREFERENCE' | 'UPSTREAM_ERROR' }

function validDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Refreshes one recipient from Nuvemshop immediately before a marketing send.
// This is deliberately fail-closed: no customer, unknown preference, invalid
// timestamp/response or upstream error means the recipient cannot proceed.
//
// We persist only the normalized consent event (hashed by recordEmailConsentEvent);
// no payload, address, phone, CPF or name is written to the consent ledger.
export async function refreshEmailConsentFromNuvemshop(email: string): Promise<LiveEmailConsentRefreshResult> {
  const normalized = normalizeEmail(email)
  if (normalized === null) return { ok: false, reason: 'INVALID_EMAIL' }
  if (!env.NUVEMSHOP_ACCESS_TOKEN || !env.NUVEMSHOP_STORE_ID) {
    return { ok: false, reason: 'UPSTREAM_ERROR' }
  }

  let customers: NuvemshopCustomerConsent[]
  try {
    const response = await axios.get<NuvemshopCustomerConsent[]>(
      `https://api.nuvemshop.com.br/${env.NUVEMSHOP_API_VERSION}/${env.NUVEMSHOP_STORE_ID}/customers`,
      {
        params: {
          email: normalized,
          per_page: 20,
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
    customers = Array.isArray(response.data) ? response.data : []
  } catch {
    return { ok: false, reason: 'UPSTREAM_ERROR' }
  }

  const matches = customers.filter((customer) => normalizeEmail(customer.email) === normalized)
  if (matches.length === 0) return { ok: false, reason: 'NOT_FOUND' }
  if (matches.some((customer) => typeof customer.accepts_marketing !== 'boolean')) {
    return { ok: false, reason: 'UNKNOWN_PREFERENCE' }
  }

  let recordedEvents = 0
  for (const customer of matches) {
    const sourceUpdatedAt = validDate(customer.accepts_marketing_updated_at)
    if (sourceUpdatedAt === null) return { ok: false, reason: 'UNKNOWN_PREFERENCE' }

    await recordEmailConsentEvent({
      email: normalized,
      customerId: String(customer.id),
      status: customer.accepts_marketing ? 'OPT_IN' : 'OPT_OUT',
      source: 'NUVEMSHOP_CUSTOMER_API',
      evidenceRef: `customer:${customer.id}:accepts_marketing:${sourceUpdatedAt.toISOString()}`,
      sourceUpdatedAt,
      capturedAt: new Date(),
    })
    recordedEvents++
  }

  return { ok: true, matchedCustomers: matches.length, recordedEvents }
}
