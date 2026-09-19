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
import { verifyDispatchContract, renderContract, isMarketingTemplate } from '../services/templateContracts'
import { hasActiveWhatsappConsent } from '../services/whatsappConsentService'
import { randomUUID } from 'crypto'

export type ProcessResult = {
  found: number
  eligible: number
  markedProcessing: number
  dryRun: number
  sent: number
  skipped: number
  deferred: number
  failed: number
  errors: number
  retryScheduled: number
  unknown: number
  blockedReason?: 'automation_allowlist_required'
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

export function isMarketingSendWindowOpen(now: Date = new Date()): boolean {
  try {
    const hourPart = new Intl.DateTimeFormat('en-US', {
      timeZone: env.MARKETING_TIME_ZONE,
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now).find((part) => part.type === 'hour')?.value
    const hour = Number(hourPart)
    if (!Number.isInteger(hour)) return false

    const start = env.MARKETING_SEND_HOUR_START
    const end = env.MARKETING_SEND_HOUR_END
    if (start < end) return hour >= start && hour < end
    // Também suporta uma janela explícita que atravesse meia-noite.
    if (start > end) return hour >= start || hour < end
    return false
  } catch {
    return false
  }
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

const RECOVERABLE_REVALIDATION_REASONS = new Set([
  'inactive_template',
  'inactive_rule',
])

const RECOVERABLE_CONTRACT_REASONS = new Set([
  'missing_meta_waba_id',
  'meta_template_verification_failed',
  'template_contract_mismatch',
  'unsupported_template_components',
])

function isRecoverableRevalidationReason(reason: string): boolean {
  return RECOVERABLE_REVALIDATION_REASONS.has(reason)
}

function isRecoverableContractReason(reason: string): boolean {
  return RECOVERABLE_CONTRACT_REASONS.has(reason)
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

  // 4. Regra ativa para automações transacionais. Remarketing usa o
  // contrato de segmento + template ativo e não depende de EventType.
  const remarketingMessage = isRemarketingMessage(msg)
  const rule = remarketingMessage
    ? null
    : await prisma.automationRule.findFirst({
        where: { templateName: msg.templateName, active: true },
      })
  if (!remarketingMessage && !rule) {
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
    select: { status: true, claimOwner: true },
  })
  if (current?.status !== MessageStatus.processing || current.claimOwner !== msg.claimOwner) {
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
  // Conversa — somente retomada de atendimento em remarketing
  // ----------------------------------------------------------------
  if (msg.entityType === EntityType.conversation) {
    if (!remarketingMessage || msg.source !== 'remarketing:engaged_no_purchase') {
      return { ok: false, reason: 'invalid_remarketing_segment' }
    }
    const conversation = await prisma.conversation.findUnique({
      where: { id: msg.entityId },
      include: { contact: true },
    })
    if (!conversation || conversation.contact.phone !== msg.normalizedPhone || !conversation.lastInboundAt) {
      return { ok: false, reason: 'segment_no_longer_eligible' }
    }
    const purchasedAfterConversation = await prisma.order.findFirst({
      where: {
        normalizedPhone: msg.normalizedPhone,
        sourceCreatedAt: { gte: conversation.lastInboundAt },
      },
      select: { id: true },
    })
    if (purchasedAfterConversation) return { ok: false, reason: 'converted_before_send' }

    const customerName = conversation.contact.name ?? 'Cliente'
    const templateVariables = buildTemplateVariables({
      templateName: msg.templateName,
      customerName,
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
        bodyParams: [firstName(customerName)],
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
        sourceCreatedAt: true,
      },
    })
    if (!order) {
      return { ok: false, reason: 'invalid_phone' }
    }
    const customerName = order.customerName ?? 'Cliente'
    const orderNumber = order.orderNumber
    if (!customerName.trim() || !orderNumber) {
      return { ok: false, reason: 'template_data_missing' }
    }

    const first = customerName.trim().split(' ')[0]
    const bodyParams: string[] = [first]

    if (remarketingMessage) {
      const segment = msg.source?.startsWith('remarketing:') ? msg.source.slice('remarketing:'.length) : ''

      if (segment === 'pix_pending' || segment === 'boleto_pending') {
        if (['cancelled', 'canceled', 'refunded'].includes(order.status)) return { ok: false, reason: 'order_cancelled' }
        if (order.paymentStatus !== 'pending') return { ok: false, reason: 'payment_already_completed' }
        const method = order.paymentMethod?.toLowerCase() ?? ''
        if (segment === 'pix_pending' ? !method.includes('pix') : !/boleto|ticket/.test(method)) {
          return { ok: false, reason: 'payment_method_mismatch' }
        }
        bodyParams.push(orderNumber)
        if (segment === 'pix_pending') {
          const total = Number(order.total)
          if (!Number.isFinite(total)) return { ok: false, reason: 'template_data_missing' }
          bodyParams.push(total.toFixed(2).replace('.', ','))
        }
      } else if (segment === 'recent_customer') {
        if (order.paymentStatus !== 'paid' || ['cancelled', 'canceled', 'refunded'].includes(order.status) || !order.sourceCreatedAt) {
          return { ok: false, reason: 'segment_no_longer_eligible' }
        }
        const ageDays = (Date.now() - order.sourceCreatedAt.getTime()) / 86_400_000
        if (ageDays < 0 || ageDays > env.REMARKETING_RECENT_CUSTOMER_DAYS) {
          return { ok: false, reason: 'segment_no_longer_eligible' }
        }
      } else if (segment === 'inactive_customer') {
        const latestPaid = await prisma.order.findFirst({
          where: {
            normalizedPhone: msg.normalizedPhone,
            paymentStatus: 'paid',
            status: { notIn: ['cancelled', 'canceled', 'refunded'] },
            sourceCreatedAt: { not: null },
          },
          orderBy: { sourceCreatedAt: 'desc' },
          select: { id: true, sourceCreatedAt: true },
        })
        if (!latestPaid?.sourceCreatedAt || latestPaid.id !== msg.entityId) {
          return { ok: false, reason: 'segment_no_longer_eligible' }
        }
        const ageDays = (Date.now() - latestPaid.sourceCreatedAt.getTime()) / 86_400_000
        if (ageDays < env.REMARKETING_INACTIVE_DAYS) return { ok: false, reason: 'segment_no_longer_eligible' }
      } else if (segment === 'vip_customer') {
        const paidHistory = await prisma.order.findMany({
          where: {
            normalizedPhone: msg.normalizedPhone,
            paymentStatus: 'paid',
            status: { notIn: ['cancelled', 'canceled', 'refunded'] },
          },
          select: { total: true },
          take: 10000,
        })
        const spend = paidHistory.reduce((sum, item) => sum + Number(item.total), 0)
        if (paidHistory.length < env.VIP_MIN_ORDERS || spend < env.VIP_MIN_SPEND) {
          return { ok: false, reason: 'segment_no_longer_eligible' }
        }
      } else {
        return { ok: false, reason: 'invalid_remarketing_segment' }
      }
    } else {
      if (!rule) return { ok: false, reason: 'inactive_rule' }
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

      bodyParams.push(orderNumber)
      if (rule.eventType === 'order_created_pix') {
        const total = Number(order.total)
        if (!Number.isFinite(total)) return { ok: false, reason: 'template_data_missing' }
        bodyParams.push(total.toFixed(2).replace('.', ','))
      }
      if (rule.eventType === 'payment_confirmed' || rule.eventType === 'pix_cancelled') {
        if (!env.GRUPO_VIP_LINK) return { ok: false, reason: 'template_data_missing' }
        bodyParams.push(env.GRUPO_VIP_LINK)
      }
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

// Libera uma reivindicação quando o limite por execução foi atingido. A
// mensagem volta para pending para ser processada na próxima execução, sem
// consumir idempotência nem registrar uma falsa perda.
async function releaseClaim(id: string): Promise<void> {
  await prisma.messageLog.update({
    where: { id },
    data: {
      status: MessageStatus.pending,
      claimOwner: null,
      claimExpiresAt: null,
      nextRetryAt: null,
    },
  })
}

async function deferClaim(id: string, reason: string, delayMinutes = 30): Promise<void> {
  await prisma.messageLog.update({
    where: { id },
    data: {
      status: MessageStatus.pending,
      reason,
      claimOwner: null,
      claimExpiresAt: null,
      nextRetryAt: new Date(Date.now() + delayMinutes * 60_000),
    },
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
      reason: null,
      errorCode: null,
      deliveryUnknownAt: null,
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
    deferred: 0,
    failed: 0,
    errors: 0,
    retryScheduled: 0,
    unknown: 0,
  }

  const now = new Date()
  const claimOwner = randomUUID()
  const claimExpiresAt = new Date(now.getTime() + env.MESSAGE_CLAIM_LEASE_SECONDS * 1000)

  // Envio real é fail-closed: ligar o gate global sem uma allowlist explícita
  // nunca pode transformar toda a fila histórica em candidata a envio.
  if (env.AUTOMATION_SEND_ENABLED && !env.WHATSAPP_DRY_RUN && env.AUTOMATION_ALLOWED_TEMPLATES.length === 0) {
    result.blockedReason = 'automation_allowlist_required'
    logger.warn('[processMessages] envio real bloqueado: allowlist de templates vazia')
    return result
  }

  // 1. Busca candidatos pendentes prontos para envio
  const templateFilter = env.AUTOMATION_ALLOWED_TEMPLATES.length > 0
    ? { templateName: { in: env.AUTOMATION_ALLOWED_TEMPLATES } }
    : {}
  const candidates = await prisma.messageLog.findMany({
    where: {
      ...templateFilter,
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
      data: {
        status: MessageStatus.processing,
        claimOwner,
        claimExpiresAt,
      },
    })
    if (claim.count === 1) {
      toProcess.push({
        ...candidate,
        status: MessageStatus.processing,
        claimOwner,
        claimExpiresAt,
      })
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
    let acceptedMetaMessageId: string | null = null
    try {
      const maxAgeMs = env.AUTOMATION_MAX_MESSAGE_AGE_HOURS * 60 * 60 * 1000
      if (Date.now() - msg.scheduledAt.getTime() > maxAgeMs) {
        await markSkipped(msg.id, 'message_expired')
        result.skipped++
        continue
      }

      const disabledReason = disabledFlowReason(msg)
      if (disabledReason) {
        // Gate operacional fechado não invalida a elegibilidade histórica da
        // mensagem. Mantém pending para uma futura ativação em vez de consumir
        // definitivamente a idempotency key como skipped.
        await deferClaim(msg.id, disabledReason)
        result.deferred++
        continue
      }

      // Revalidação completa antes do envio
      const validation = await revalidate(msg)

      if (!validation.ok) {
        if (isRecoverableRevalidationReason(validation.reason)) {
          await deferClaim(msg.id, validation.reason)
          result.deferred++
        } else {
          await markSkipped(msg.id, validation.reason)
          result.skipped++
        }
        logger.info('[processMessages] mensagem bloqueada na revalidacao', {
          msgId: msg.id,
          reason: validation.reason,
          recoverable: isRecoverableRevalidationReason(validation.reason),
        })
        await sleep(env.MESSAGE_SEND_DELAY_MS)
        continue
      }

      const sendParams = validation.params
      result.eligible++

      // O dry run precisa passar pelos MESMOS gates de contrato e consentimento
      // do envio real. A única diferença é que, depois de validado, ele não
      // chama a Meta. Isso evita previews "verdes" para mensagens que seriam
      // bloqueadas em produção por contrato divergente ou consentimento ausente.
      const marketingConsentProven = await hasActiveWhatsappConsent(msg.normalizedPhone)
      const contractError = await verifyDispatchContract(
        sendParams.templateName,
        sendParams.languageCode,
        sendParams.bodyParams,
        { marketingConsentProven },
      )
      if (contractError) {
        if (isRecoverableContractReason(contractError)) {
          await deferClaim(msg.id, contractError)
          result.deferred++
        } else {
          await markSkipped(msg.id, contractError)
          result.skipped++
        }
        continue
      }
      sendParams.renderedPreview = renderContract(sendParams.templateName, sendParams.bodyParams) ?? undefined

      // INBOX_SEND_DRY_RUN protege somente o envio manual da Inbox.
      // Automações exigem o gate global, o gate do fluxo e WHATSAPP_DRY_RUN=false.
      if (env.WHATSAPP_DRY_RUN || !env.AUTOMATION_SEND_ENABLED) {
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

      if (isMarketingTemplate(sendParams.templateName) && !isMarketingSendWindowOpen()) {
        await deferClaim(msg.id, 'marketing_send_window_closed')
        result.deferred++
        continue
      }

      if (msg.entityType === EntityType.abandoned_checkout) {
        if (abandonedCartSendAttempts >= env.ABANDONED_CART_MAX_SENDS_PER_RUN) {
          await releaseClaim(msg.id)
          result.deferred++
          continue
        }
        abandonedCartSendAttempts++
      }

      if (isRemarketingMessage(msg)) {
        if (remarketingSendAttempts >= env.REMARKETING_MAX_SENDS_PER_RUN) {
          await releaseClaim(msg.id)
          result.deferred++
          continue
        }
        remarketingSendAttempts++
      }

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
        acceptedMetaMessageId = sendResult.metaMessageId
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
            data: {
              status: MessageStatus.unknown,
              reason: 'delivery_unknown',
              deliveryUnknownAt: new Date(),
              nextRetryAt: null,
              claimOwner: null,
              claimExpiresAt: null,
            },
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
        if (accepted) {
          // A Meta confirmou aceite, mas a persistência local falhou. Nunca
          // reencaminhar automaticamente; registra UNKNOWN apenas se o row
          // ainda estiver processing.
          await prisma.messageLog.updateMany({
            where: { id: msg.id, status: MessageStatus.processing, claimOwner: msg.claimOwner },
            data: {
              status: MessageStatus.unknown,
              reason: 'accepted_but_persist_failed',
              metaMessageId: acceptedMetaMessageId,
              acceptedAt: new Date(),
              deliveryUnknownAt: new Date(),
              nextRetryAt: null,
              claimOwner: null,
              claimExpiresAt: null,
            },
          })
        } else if (dispatchStarted) {
          // A chamada externa começou e o resultado é ambíguo: fail closed
          // contra duplicidade.
          await prisma.messageLog.updateMany({
            where: { id: msg.id, status: MessageStatus.processing, claimOwner: msg.claimOwner },
            data: {
              status: MessageStatus.unknown,
              reason: 'delivery_unknown',
              deliveryUnknownAt: new Date(),
              nextRetryAt: null,
              claimOwner: null,
              claimExpiresAt: null,
            },
          })
        } else {
          const outcome = await handleRetryOrFail(
            msg,
            undefined,
            'processing_error',
            undefined,
            'temporary',
          )
          if (outcome === 'retryScheduled') result.retryScheduled++
          else result.failed++
        }
      } catch {
        // Se até a persistência de recuperação falhar, a lease expirada ficará
        // visível no automation-health para investigação manual. Não há retry
        // automático de processing expirado, evitando duplicidade.
      }
      if (accepted) result.sent++
      else if (dispatchStarted) result.unknown++
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
    deferred: result.deferred,
  })

  return result
}
