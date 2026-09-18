import { createHash } from 'crypto'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { isValidBrazilianPhone } from '../helpers/phoneService'
import { runAbandonedCheckoutsPreview } from '../jobs/previewAbandonedCheckouts'
import { messageService } from './messageService'
import { verifyMetaTemplateContract } from './templateContracts'

export const segmentNames = ['abandoned_cart', 'pix_pending', 'boleto_pending', 'recent_customer', 'inactive_customer', 'vip_customer', 'engaged_no_purchase'] as const
export type Segment = typeof segmentNames[number]

export const segmentContracts: Record<Segment, { priority: number; template: string; marketing: boolean }> = {
  pix_pending: { priority: 1, template: '_pix_pendente', marketing: true },
  boleto_pending: { priority: 2, template: 'pedido_boleto_drosa_01', marketing: false },
  abandoned_cart: { priority: 3, template: env.ABANDONED_CART_TEMPLATE, marketing: true },
  recent_customer: { priority: 4, template: 'cliente_recente_drosa_v1', marketing: true },
  vip_customer: { priority: 5, template: 'cliente_vip_drosa_v1', marketing: true },
  inactive_customer: { priority: 6, template: 'cliente_inativo_drosa_v1', marketing: true },
  engaged_no_purchase: { priority: 7, template: 'atendimento_retomada_drosa_v1', marketing: true },
}

type Candidate = {
  entityId: string
  entityType: 'order' | 'conversation'
  customerId: string | null
  phone: string
  segment: Segment
  reasons: string[]
}

type CandidateEvaluation = {
  candidates: Candidate[]
  incomplete: boolean
  templateVerification: Map<string, string | null>
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex')
}

function publicSegmentStatus(items: Candidate[]): string {
  if (items.some(item => item.reasons.length === 0)) return 'READY'
  if (items.some(item => item.reasons.includes('meta_template_unverified'))) return 'META_TEMPLATE_SYNC_REQUIRED'
  if (items.some(item => item.reasons.includes('consent_unproven'))) return 'READY_BUT_SUPPRESSED_BY_CONSENT'
  return 'NO_ELIGIBLE_CANDIDATES'
}

async function evaluateCandidates(segment: Segment | 'all'): Promise<CandidateEvaluation> {
  const now = Date.now()
  const day = 86_400_000
  const selected = segmentNames.filter(name => name !== 'abandoned_cart' && (segment === 'all' || name === segment))
  const templateNames = [...new Set(selected.map(name => segmentContracts[name].template))]
  const templateVerification = new Map<string, string | null>()

  if (env.NODE_ENV !== 'test') {
    const checks = await Promise.all(
      templateNames.map(async name => [name, await verifyMetaTemplateContract(name, 'pt_BR')] as const),
    )
    for (const [name, result] of checks) templateVerification.set(name, result)
  } else {
    for (const name of templateNames) templateVerification.set(name, 'meta_template_verification_skipped_test')
  }

  const consentQuery = prisma.whatsappConsent?.findMany
    ? prisma.whatsappConsent.findMany({
        where: { consented: true, revokedAt: null, scope: 'marketing', consentedAt: { not: null } },
        select: { normalizedPhone: true },
      })
    : Promise.resolve([])

  const [orders, conversations, suppressions, optedOut, recentMessages, consents] = await Promise.all([
    prisma.order.findMany({ orderBy: { sourceCreatedAt: 'desc' }, take: 10000 }),
    prisma.conversation.findMany({ where: { lastInboundAt: { not: null } }, include: { contact: true }, take: 10000 }),
    prisma.suppression.findMany({ select: { normalizedPhone: true } }),
    prisma.customer.findMany({ where: { optOut: true }, select: { normalizedPhone: true } }),
    prisma.messageLog.findMany({
      where: {
        status: { in: ['sent', 'delivered', 'read', 'unknown'] },
        OR: [
          { sentAt: { gte: new Date(now - env.REMARKETING_GLOBAL_COOLDOWN_HOURS * 3_600_000) } },
          { status: 'unknown' },
        ],
      },
      select: { normalizedPhone: true },
    }),
    consentQuery,
  ])

  const suppressed = new Set([...suppressions, ...optedOut].map(item => item.normalizedPhone))
  const cooldown = new Set(recentMessages.map(item => item.normalizedPhone))
  const consented = new Set(consents.map(item => item.normalizedPhone))
  const candidates: Candidate[] = []
  const incomplete = orders.length === 10000 || conversations.length === 10000

  const push = (
    entityId: string,
    entityType: Candidate['entityType'],
    customerId: string | null,
    phone: string,
    candidateSegment: Segment,
    reasons: string[] = [],
  ) => {
    if (segment !== 'all' && segment !== candidateSegment) return
    if (!phone) reasons.push('missing_phone')
    else if (!isValidBrazilianPhone(phone)) reasons.push('invalid_phone')
    if (suppressed.has(phone)) reasons.push('opt_out')
    if (cooldown.has(phone)) reasons.push('cooldown_active')
    if (incomplete) reasons.push('history_incomplete')
    if (segmentContracts[candidateSegment].marketing && !consented.has(phone)) reasons.push('consent_unproven')
    if (templateVerification.get(segmentContracts[candidateSegment].template) !== null) reasons.push('meta_template_unverified')
    candidates.push({ entityId, entityType, customerId, phone, segment: candidateSegment, reasons })
  }

  const byPhone = new Map<string, typeof orders>()
  for (const order of orders) {
    if (order.normalizedPhone) {
      byPhone.set(order.normalizedPhone, [...(byPhone.get(order.normalizedPhone) ?? []), order])
    }

    const method = order.paymentMethod?.toLowerCase() ?? ''
    if (order.paymentStatus !== 'pending' || ['cancelled', 'canceled', 'refunded'].includes(order.status)) continue
    const pendingSegment = method.includes('pix') ? 'pix_pending' : /boleto|ticket/.test(method) ? 'boleto_pending' : null
    if (pendingSegment) {
      push(
        order.id,
        'order',
        order.customerId,
        order.normalizedPhone,
        pendingSegment,
        [...(!order.sourceCreatedAt ? ['order_timing_uncertain'] : [])],
      )
    }
  }

  for (const [phone, history] of byPhone) {
    const paid = history.filter(
      order => order.paymentStatus === 'paid' && !['cancelled', 'canceled', 'refunded'].includes(order.status),
    )
    const dated = paid
      .filter(order => order.sourceCreatedAt)
      .sort((a, b) => b.sourceCreatedAt!.getTime() - a.sourceCreatedAt!.getTime())
    if (!dated.length) continue

    const last = dated[0]
    const age = (now - last.sourceCreatedAt!.getTime()) / day
    const reasons = paid.some(order => !order.sourceCreatedAt) ? ['order_timing_uncertain'] : []

    if (age >= 0 && age <= env.REMARKETING_RECENT_CUSTOMER_DAYS) {
      push(last.id, 'order', last.customerId, phone, 'recent_customer', [...reasons])
    }
    if (age >= env.REMARKETING_INACTIVE_DAYS) {
      // Histórico incompleto não é suficiente para concluir que a cliente está
      // realmente inativa. O fluxo permanece bloqueado até cobertura histórica
      // ser comprovada operacionalmente.
      push(last.id, 'order', last.customerId, phone, 'inactive_customer', [...reasons, 'history_completeness_unverified'])
    }
    if (
      paid.length >= env.VIP_MIN_ORDERS &&
      paid.reduce((sum, order) => sum + Number(order.total), 0) >= env.VIP_MIN_SPEND
    ) {
      push(last.id, 'order', last.customerId, phone, 'vip_customer', [...reasons])
    }
  }

  for (const conversation of conversations) {
    const inbound = conversation.lastInboundAt
    if (!inbound || now - inbound.getTime() > 30 * day || inbound.getTime() > now) continue
    const history = byPhone.get(conversation.contact.phone) ?? []
    if (history.some(order => order.sourceCreatedAt && order.sourceCreatedAt >= inbound)) continue
    push(
      conversation.id,
      'conversation',
      null,
      conversation.contact.phone,
      'engaged_no_purchase',
      history.some(order => !order.sourceCreatedAt) ? ['order_timing_uncertain'] : [],
    )
  }

  candidates.sort((a, b) => segmentContracts[a.segment].priority - segmentContracts[b.segment].priority)
  const selectedPhones = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.phone && selectedPhones.has(candidate.phone)) {
      candidate.reasons.push('suppressed_by_higher_priority_segment')
    } else if (candidate.phone) {
      selectedPhones.add(candidate.phone)
    }
  }

  return { candidates, incomplete, templateVerification }
}

export async function remarketingPreview(segment: Segment | 'all' = 'all') {
  const evaluation = await evaluateCandidates(segment)
  const { candidates, incomplete, templateVerification } = evaluation
  const segments: Record<string, unknown> = {}
  const reasons: Record<string, number> = {}

  for (const name of segmentNames.filter(name => name !== 'abandoned_cart' && (segment === 'all' || name === segment))) {
    const items = candidates.filter(item => item.segment === name)
    for (const item of items) {
      for (const reason of item.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1
    }
    const eligible = items.filter(item => item.reasons.length === 0).length
    segments[name] = {
      found: items.length,
      eligible,
      skipped: items.length - eligible,
      sent: 0,
      template: segmentContracts[name].template,
      status: publicSegmentStatus(items),
      data: items.map(item => ({
        entityId: item.entityId,
        entityType: item.entityType,
        maskedPhone: item.phone ? `***${item.phone.slice(-2)}` : null,
        reasons: item.reasons,
      })),
    }
  }

  let carts = { found: 0, eligible: 0, skipped: 0 }
  if (segment === 'all' || segment === 'abandoned_cart') {
    const cartTemplate = segmentContracts.abandoned_cart.template
    if (!templateVerification.has(cartTemplate)) {
      const verification = env.NODE_ENV === 'test'
        ? 'meta_template_verification_skipped_test'
        : await verifyMetaTemplateContract(cartTemplate, 'pt_BR')
      templateVerification.set(cartTemplate, verification)
    }
    const preview = await runAbandonedCheckoutsPreview()
    const cartContractVerified = templateVerification.get(cartTemplate) === null
    carts = cartContractVerified
      ? { found: preview.found, eligible: preview.eligible, skipped: preview.skipped }
      : { found: preview.found, eligible: 0, skipped: preview.found }
    segments.abandoned_cart = {
      ...preview,
      ...carts,
      status: carts.eligible > 0
        ? 'READY'
        : cartContractVerified
          ? 'READY_BUT_SUPPRESSED_BY_CONSENT'
          : 'META_TEMPLATE_SYNC_REQUIRED',
    }
    for (const [reason, count] of Object.entries(preview.reasons)) {
      reasons[reason] = (reasons[reason] ?? 0) + count
    }
    if (!cartContractVerified) {
      reasons.meta_template_unverified = (reasons.meta_template_unverified ?? 0) + preview.found
    }
  }

  const candidateEligible = candidates.filter(item => item.reasons.length === 0).length
  const found = candidates.length + carts.found
  const eligible = candidateEligible + carts.eligible
  const usedTemplates = new Set(candidates.map(item => segmentContracts[item.segment].template))
  if (carts.found > 0) usedTemplates.add(segmentContracts.abandoned_cart.template)

  return {
    dryRun: true,
    found,
    eligible,
    skipped: found - eligible,
    sent: 0,
    segments,
    reasons,
    dataQuality: {
      historyTruncated: incomplete,
      consentSourceConfigured: Boolean(prisma.whatsappConsent),
      metaTemplatesVerified: [...usedTemplates].every(name => templateVerification.get(name) === null),
    },
    vipThresholds: {
      minimumOrders: env.VIP_MIN_ORDERS,
      minimumSpend: env.VIP_MIN_SPEND,
    },
  }
}

export async function remarketingSend(segment: Segment | 'all' = 'all') {
  const preview = await remarketingPreview(segment)
  const result = {
    found: preview.found,
    eligible: preview.eligible,
    claimed: 0,
    queued: 0,
    sent: 0,
    skipped: preview.skipped,
    failed: 0,
    unknown: 0,
    errors: 0,
    reasons: { ...preview.reasons } as Record<string, number>,
    segments: preview.segments,
    runId: null as string | null,
  }

  // Gates operacionais têm precedência: com automação fechada, nenhuma
  // tentativa deve avançar nem revelar um caminho de fila "quase aberto".
  if (!env.AUTOMATION_SEND_ENABLED) {
    return {
      status: 423,
      result: { ...result, reasons: { ...result.reasons, automation_send_disabled: preview.found } },
    }
  }
  if (!env.REMARKETING_ENABLED) {
    return {
      status: 423,
      result: { ...result, reasons: { ...result.reasons, remarketing_disabled: preview.found } },
    }
  }
  if (env.WHATSAPP_DRY_RUN) {
    return {
      status: 423,
      result: { ...result, reasons: { ...result.reasons, whatsapp_dry_run: preview.found } },
    }
  }

  // Nunca permitir um disparo amplo por acidente. Preview aceita "all", fila real não.
  if (segment === 'all') {
    return {
      status: 400,
      result: { ...result, reasons: { ...result.reasons, explicit_segment_required: preview.found } },
    }
  }
  if (segment === 'abandoned_cart') {
    return {
      status: 409,
      result: { ...result, reasons: { ...result.reasons, use_abandoned_cart_pipeline: preview.found } },
    }
  }

  const evaluation = await evaluateCandidates(segment)
  const items = evaluation.candidates.filter(item => item.segment === segment)
  const eligibleItems = items.filter(item => item.reasons.length === 0)
  const run = await prisma.remarketingRun.create({
    data: {
      segment,
      mode: 'send',
      status: 'running',
      candidateCount: items.length,
      eligibleCount: eligibleItems.length,
      skippedCount: items.length - eligibleItems.length,
    },
  })
  result.runId = run.id

  let queued = 0
  let failed = 0
  const maxQueue = Math.max(0, env.REMARKETING_MAX_SENDS_PER_RUN)

  for (const candidate of items) {
    const baseSnapshot = {
      segment: candidate.segment,
      template: segmentContracts[candidate.segment].template,
      reasons: candidate.reasons,
      checkedAt: new Date().toISOString(),
    }
    const recipient = await prisma.remarketingRecipient.create({
      data: {
        runId: run.id,
        normalizedPhoneHash: hashPhone(candidate.phone),
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        templateName: segmentContracts[candidate.segment].template,
        status: candidate.reasons.length ? 'suppressed' : 'eligible',
        reason: candidate.reasons[0] ?? null,
        eligibilitySnapshot: baseSnapshot,
      },
    })

    if (candidate.reasons.length) continue
    if (queued >= maxQueue) {
      await prisma.remarketingRecipient.update({
        where: { id: recipient.id },
        data: { status: 'suppressed', reason: 'run_limit_reached' },
      })
      result.reasons.run_limit_reached = (result.reasons.run_limit_reached ?? 0) + 1
      continue
    }

    try {
      const templateName = segmentContracts[candidate.segment].template
      const duplicate = await messageService.existsBlockingLog(
        candidate.entityType,
        candidate.entityId,
        templateName,
      )
      if (duplicate) {
        await prisma.remarketingRecipient.update({
          where: { id: recipient.id },
          data: { status: 'suppressed', reason: 'duplicate_message' },
        })
        result.reasons.duplicate_message = (result.reasons.duplicate_message ?? 0) + 1
        continue
      }

      const log = await messageService.createPendingMessageIfNotExists({
        entityType: candidate.entityType,
        entityId: candidate.entityId,
        customerId: candidate.customerId,
        normalizedPhone: candidate.phone,
        templateName,
        scheduledAt: new Date(),
        source: `remarketing:${candidate.segment}`,
      })

      if (log.status !== 'pending') {
        await prisma.remarketingRecipient.update({
          where: { id: recipient.id },
          data: { status: 'suppressed', reason: 'message_log_not_pending', messageLogId: log.id },
        })
        result.reasons.message_log_not_pending = (result.reasons.message_log_not_pending ?? 0) + 1
        continue
      }

      await prisma.remarketingRecipient.update({
        where: { id: recipient.id },
        data: { status: 'queued', messageLogId: log.id },
      })
      queued++
    } catch {
      failed++
      await prisma.remarketingRecipient.update({
        where: { id: recipient.id },
        data: { status: 'failed', reason: 'queue_failed' },
      })
      result.reasons.queue_failed = (result.reasons.queue_failed ?? 0) + 1
    }
  }

  await prisma.remarketingRun.update({
    where: { id: run.id },
    data: {
      status: failed > 0 ? 'failed' : 'completed',
      failedCount: failed,
      skippedCount: items.length - queued,
      completedAt: new Date(),
    },
  })

  return {
    status: 202,
    result: {
      ...result,
      claimed: queued,
      queued,
      skipped: items.length - queued,
      failed,
      errors: failed,
    },
  }
}
