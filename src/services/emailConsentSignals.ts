// Extração PURA (sem banco, sem env) dos sinais de consentimento de e-mail que
// a Nuvemshop já entrega nos payloads gravados. Formatos observados nos dados
// reais (auditoria de 21/09/2026):
//   - pedido:   rawPayload.customer.accepts_marketing[_updated_at]
//               ou rawPayload.fetchedOrderPayload.customer.accepts_marketing[_updated_at]
//               (pedidos que precisaram de fetch de detalhe ficam embrulhados)
//   - checkout: rawPayload.contact_accepts_marketing[_updated_at]
// Fail-closed: só um BOOLEANO é sinal. String "true", número, null, objeto ou
// chave ausente NÃO viram consentimento nem recusa — a extração devolve null.

export type ConsentSignalStatus = 'OPT_IN' | 'OPT_OUT'

export interface ExtractedConsentSignal {
  status: ConsentSignalStatus
  // accepts_marketing_updated_at do próprio payload, quando for uma data válida.
  sourceUpdatedAt: Date | null
  // Caminho JSON de onde o valor saiu (sem payload, sem PII) — vira parte do evidenceRef.
  evidencePath: string
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Identidade de e-mail: lower + trim (mesma regra do emailAudienceEngine).
// Devolve null para vazio ou formato inválido.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return EMAIL_FORMAT.test(normalized) ? normalized : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function signalFrom(
  container: Record<string, unknown>,
  valueKey: string,
  timestampKey: string,
  evidencePath: string,
): ExtractedConsentSignal | null {
  const value = container[valueKey]
  if (typeof value !== 'boolean') return null
  return {
    status: value ? 'OPT_IN' : 'OPT_OUT',
    sourceUpdatedAt: parseTimestamp(container[timestampKey]),
    evidencePath,
  }
}

export function extractOrderConsentSignal(rawPayload: unknown): ExtractedConsentSignal | null {
  if (!isRecord(rawPayload)) return null

  // Ordem igual à da auditoria: customer na raiz primeiro, depois o embrulhado.
  if (isRecord(rawPayload.customer)) {
    return signalFrom(rawPayload.customer, 'accepts_marketing', 'accepts_marketing_updated_at', 'customer.accepts_marketing')
  }
  const fetched = rawPayload.fetchedOrderPayload
  if (isRecord(fetched) && isRecord(fetched.customer)) {
    return signalFrom(
      fetched.customer,
      'accepts_marketing',
      'accepts_marketing_updated_at',
      'fetchedOrderPayload.customer.accepts_marketing',
    )
  }
  return null
}

export function extractCheckoutConsentSignal(rawPayload: unknown): ExtractedConsentSignal | null {
  if (!isRecord(rawPayload)) return null
  return signalFrom(
    rawPayload,
    'contact_accepts_marketing',
    'contact_accepts_marketing_updated_at',
    'contact_accepts_marketing',
  )
}
