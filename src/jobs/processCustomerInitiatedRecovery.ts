import { randomUUID } from 'crypto'
import { MessageStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { inboxService } from '../services/inboxService'
import { isWithinWhatsappCustomerCareWindow } from '../helpers/inboxWindow'
import {
  RECOVERY_SOURCE,
  buildRecoveryReply,
  matchRecoveryCheckout,
} from '../services/customerInitiatedRecovery'

// Processa as intenções registradas pelo webhook. Nunca roda dentro do webhook.
// Fail-closed: flag desligada → nada; claim atômico pending→processing → no máximo UMA resposta
// por inbound; sem retry automático após tentativa de envio (evita duplicidade). Resultados
// não-envio (skipped) e handoff nunca são falhas.
export const RECOVERY_MAX_PER_RUN = 20

export interface CustomerRecoveryResult {
  enabled: boolean
  found: number
  claimed: number
  sent: number
  simulated: number
  handoff: number
  skipped: number
  failed: number
}

type Outcome =
  | { kind: 'sent' | 'simulated' }
  | { kind: 'handoff'; reason: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string }

async function markDone(id: string, status: MessageStatus, reason: string | null, extra: object = {}): Promise<void> {
  await prisma.messageLog.update({
    where: { id },
    data: { status, reason, claimOwner: null, claimExpiresAt: null, ...(status === 'sent' ? { sentAt: new Date() } : {}), ...extra },
  })
}

async function handoff(conversationId: string): Promise<void> {
  await prisma.conversation.update({ where: { id: conversationId }, data: { status: 'open', assignedTo: null } })
}

async function processOne(msg: { id: string; entityId: string; normalizedPhone: string }, now: Date): Promise<Outcome> {
  const conversation = await prisma.conversation.findUnique({ where: { id: msg.entityId }, include: { contact: true } })
  if (!conversation || conversation.contact.phone !== msg.normalizedPhone) return { kind: 'skipped', reason: 'conversation_mismatch' }

  const [customer, suppression] = await Promise.all([
    prisma.customer.findFirst({ where: { normalizedPhone: msg.normalizedPhone }, select: { optOut: true } }),
    prisma.suppression.findUnique({ where: { normalizedPhone: msg.normalizedPhone }, select: { id: true } }),
  ])
  if (customer?.optOut || suppression) return { kind: 'skipped', reason: 'opt_out' }

  if (!isWithinWhatsappCustomerCareWindow(conversation.lastInboundAt, now)) {
    await handoff(conversation.id)
    return { kind: 'handoff', reason: 'handoff_outside_window' }
  }

  const match = await matchRecoveryCheckout(msg.normalizedPhone, now)
  if (match.kind !== 'match') {
    await handoff(conversation.id)
    return { kind: 'handoff', reason: match.kind === 'none' ? 'handoff_no_recent_cart' : 'handoff_ambiguous_cart' }
  }

  const text = buildRecoveryReply(match.checkout)
  if (!text) {
    await handoff(conversation.id)
    return { kind: 'handoff', reason: 'handoff_invalid_checkout_url' }
  }

  const sent = await inboxService.sendManualTextMessage(conversation.id, text)
  if (!sent.success) return { kind: 'failed', reason: 'send_failed' }
  return { kind: sent.dryRun ? 'simulated' : 'sent' }
}

export async function runProcessCustomerInitiatedRecovery(): Promise<CustomerRecoveryResult> {
  const result: CustomerRecoveryResult = { enabled: env.CUSTOMER_INITIATED_RECOVERY_ENABLED, found: 0, claimed: 0, sent: 0, simulated: 0, handoff: 0, skipped: 0, failed: 0 }
  if (!env.CUSTOMER_INITIATED_RECOVERY_ENABLED) return result

  const now = new Date()
  const rows = await prisma.messageLog.findMany({
    where: { source: RECOVERY_SOURCE, status: MessageStatus.pending },
    orderBy: { scheduledAt: 'asc' },
    take: RECOVERY_MAX_PER_RUN,
    select: { id: true, entityId: true, normalizedPhone: true },
  })
  result.found = rows.length

  const claimOwner = randomUUID()
  const claimExpiresAt = new Date(now.getTime() + env.MESSAGE_CLAIM_LEASE_SECONDS * 1000)

  for (const row of rows) {
    const claim = await prisma.messageLog.updateMany({
      where: { id: row.id, status: MessageStatus.pending },
      data: { status: MessageStatus.processing, claimOwner, claimExpiresAt },
    })
    if (claim.count !== 1) continue
    result.claimed++

    try {
      const outcome = await processOne(row, now)
      if (outcome.kind === 'sent') {
        await markDone(row.id, MessageStatus.sent, null)
        result.sent++
      } else if (outcome.kind === 'simulated') {
        await markDone(row.id, MessageStatus.skipped, 'inbox_send_dry_run')
        result.simulated++
      } else if (outcome.kind === 'handoff') {
        await markDone(row.id, MessageStatus.skipped, outcome.reason)
        result.handoff++
      } else if (outcome.kind === 'skipped') {
        await markDone(row.id, MessageStatus.skipped, outcome.reason)
        result.skipped++
      } else if (outcome.kind === 'failed') {
        await markDone(row.id, MessageStatus.failed, outcome.reason)
        result.failed++
      }
    } catch (err) {
      // Sem retry: a tentativa pode ter chegado à Meta. Categoria fechada, nunca error.message.
      logger.error('[customer-recovery] erro inesperado', { errorName: err instanceof Error ? err.name : 'unknown' })
      await markDone(row.id, MessageStatus.failed, 'unexpected_error').catch(() => {})
      result.failed++
    }
  }

  return result
}
