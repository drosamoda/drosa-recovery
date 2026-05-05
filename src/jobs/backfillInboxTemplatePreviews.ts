import { MessageDirection } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../config/logger'
import { getTemplatePreviewMap } from '../helpers/inboxTemplatePreview'

export type BackfillInboxTemplatePreviewsResult = {
  messagesUpdated: number
  skipped: number
}

export async function runBackfillInboxTemplatePreviews(): Promise<BackfillInboxTemplatePreviewsResult> {
  let messagesUpdated = 0
  let skipped = 0

  for (const [templateName, preview] of Object.entries(getTemplatePreviewMap())) {
    const result = await prisma.chatMessage.updateMany({
      where: {
        direction: MessageDirection.outbound,
        type: 'template',
        body: templateName,
      },
      data: { body: preview },
    })

    messagesUpdated += result.count
    if (result.count === 0) skipped++
  }

  logger.info('[backfillInboxTemplatePreviews] concluido', {
    messagesUpdated,
    skipped,
  })

  return { messagesUpdated, skipped }
}
