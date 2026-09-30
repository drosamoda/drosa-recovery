import { MessageLog, MessageStatus } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { hasActiveWhatsappConsent } from '../services/whatsappConsentService'
import {
  localDispatchContractError,
  verifyMetaTemplateContract,
  isMarketingTemplate,
  renderContract,
} from '../services/templateContracts'
import {
  revalidate,
  disabledFlowReason,
  isRecoverableRevalidationReason,
  isRecoverableContractReason,
  isMarketingSendWindowOpen,
} from './processMessages'

// Simulação SOMENTE LEITURA do que process-messages faria agora com a fila.
// Garantias (cobertas por teste): nenhum envio, nenhum update/updateMany/create/delete,
// nenhum claim, nenhuma mudança em status/attempts/nextRetryAt/reason. Reusa as MESMAS
// regras do processador (revalidate, contrato local, consentimento, expiração, flags).
// A saída só tem contagens e nomes de template/razões fechadas — nenhum PII.
export const MAX_DRY_RUN_MESSAGE_IDS = 100
export const DRY_RUN_MAX_EVALUATED = 1000

const PAYMENT_DONE_REASONS = new Set(['payment_already_completed', 'order_cancelled'])

export type ProcessMessagesDryRunResult = {
  dryRun: true
  evaluatedAt: string
  totalPending: number
  totalEvaluated: number
  truncated: boolean
  totalCandidates: number // pendentes já vencidas (scheduledAt/nextRetryAt <= agora)
  wouldExpire: number
  wouldSkipTransactionalConsent: number
  wouldSkipMarketingConsent: number
  wouldSkipPaymentCompleted: number
  wouldRetryLater: number
  wouldReachSendStage: number
  other: number
  otherReasons: Record<string, number>
  reachSendStageByTemplate: Record<string, number>
  runtime: {
    automationSendEnabled: boolean
    whatsappDryRun: boolean
    allowlistSize: number
    realSendBlockedBy: string | null
  }
  // Nomes dos gates de tempo de execução que a simulação NÃO avalia. wouldReachSendStage = passaria
  // por todos os gates AVALIADOS; NÃO é a contagem exata do que será enviado. Não interprete 0 ou N
  // como garantia absoluta enquanto notEvaluated não estiver vazio.
  notEvaluated: string[]
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

export async function runProcessMessagesDryRun(options: { messageIds?: string[] } = {}): Promise<ProcessMessagesDryRunResult> {
  const now = new Date()
  const maxAgeMs = env.AUTOMATION_MAX_MESSAGE_AGE_HOURS * 60 * 60 * 1000
  const idFilter = options.messageIds && options.messageIds.length > 0 ? { id: { in: options.messageIds } } : {}
  const where = { status: MessageStatus.pending, ...idFilter }

  const [totalPending, rows] = await Promise.all([
    prisma.messageLog.count({ where }),
    prisma.messageLog.findMany({ where, orderBy: { scheduledAt: 'asc' }, take: DRY_RUN_MAX_EVALUATED }),
  ])

  const allowlist = env.AUTOMATION_ALLOWED_TEMPLATES
  const realSendBlockedBy = !env.AUTOMATION_SEND_ENABLED
    ? 'automation_send_disabled'
    : env.WHATSAPP_DRY_RUN
      ? 'whatsapp_dry_run'
      : allowlist.length === 0
        ? 'automation_allowlist_required'
        : null

  const out: ProcessMessagesDryRunResult = {
    dryRun: true,
    evaluatedAt: now.toISOString(),
    totalPending,
    totalEvaluated: rows.length,
    truncated: totalPending > rows.length,
    totalCandidates: 0,
    wouldExpire: 0,
    wouldSkipTransactionalConsent: 0,
    wouldSkipMarketingConsent: 0,
    wouldSkipPaymentCompleted: 0,
    wouldRetryLater: 0,
    wouldReachSendStage: 0,
    other: 0,
    otherReasons: {},
    reachSendStageByTemplate: {},
    runtime: {
      automationSendEnabled: env.AUTOMATION_SEND_ENABLED,
      whatsappDryRun: env.WHATSAPP_DRY_RUN,
      allowlistSize: allowlist.length,
      realSendBlockedBy,
    },
    notEvaluated: ['runtime_cooldown_lock', 'runtime_batch_limit', 'runtime_per_flow_send_caps'],
  }

  // A verificação do template na Meta é somente leitura (GET); uma vez por template/idioma.
  const metaCache = new Map<string, Promise<string | null>>()
  const metaCheck = (name: string, language: string): Promise<string | null> => {
    const key = `${name}|${language}`
    if (!metaCache.has(key)) metaCache.set(key, verifyMetaTemplateContract(name, language))
    return metaCache.get(key)!
  }

  for (const msg of rows) {
    const due = msg.scheduledAt <= now && (!msg.nextRetryAt || msg.nextRetryAt <= now)
    if (!due) {
      out.wouldRetryLater++
      continue
    }
    out.totalCandidates++

    // Mesma ordem do processador: expiração primeiro.
    if (now.getTime() - msg.scheduledAt.getTime() > maxAgeMs) {
      out.wouldExpire++
      continue
    }

    if (allowlist.length > 0 && !allowlist.includes(msg.templateName)) {
      out.other++
      bump(out.otherReasons, 'not_in_allowlist')
      continue
    }

    if (disabledFlowReason(msg as MessageLog)) {
      out.wouldRetryLater++
      continue
    }

    const validation = await revalidate(msg as MessageLog, { readOnly: true })
    if (!validation.ok) {
      if (isRecoverableRevalidationReason(validation.reason)) out.wouldRetryLater++
      else if (PAYMENT_DONE_REASONS.has(validation.reason)) out.wouldSkipPaymentCompleted++
      else {
        out.other++
        bump(out.otherReasons, validation.reason)
      }
      continue
    }

    const params = validation.params
    const [marketingConsentProven, transactionalConsentProven] = await Promise.all([
      hasActiveWhatsappConsent(msg.normalizedPhone, 'marketing'),
      hasActiveWhatsappConsent(msg.normalizedPhone, 'transactional'),
    ])
    const localError = localDispatchContractError(params.templateName, params.languageCode, params.bodyParams, {
      marketingConsentProven,
      transactionalConsentProven,
    })
    if (localError === 'transactional_consent_unproven') {
      out.wouldSkipTransactionalConsent++
      continue
    }
    if (localError === 'consent_unproven') {
      out.wouldSkipMarketingConsent++
      continue
    }
    if (localError) {
      out.other++
      bump(out.otherReasons, localError)
      continue
    }
    if (!renderContract(params.templateName, params.bodyParams)) {
      out.other++
      bump(out.otherReasons, 'template_data_missing')
      continue
    }

    const metaError = await metaCheck(params.templateName, params.languageCode)
    if (metaError) {
      if (isRecoverableContractReason(metaError)) out.wouldRetryLater++
      else {
        out.other++
        bump(out.otherReasons, metaError)
      }
      continue
    }

    if (isMarketingTemplate(params.templateName) && !isMarketingSendWindowOpen(now)) {
      out.wouldRetryLater++
      continue
    }

    out.wouldReachSendStage++
    bump(out.reachSendStageByTemplate, params.templateName)
  }

  return out
}
