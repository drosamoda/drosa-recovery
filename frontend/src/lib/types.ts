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

// ---------------------------------------------------------------------------
// Fases B/C/D — shapes validados contra a API REAL de producao (27/09), nao
// so pelo TypeScript do backend. Achados: totais monetarios vem como string
// (Decimal do Prisma); metaStatus de template e sempre 'NOT_AVAILABLE';
// /ai/campaigns e /ai/learning respondem 503 AI_DATABASE_NOT_CONFIGURED.
// ---------------------------------------------------------------------------

export interface ListResponse<T> {
  data: T[]
  pagination: Pagination
}

export type MessageStatus = 'pending' | 'processing' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'unknown'

export interface MessageListItem {
  id: string
  createdAt: string
  customer: string | null
  phone: string | null
  source: string | null
  entityType: string
  entityId: string | null
  template: string | null
  status: string
  attempts: number
  conversion: null
  failureCategory: string | null
}

export interface MessageDetail {
  id: string
  customer: { id: string; name: string } | null
  phone: string | null
  source: string | null
  entityType: string
  entityId: string | null
  templateName: string | null
  templateLanguage: string | null
  status: string
  scheduledAt: string | null
  acceptedAt: string | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  retryCount: number
  nextRetryAt: string | null
  reason: string | null
  errorCode: string | null
  failureCategory: string | null
  mirrorStatus: string | null
  timeline: { stage: string; at: string | null }[]
}

export interface TemplateItem {
  id: string
  name: string
  eventType: string
  metaTemplateName: string
  languageCode: string
  category: string
  messagePreview: string | null
  active: boolean
  usageCount: number
  lastUsedAt: string | null
  metaStatus: string
}

export interface ConversationListItem {
  id: string
  contact: string | null
  phone: string | null
  status: string
  lastMessageAt: string | null
  lastInboundAt: string | null
  preview: string | null
}

export interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound' | string
  type: string
  body: string | null
  status: string | null
  timestamp: string | null
  createdAt: string
}

export interface ConversationDetail {
  id: string
  status: string
  lastMessageAt: string | null
  lastInboundAt: string | null
  contact: { id: string; phone: string | null; name: string | null }
  messages: ConversationMessage[]
}

export interface CheckoutItem {
  id: string
  checkout: string
  customer: string | null
  phone: string | null
  products: string | null
  total: string | number
  currency: string | null
  date: string | null
  status: string
  eligible: boolean | null
  blockers: string[]
  message: { id: string; template: string | null; status: string } | null
  convertedAt: string | null
  convertedOrderId: string | null
}

export interface PaymentItem {
  id: string
  order: string
  customer: string | null
  phone: string | null
  total: string | number
  date: string | null
  paymentStatus: string
  orderStatus: string
  template: string | null
  messageStatus: string | null
  error: { category: string | null; reason: string | null; errorCode: string | null; retries: number } | null
}

export interface RemarketingRecipient {
  id: string
  entityType: string
  templateName: string
  status: string
  reason: string | null
  eligibilitySnapshot: { reasons?: string[]; segment?: string; template?: string; checkedAt?: string } | null
  createdAt: string
}

export interface RemarketingRun {
  id: string
  segment: string
  mode: string
  status: string
  candidateCount: number
  eligibleCount: number
  sentCount: number
  skippedCount: number
  failedCount: number
  startedAt: string
  completedAt: string | null
  recipients: RemarketingRecipient[]
}

export interface RemarketingResponse extends ListResponse<RemarketingRun> {
  runtime: { enabled: boolean; automationSendEnabled: boolean; dryRun: boolean }
}

export interface AutomationRule {
  id: string
  name: string
  eventType: string
  templateName: string
  delayMinutes: number
  active: boolean
  maxSendsPerEntity: number
  stopIfOrderExists: boolean
  runtime: { cronEnabled: boolean; automationSendEnabled: boolean; flowEnabled: boolean; whatsappDryRun: boolean }
}

export interface WebhookEvidence {
  createdAt: string
  processed: boolean
  hmacValid: boolean
  error: string | null
}

export interface HealthResponse {
  meta: { configured: boolean; latestEvidence: WebhookEvidence | null }
  nuvemshop: { configured: boolean; latestEvidence: WebhookEvidence | null }
  recoveryEngine: { pending: number; processing: number; failed: number; unknown: number; oldestPending: string | null }
  inboxMirror: { failed: number; latestSuccess: string | null }
  runtime: Record<string, boolean | null | undefined>
}

export interface AuditEvent {
  id: string
  provider: string
  topic: string | null
  externalId: string | null
  hmacValid: boolean
  processed: boolean
  processedAt: string | null
  error: string | null
  createdAt: string
}

export interface AuditResponse extends ListResponse<AuditEvent> {
  fullAuditLog: { status: string; missing: string[] }
}

export interface Opportunity {
  id: string
  channel: string
  type: string
  title: string
  reason: string
  audienceCount: number
  eligibleCount: number | null
  blockedCount: number
  recommendedTiming: string | null
  recommendedChannel: string | null
  confidence: string | null
  eligibilityStatus?: string
  withValidEmailCount?: number
  evidence?: { topBlockers?: { reason: string; count: number }[]; template?: string }
}

export interface EmailSegment {
  segmentKey: string
  name: string
  objective: string
  status: string
  audienceCount: number
  withValidEmailCount: number
  sendEligibleCount: number | null
  // Opt-in confirmado no ledger (e-mails válidos ≠ elegíveis por consentimento). null = ledger indisponível.
  consentOptInCount?: number | null
  blockedCount: number
  eligibilityStatus: string
  dataQuality: { level: string; notes: string[] }
}

export interface EmailAudiences {
  generatedAt: string
  consentSource: string
  sendEligibility: string
  suppression: { status: string; excludedCount: number }
  base: { totalCustomers: number; emailKnown: number; emailValid: number; emailInvalid: number; buyers: number }
  segments: EmailSegment[]
}

export interface EmailRecommendation {
  campaignKey: string
  campaignName: string
  segmentName: string
  audienceCount: number
  withValidEmailCount: number
  sendEligibleCount: number | null
  priority: number
  requirementsStatus: string
  sendBlockers: string[]
  actionable: boolean
  confidence: string
}

export interface EmailRecommendations {
  generatedAt: string
  plan: EmailRecommendation[]
  summary: { total: number; planned: number; actionable: number; needsData: number; superseded: number }
}

export interface EmailLibrary {
  libraryVersion: string
  total: number
  ready: number
  needsData: number
  sendGate: { allowed: boolean; missing: string[] }
}
