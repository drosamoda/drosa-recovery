import { prisma } from '../config/prisma'
import { MessageLog, MessageStatus, EntityType } from '@prisma/client'
import { whatsappService } from '../services/whatsappService'
import { inboxService } from '../services/inboxService'
import { sleep } from '../helpers/sleep'
import { extractUrlSuffix } from '../helpers/templateMapper'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { getFriendlyTemplatePreview, renderTemplatePreview } from '../helpers/inboxTemplatePreview'
import { isValidBrazilianPhone } from '../helpers/phoneService'
import { messageService } from '../services/messageService'
import { verifyDispatchContract, renderContract } from '../services/templateContracts'

export type ProcessResult = {
  found: number
  eligible: number
  markedProcessing: number
  dryRun: number
  sent: number
  skipped: number
  failed: number
  errors: number
  retryScheduled: number
  unknown: number
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function calcNextRetryAt(retryCount: number): Date {
  // delay = RETRY_BASE_DELAY_MS * 2^(retryCount-1)
  // retryCount=1 → 1s | retryCount=2 → 2s | retryCount=3 → 4s
  const delay = env.RETRY_BASE_DELAY_MS * Math.pow(2, retryCount - 1)
  return new Date(Date.now() + delay)
}

// Remove o 9 do celular brasileiro de 13 dígitos: 5531998021418 → 553198021418
function stripNinthDigit(phone: string): string | null {
  if (phone.length !== 13 || !phone.startsWith('55')) return null
  const ddd = phone.slice(2, 4)
  const number = phone.slice(4)
  if (!number.startsWith('9')) return null
  return `55${ddd}${number.slice(1)}`
}

// -----------------------------------------------------------------------
// Revalidação antes do envio
// -----------------------------------------------------------------------

type ValidationResult =
  | { ok: true; params: SendParams }
  | { ok: false; reason: string }

type SendParams = {
  to: string
  templateName: string
  languageCode: string
  bodyParams: string[]
  buttonUrlParam?: string
  templatePreview?: string | null
  templateVariables?: Record<string, string>
  renderedPreview?: string
}

function isRemarketingMessage(msg: MessageLog): boolean {
  return msg.source?.startsWith('remarketing') ?? false
}

function disabledFlowReason(msg: MessageLog): string | null {
  if (msg.entityType === EntityType.abandoned_checkout && !env.ABANDONED_CART_ENABLED) {
    return 'abandoned_cart_disabled'
  }
  if (isRemarketingMessage(msg) && !env.REMARKETING_ENABLED) {
    return 'remarketing_disabled'
  }
  return null
}

function firstName(fullName?: string | null): string {
  const normalized = fullName?.trim()
  if (!normalized) return 'Cliente'
  return normalized.split(/\s+/)[0] ?? normalized
}

function formatCurrencyBRL(value?: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const numeric =
    typeof value === 'number'
      ? value
      : Number(String(typeof value === 'object' ? value.toString?.() ?? value : value).replace(',', '.'))
  if (!Number.isFinite(numeric)) return null
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numeric)
}

function buildTemplateVariables(params: {
  templateName: string
  customerName?: string | null
  orderNumber?: string | null
  orderTotal?: unknown
  checkoutUrl?: string | null
}): Record<string, string> {
  const variables: Record<string, string> = {
    nome_cliente: firstName(params.customerName),
  }

  if (params.orderNumber) variables.numero_pedido = params.orderNumber

  const formattedTotal = formatCurrencyBRL(params.orderTotal)
  if (formattedTotal) variables.valor_total = formattedTotal

  if (params.checkoutUrl) {
    variables.link_checkout = params.checkoutUrl
    variables.link_boleto_pix = params.checkoutUrl
  }

  if (params.templateName === 'confirmacao_pedido_drosa' ||
      params.templateName === 'pagamento_confirmado_drosa_01' ||
      params.templateName === 'pix_cancelado_drosa_01') {
    variables.link_grupo_vip = env.GRUPO_VIP_LINK
  }

  return variables
}

function buildAutomationMessagePayload(sendParams: SendParams) {
  return {
    renderedPreview: sendParams.renderedPreview ?? getFriendlyTemplatePreview(sendParams.templateName),
    templatePreview: sendParams.templatePreview ?? null,
    templateParameters: sendParams.templateVariables ?? {},
  }
}

async function revalidate(msg: MessageLog): Promise<ValidationResult> {
  // 1. Telefone presente
  if (!msg.normalizedPhone) {
    return { ok: false, reason: 'invalid_phone' }
  }
  if (!isValidBrazilianPhone(msg.normalizedPhone)) return { ok: false, reason: 'invalid_phone' }

  // 2. Opt-out
  const [customer, suppression] = await Promise.all([
    msg.customerId
      ? prisma.customer.findUnique({ where: { id: msg.customerId } })
      : prisma.customer.findFirst({ where: { normalizedPhone: msg.normalizedPhone } }),
    prisma.suppression.findUnique({ where: { normalizedPhone: msg.normalizedPhone }, select: { id: true } }),
  ])

  if (customer?.optOut || suppression) {
    return { ok: false, reason: 'opt_out' }
  }

  // 3. Template ativo
  const template = await prisma.whatsappTemplate.findFirst({
    where: { metaTemplateName: msg.templateName, active: true },
    select: {
      id: true,
      languageCode: true,
      messagePreview: true,
      variables: true,
      metaTemplateName: true,
    },
  })
  if (!template) {
    return { ok: false, reason: 'inactive_template' }
  }

  // 4. Regra ativa
  const rule = await prisma.automationRule.findFirst({
    where: { templateName: msg.templateName, active: true },
  })
  if (!rule) {
    return { ok: false, reason: 'inactive_rule' }
  }

  // 5. Não existe envio duplicado (outro log sent/delivered/read para mesma entidade)
  const duplicate = await prisma.messageLog.findFirst({
    where: {
      entityType: msg.entityType,
      entityId: msg.entityId,
      templateName: msg.templateName,
      status: { in: [MessageStatus.sent, MessageStatus.delivered, MessageStatus.read, MessageStatus.unknown] },
      id: { not: msg.id },
    },
  })
  if (duplicate) {
    return { ok: false, reason: 'duplicate_message' }
  }

  // 6. Status ainda é processing (garante que outro worker não pegou)
  const current = await prisma.messageLog.findUnique({
    where: { id: msg.id },
    select: { status: true },
  })
  if (current?.status !== MessageStatus.processing) {
    return { ok: false, reason: 'duplicate_message' }
  }

  // ----------------------------------------------------------------
  // Carrinho abandonado — revalidações específicas
  // ----------------------------------------------------------------
  if (msg.entityType === EntityType.abandoned_checkout) {
    const checkout = await prisma.abandonedCheckout.findUnique({
      where: { id: msg.entityId },
      select: {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        normalizedPhone: true,
        abandonedCheckoutUrl: true,
        firstSeenAt: true,
        sourceCreatedAt: true,
        status: true,
      },
    })
    if (!checkout) {
      return { ok: false, reason: 'invalid_phone' }
    }
    if (checkout.status !== 'abandoned') {
      return { ok: false, reason: 'checkout_not_abandoned' }
    }
    if (!checkout.sourceCreatedAt) return { ok: false, reason: 'order_timing_uncertain' }

    // Pedido posterior ao checkout?
    const posteriorOrder = await prisma.order.findFirst({
      where: {
        OR: [
          { normalizedPhone: msg.normalizedPhone },
          ...(checkout.customerEmail ? [{ customerEmail: checkout.customerEmail }] : []),
        ],
        sourceCreatedAt: { gte: checkout.sourceCreatedAt },
      },
    })
    if (posteriorOrder) {
      return { ok: false, reason: 'converted_before_send' }
    }

    // URL compatível com CHECKOUT_BASE_URL
    const suffix = extractUrlSuffix(checkout.abandonedCheckoutUrl, env.CHECKOUT_BASE_URL)
    if (suffix === null) {
      return { ok: false, reason: 'invalid_checkout_url' }
    }

    const customerName = checkout.customerName ?? 'Cliente'
    if (!customerName.trim()) {
      return { ok: false, reason: 'missing_template_variable' }
    }

    const templateVariables = buildTemplateVariables({
      templateName: msg.templateName,
      customerName: checkout.customerName,
      checkoutUrl: checkout.abandonedCheckoutUrl,
    })
    const renderedPreview = renderTemplatePreview(msg.templateName, {
      templatePreview: template.messagePreview,
      templateVariables,
    }).renderedPreview

    return {
      ok: true,
      params: {
        to: msg.normalizedPhone,
        templateName: msg.templateName,
        languageCode: template.languageCode,
        bodyParams: [customerName.trim().split(' ')[0], checkout.abandonedCheckoutUrl],
        templatePreview: template.messagePreview,
        templateVariables,
        renderedPreview,
      },
    }
  }

  // ----------------------------------------------------------------
  // Pedido — revalidações específicas
  // ----------------------------------------------------------------
  if (msg.entityType === EntityType.order) {
    const order = await prisma.order.findUnique({
      where: { id: msg.entityId },
      select: {
        customerName: true,
        orderNumber: true,
        total: true,
        orderUrl: true,
        paymentStatus: true,
        paymentMethod: true,
        status: true,
      },
    })
    if (!order) {
      return { ok: false, reason: 'invalid_phone' }
    }
    if (['order_created_pix', 'order_created_boleto', 'boleto_expiring'].includes(rule.eventType)) {
      if (['cancelled', 'canceled'].includes(order.status)) return { ok: false, reason: 'order_cancelled' }
      if (order.paymentStatus !== 'pending' || ['paid', 'confirmed', 'authorized', 'refunded'].includes(order.paymentStatus)) {
        return { ok: false, reason: 'payment_already_completed' }
      }
      const method = order.paymentMethod?.toLowerCase() ?? ''
      if (rule.eventType === 'order_created_pix' ? !method.includes('pix') : !/boleto|ticket/.test(method)) {
        return { ok: false, reason: 'payment_method_mismatch' }
      }
    }

    const customerName = order.customerName ?? 'Cliente'
    const orderNumber = order.orderNumber
    if (!customerName.trim() || !orderNumber) {
      return { ok: false, reason: 'template_data_missing' }
    }

    const bodyParams = [customerName.trim().split(' ')[0], orderNumber]
    if (rule.eventType === 'order_created_pix') {
      const total = Number(order.total)
      if (!Number.isFinite(total)) return { ok: false, reason: 'template_data_missing' }
      bodyParams.push(total.toFixed(2).replace('.', ','))
    }

    const templateVariables = buildTemplateVariables({
      templateName: msg.templateName,
      customerName: order.customerName,
      orderNumber,
      orderTotal: order.total,
      checkoutUrl: order.orderUrl,
    })
    const renderedPreview = renderTemplatePreview(msg.templateName, {
      templatePreview: template.messagePreview,
      templateVariables,
    }).renderedPreview

    return {
      ok: true,
      params: {
        to: msg.normalizedPhone,
        templateName: msg.templateName,
        languageCode: template.languageCode,
        bodyParams,
        templatePreview: template.messagePreview,
        templateVariables,
        renderedPreview,
      },
    }
  }

  return { ok: false, reason: 'invalid_phone' }
}

// -----------------------------------------------------------------------
// Dry run — registra a simulação e devolve o log à fila sem consumir idempotência.
// -----------------------------------------------------------------------

async function markDryRun(id: string, payload: object): Promise<void> {
  await prisma.messageLog.update({
    where: { id },
    data: {
      status: MessageStatus.pending,
      metaMessageId: null,
      sentAt: null,
      payload,
      response: { dry_run: true },
      reason: 'dry_run',
      nextRetryAt: null,
      claimOwner: null,
      claimExpiresAt: null,
    },
  })
}

// -----------------------------------------------------------------------
// Marca como skipped
// -----------------------------------------------------------------------

async function markSkipped(id: string, reason: string): Promise<void> {
  await prisma.messageLog.update({
    where: { id },
    data: { status: MessageStatus.skipped, reason, claimOwner: null, claimExpiresAt: null },
  })
}

// -----------------------------------------------------------------------
// Marca como enviado com sucesso
// -----------------------------------------------------------------------

async function markSent(
  msg: MessageLog,
  metaMessageId: string,
  sentPayload: object,
  response: object
): Promise<void> {
  const sentAt = new Date()
  await prisma.messageLog.update({
    where: { id: msg.id },
    data: {
      status: MessageStatus.sent,
      metaMessageId,
      sentAt,
      acceptedAt: sentAt,
      payload: sentPayload,
      response,
      nextRetryAt: null,
      claimOwner: null,
      claimExpiresAt: null,
      mirrorStatus: 'processing',
    },
  })

  try {
    await inboxService.mirrorAutomationMessage({
      phone: msg.normalizedPhone, metaMessageId, templateName: msg.templateName,
      status: MessageStatus.sent, sentAt, messageLogId: msg.id,
      entityType: msg.entityType, entityId: msg.entityId, payload: sentPayload,
    })
    await prisma.messageLog.update({ where: { id: msg.id }, data: { mirrorStatus: 'mirrored', mirroredAt: new Date(), mirrorLastError: null } })
  } catch (error) {
    await prisma.messageLog.update({
      where: { id: msg.id },
      data: { mirrorStatus: 'failed', mirrorRetryCount: { increment: 1 }, mirrorLastError: error instanceof Error ? error.message.slice(0, 500) : 'mirror_failed' },
    })
    logger.error('[processMessages] Meta aceitou, mas o mirror da Inbox falhou', { msgId: msg.id, result: 'mirror_failed' })
  }
}

// -----------------------------------------------------------------------
// Agenda retry ou marca como failed
// -----------------------------------------------------------------------

async function handleRetryOrFail(
  msg: MessageLog,
  errorCode: string | undefined,
  reason: string | undefined,
  response: object | undefined,
  errorType: 'temporary' | 'permanent'
): Promise<'retryScheduled' | 'failed'> {
  const newRetryCount = msg.retryCount + 1

  if (errorType === 'permanent' || newRetryCount >= env.MAX_RETRY_ATTEMPTS) {
    await prisma.messageLog.update({
      where: { id: msg.id },
      data: {
        status: MessageStatus.failed,
        retryCount: newRetryCount,
        lastRetryAt: new Date(),
        errorCode: errorCode ?? null,
        reason: newRetryCount >= env.MAX_RETRY_ATTEMPTS ? 'max_retries_exceeded' : reason ?? null,
        response: response ?? undefined,
        nextRetryAt: null,
        claimOwner: null,
        claimExpiresAt: null,
      },
    })
    return 'failed'
  }

  const nextRetryAt = calcNextRetryAt(newRetryCount)
  await prisma.messageLog.update({
    where: { id: msg.id },
    data: {
      status: MessageStatus.pending,
      retryCount: newRetryCount,
      lastRetryAt: new Date(),
      nextRetryAt,
      errorCode: errorCode ?? null,
      reason: reason ?? null,
      response: response ?? undefined,
      claimOwner: null,
      claimExpiresAt: null,
    },
  })
  return 'retryScheduled'
}

// -----------------------------------------------------------------------
// Retry com nono dígito (error_code 100 + 13 dígitos)
// -----------------------------------------------------------------------

async function trySendWithNinthDigitFallback(
  msg: MessageLog,
  params: SendParams
): Promise<{ success: true; metaMessageId: string; usedPhone: string; response?: object } | { success: false; result: Awaited<ReturnType<typeof whatsappService.sendTemplateMessage>> }> {
  const primary = await whatsappService.sendTemplateMessage(params)

  if (primary.success && primary.metaMessageId) {
    return { success: true, metaMessageId: primary.metaMessageId, usedPhone: params.to, response: primary.response }
  }

  // Tenta fallback com nono dígito removido apenas uma vez
  if (!primary.uncertain && primary.errorCode === '100' && params.to.length === 13) {
    const altPhone = stripNinthDigit(params.to)
    if (altPhone) {
      logger.info('[processMessages] Tentando sem nono dígito', { msgId: msg.id })
      const fallback = await whatsappService.sendTemplateMessage({ ...params, to: altPhone })

      if (fallback.success && fallback.metaMessageId) {
        // Atualiza o telefone validado no customer
        if (msg.customerId) {
          await prisma.customer.update({
            where: { id: msg.customerId },
            data: {
              normalizedPhoneValidated: altPhone,
              phoneNote: 'Enviado sem nono dígito (fallback)',
            },
          })
        }
        return { success: true, metaMessageId: fallback.metaMessageId, usedPhone: altPhone, response: fallback.response }
      }

      return { success: false, result: fallback }
    }
  }

  return { success: false, result: primary }
}

// -----------------------------------------------------------------------
// Job principal
// -----------------------------------------------------------------------

export async function runProcessMessages(): Promise<ProcessResult> {
  const result: ProcessResult = {
    found: 0,
    eligible: 0,
    markedProcessing: 0,
    dryRun: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: 0,
    retryScheduled: 0,
    unknown: 0,
  }

  const now = new Date()

  // 1. Busca candidatos pendentes prontos para envio
  const candidates = await prisma.messageLog.findMany({
    where: {
      status: MessageStatus.pending,
      scheduledAt: { lte: now },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: { scheduledAt: 'asc' },
    take: env.MESSAGES_BATCH_SIZE,
  })

  result.found = candidates.length
  if (candidates.length === 0) return result

  // 2. Claim condicional por mensagem. Apenas esta execução processa os
  // registros cujo update pending -> processing alterou exatamente uma linha.
  const toProcess: MessageLog[] = []
  for (const candidate of candidates) {
    const claim = await prisma.messageLog.updateMany({
      where: { id: candidate.id, status: MessageStatus.pending },
      data: { status: MessageStatus.processing },
    })
    if (claim.count === 1) {
      toProcess.push({ ...candidate, status: MessageStatus.processing })
    }
  }

  result.markedProcessing = toProcess.length
  logger.info('[processMessages] lote iniciado', { found: result.found, locked: result.markedProcessing })

  let abandonedCartSendAttempts = 0
  let remarketingSendAttempts = 0

  // 3. Processar cada mensagem com delay entre envios
  for (const msg of toProcess) {
    let dispatchStarted = false
    let accepted = false
    try {
      const disabledReason = disabledFlowReason(msg)
      if (disabledReason) {
        await markSkipped(msg.id, disabledReason)
        result.skipped++
        continue
      }

      // Revalidação completa antes do envio
      const validation = await revalidate(msg)

      if (!validation.ok) {
        await markSkipped(msg.id, validation.reason)
        result.skipped++
        logger.info('[processMessages] mensagem ignorada', { msgId: msg.id, reason: validation.reason })
        await sleep(env.MESSAGE_SEND_DELAY_MS)
        continue
      }

      const sendParams = validation.params
      result.eligible++

      // Uma das flags de dry-run protege todos os envios automáticos.
      if (env.WHATSAPP_DRY_RUN || env.INBOX_SEND_DRY_RUN || !env.AUTOMATION_SEND_ENABLED) {
        const dryPayload = {
          to: sendParams.to,
          template: sendParams.templateName,
          languageCode: sendParams.languageCode,
          bodyParams: sendParams.bodyParams,
          ...buildAutomationMessagePayload(sendParams),
          ...(sendParams.buttonUrlParam ? { buttonUrlParam: sendParams.buttonUrlParam } : {}),
          dry_run: true,
        }
        await markDryRun(msg.id, dryPayload)
        result.dryRun++
        logger.info('[processMessages] dry_run — payload salvo sem envio real', {
          msgId: msg.id,
          template: sendParams.templateName,
        })
        await sleep(env.MESSAGE_SEND_DELAY_MS)
        continue
      }

      if (msg.entityType === EntityType.abandoned_checkout) {
        if (abandonedCartSendAttempts >= env.ABANDONED_CART_MAX_SENDS_PER_RUN) {
          await markSkipped(msg.id, 'abandoned_cart_run_limit')
          result.skipped++
          continue
        }
        abandonedCartSendAttempts++
      }

      if (isRemarketingMessage(msg)) {
        if (remarketingSendAttempts >= env.REMARKETING_MAX_SENDS_PER_RUN) {
          await markSkipped(msg.id, 'remarketing_run_limit')
          result.skipped++
          continue
        }
        remarketingSendAttempts++
      }

      const contractError = await verifyDispatchContract(sendParams.templateName, sendParams.languageCode, sendParams.bodyParams)
      if (contractError) {
        await markSkipped(msg.id, contractError)
        result.skipped++
        continue
      }
      sendParams.renderedPreview = renderContract(sendParams.templateName, sendParams.bodyParams) ?? undefined

      if (msg.entityType === EntityType.abandoned_checkout || isRemarketingMessage(msg)) {
        const hours = Math.max(env.ABANDONED_CART_COOLDOWN_HOURS, env.REMARKETING_GLOBAL_COOLDOWN_HOURS)
        const acquired = await messageService.acquireFrequencyLock(msg.normalizedPhone, msg.id, new Date(Date.now() + hours * 3600000))
        if (!acquired) {
          await markSkipped(msg.id, 'cooldown_active')
          result.skipped++
          continue
        }
      }

      // Once dispatch starts an unexpected failure must never schedule another send.
      dispatchStarted = true
      const sendResult = await trySendWithNinthDigitFallback(msg, sendParams)

      if (sendResult.success) {
        accepted = true
        await markSent(
          msg,
          sendResult.metaMessageId,
          {
            to: sendResult.usedPhone,
            template: sendParams.templateName,
            ...buildAutomationMessagePayload(sendParams),
            bodyParams: sendParams.bodyParams,
          },
          sendResult.response ?? {}
        )
        result.sent++
        logger.info('[processMessages] mensagem enviada', { msgId: msg.id, metaMessageId: sendResult.metaMessageId })
      } else {
        const r = sendResult.result
        if (r.uncertain || (r.success && !r.metaMessageId)) {
          await prisma.messageLog.update({
            where: { id: msg.id },
            data: { status: MessageStatus.unknown, reason: 'delivery_unknown', deliveryUnknownAt: new Date(), nextRetryAt: null },
          })
          result.unknown++
          continue
        }
        const outcome = await handleRetryOrFail(
          msg,
          r.errorCode,
          r.reason,
          r.response as object | undefined,
          r.errorType ?? 'temporary'
        )

        if (outcome === 'retryScheduled') {
          result.retryScheduled++
          logger.warn('[processMessages] retry agendado', { msgId: msg.id, errorCode: r.errorCode })
        } else {
          result.failed++
          logger.warn('[processMessages] falha permanente', { msgId: msg.id, errorCode: r.errorCode, reason: r.reason })
        }
      }
    } catch (err) {
      const msg_ = err instanceof Error ? err.message : String(err)
      logger.error('[processMessages] erro inesperado', { msgId: msg.id, error: msg_ })
      try {
        if (!accepted) await prisma.messageLog.update({
          where: { id: msg.id },
          data: { status: dispatchStarted ? MessageStatus.unknown : MessageStatus.failed,
            reason: dispatchStarted ? 'delivery_unknown' : 'processing_error',
            deliveryUnknownAt: dispatchStarted ? new Date() : undefined, nextRetryAt: null },
        })
      } catch {
        // ignore secondary failure
      }
      if (accepted) result.sent++
      else if (dispatchStarted) result.unknown++
      else result.failed++
      result.errors++
    }

    await sleep(env.MESSAGE_SEND_DELAY_MS)
  }

  logger.info('[processMessages] lote concluído', {
    sent: result.sent,
    skipped: result.skipped,
    failed: result.failed,
    errors: result.errors,
    dryRun: result.dryRun,
    retryScheduled: result.retryScheduled,
  })

  return result
}
