import { prisma } from '../config/prisma'
import { inboxService } from '../services/inboxService'

// Repair only the local Inbox projection. This module has no sender dependency.
export async function retryInboxMirrors() {
  const candidates = await prisma.messageLog.findMany({
    where: { metaMessageId: { not: null }, status: { in: ['sent', 'delivered', 'read'] }, mirrorStatus: { in: ['pending', 'failed', 'processing'] } },
    orderBy: { sentAt: 'asc' }, take: 50,
  })
  let mirrored = 0
  let failed = 0
  for (const message of candidates) {
    if (!message.metaMessageId || !message.sentAt) continue
    try {
      await inboxService.mirrorAutomationMessage({
        phone: message.normalizedPhone, metaMessageId: message.metaMessageId,
        templateName: message.templateName, status: message.status, sentAt: message.sentAt,
        messageLogId: message.id, entityType: message.entityType, entityId: message.entityId,
        payload: message.payload && typeof message.payload === 'object' ? message.payload : {},
      })
      await prisma.messageLog.update({ where: { id: message.id }, data: { mirrorStatus: 'mirrored', mirroredAt: new Date(), mirrorLastError: null } })
      mirrored++
    } catch {
      await prisma.messageLog.update({ where: { id: message.id }, data: { mirrorStatus: 'failed', mirrorRetryCount: { increment: 1 }, mirrorLastError: 'mirror_failed' } })
      failed++
    }
  }
  return { found: candidates.length, mirrored, failed, sent: 0 }
}
