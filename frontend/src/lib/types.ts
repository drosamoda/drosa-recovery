// Shape extraido de src/services/crmReadService.ts (dashboard()) no backend
// drosa-recovery. Nao inventar campos alem do que o endpoint real devolve.
export interface DashboardResponse {
  period: { from: string; to: string }
  messages: {
    total: number
    sent: number
    delivered: number | null
    read: number | null
    [status: string]: number | null | undefined
  }
  contactedCustomers: number
  inboundMessages: number
  inboundConversations: number
  abandonedCheckouts: number
  eligibleCheckouts: number | null
  convertedCheckouts: number
  pixPending: number
  boletoPending: number
}

export type DashboardPeriod = 'today' | '7d' | '30d'

// ---------------------------------------------------------------------------
// Shapes extraidos de src/services/crmReadService.ts (customers/customer) e
// src/services/crmJourneyService.ts (list/detail). Nao inventar campo alem do
// que o endpoint real devolve.
// ---------------------------------------------------------------------------

export interface Pagination {
  page: number
  pageSize: number
  total: number
  pages?: number
}

export interface CustomerListItem {
  id: string
  name: string
  phone: string | null
  email: string | null
  orders: number
  lastOrder: string | null
  lastContact: string | null
  consent: 'GRANTED' | 'REVOKED' | 'UNKNOWN'
  optOut: boolean
  suppressed: boolean
  messages: number
  conversations: number
}

export interface CustomersResponse {
  data: CustomerListItem[]
  pagination: Pagination
}

export interface CustomerConsent {
  scope: string
  consented: boolean
  source: string | null
  consentedAt: string | null
  revokedAt: string | null
}

export interface CustomerOrder {
  id: string
  orderNumber: string
  total: number | string
  paymentStatus: string
  paymentMethod: string | null
  status: string
  date: string | null
}

export interface CustomerCheckout {
  id: string
  checkout: string
  total: number | string
  products: string | null
  status: string
  date: string | null
}

export interface CustomerMessage {
  id: string
  templateName: string | null
  status: string
  entityType: string
  entityId: string | null
  createdAt: string
}

export interface CustomerConversationRef {
  id: string
  status: string
  lastMessageAt: string | null
}

export interface CustomerDetail {
  id: string
  name: string
  phone: string | null
  email: string | null
  optOut: boolean
  suppression: { reason: string; source: string | null; suppressedAt: string } | null
  consents: CustomerConsent[]
  orders: CustomerOrder[]
  checkouts: CustomerCheckout[]
  messages: CustomerMessage[]
  conversations: CustomerConversationRef[]
}

// Jornada (/crm-api/journey, /crm-api/journey/:id) — chave e telefone, nao
// customer.id; para abrir a partir do Cliente 360 usa-se o prefixo
// `customer:<id>` que o backend resolve para o telefone certo.
export interface JourneyMessage {
  id: string
  direction: 'inbound' | 'outbound'
  template: string | null
  body: string | null
  status: string
  messageAt: string | null
  statusAt: string | null
  failureCategory: string | null
  reference: string | null
  metaMessageId: string | null
  flow: string
}

export interface JourneyEvent {
  type: string
  at: string | null
  source: string
  reference: string | null
  status: string | null
  template?: string | null
  related?: string | null
}

export interface JourneyListRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  lastAction: string | null
  lastActionAt: string | null
  actionSource: string | null
  related: string | null
  lastMessage: JourneyMessage | null
  lastInboundAt: string | null
  consent: 'GRANTED' | 'REVOKED' | 'UNKNOWN'
  optOut: boolean
  suppressed: boolean
  messageCount: number
  orderCount: number
  checkoutCount: number
  flow: string | null
  responded: boolean
}

export interface JourneyKpis {
  activeToday: number
  abandonedCheckouts: number
  orders: number
  contactedCustomers: number
  delivered: number
  read: number
  failed: number
  responses: number
}

export interface JourneyListResponse {
  data: JourneyListRow[]
  kpis: JourneyKpis
  pagination: Pagination
  coverage: { identified: number; source: string; siteBehavior: string }
}

export interface JourneyDetail extends JourneyListRow {
  timeline: JourneyEvent[]
  messages: JourneyMessage[]
}
