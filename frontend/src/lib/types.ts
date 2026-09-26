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
