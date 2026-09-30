import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { normalizePhoneBrazil } from '../helpers/phoneService'

// Recuperação iniciada pela CLIENTE ("Continuar minha compra pelo WhatsApp").
// A cliente envia a primeira mensagem; o CRM responde, dentro da janela de 24h, com o
// resumo mínimo do carrinho e o link. NÃO é opt-in: nunca grava consentimento de marketing.
// O webhook só registra a intenção (linha em message_logs); o envio é do job.

export const RECOVERY_SOURCE = 'customer_initiated_recovery'
export const RECOVERY_TEMPLATE_NAME = 'customer_initiated_cart_recovery'
export const RECOVERY_CANONICAL_TEXT = "Oi! Quero continuar minha compra na D'Rosa pelo WhatsApp."
export const RECOVERY_CART_LOOKBACK_DAYS = 7
export const RECOVERY_MAX_ITEMS = 3

// Normalização determinística (sem IA): minúsculas, sem acento, sem pontuação.
export function normalizeIntentText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const INTENT_MARKER = 'continuar minha compra'

export function isCartRecoveryIntent(text: string | null | undefined): boolean {
  if (!text) return false
  return normalizeIntentText(text).includes(INTENT_MARKER)
}

export interface RecoveryIntentCandidate {
  waMessageId: string
  phone: string
}

// Extrai do payload da Meta apenas mensagens de TEXTO com a intenção canônica.
export function extractRecoveryIntents(payload: unknown): RecoveryIntentCandidate[] {
  const out: RecoveryIntentCandidate[] = []
  const entries = ((payload as Record<string, unknown>)?.entry as unknown[]) ?? []
  for (const entry of entries) {
    const changes = ((entry as Record<string, unknown>)?.changes as unknown[]) ?? []
    for (const change of changes) {
      const value = (change as Record<string, unknown>)?.value as Record<string, unknown> | undefined
      const messages = (value?.messages as Array<Record<string, unknown>> | undefined) ?? []
      for (const m of messages) {
        if (m.type !== 'text') continue
        const body = (m.text as { body?: unknown } | undefined)?.body
        const id = typeof m.id === 'string' ? m.id : null
        const from = typeof m.from === 'string' ? m.from : null
        if (!id || !from || typeof body !== 'string' || !isCartRecoveryIntent(body)) continue
        const phone = normalizePhoneBrazil(from) ?? from
        out.push({ waMessageId: id, phone })
      }
    }
  }
  return out
}

// Registra a intenção (idempotente por waMessageId). Nunca lança: o webhook não pode falhar por isso.
export async function registerRecoveryIntents(payload: unknown): Promise<{ registered: number; duplicates: number }> {
  const result = { registered: 0, duplicates: 0 }
  if (!env.CUSTOMER_INITIATED_RECOVERY_ENABLED) return result
  try {
    for (const intent of extractRecoveryIntents(payload)) {
      const inbound = await prisma.chatMessage.findUnique({
        where: { waMessageId: intent.waMessageId },
        select: { conversationId: true },
      })
      if (!inbound) continue
      try {
        await prisma.messageLog.create({
          data: {
            idempotencyKey: `${RECOVERY_SOURCE}:${intent.waMessageId}`,
            entityType: 'conversation',
            entityId: inbound.conversationId,
            normalizedPhone: intent.phone,
            templateName: RECOVERY_TEMPLATE_NAME,
            status: 'pending',
            scheduledAt: new Date(),
            source: RECOVERY_SOURCE,
          },
        })
        result.registered++
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') result.duplicates++
        else throw err
      }
    }
  } catch (err) {
    logger.error('[customer-recovery] falha ao registrar intenção', { errorName: err instanceof Error ? err.name : 'unknown' })
  }
  return result
}

export interface RecoveryCheckout {
  id: string
  productsSummary: string | null
  abandonedCheckoutUrl: string
  sourceCreatedAt: Date | null
}

export type RecoveryMatch =
  | { kind: 'match'; checkout: RecoveryCheckout }
  | { kind: 'none' }
  | { kind: 'ambiguous' }

function sameCart(a: RecoveryCheckout, b: RecoveryCheckout): boolean {
  return (a.productsSummary ?? '') === (b.productsSummary ?? '') && a.abandonedCheckoutUrl === b.abandonedCheckoutUrl
}

// Carrinho da própria remetente: telefone verificado pela Meta (nunca digitado), aberto,
// não convertido, dos últimos 7 dias. Vários carrinhos DIFERENTES → ambíguo (handoff humano).
export async function matchRecoveryCheckout(phone: string, now: Date = new Date()): Promise<RecoveryMatch> {
  const since = new Date(now.getTime() - RECOVERY_CART_LOOKBACK_DAYS * 86_400_000)
  const rows = await prisma.abandonedCheckout.findMany({
    where: { normalizedPhone: phone, status: 'abandoned', convertedAt: null, sourceCreatedAt: { gte: since } },
    orderBy: { sourceCreatedAt: 'desc' },
    take: 5,
    select: { id: true, productsSummary: true, abandonedCheckoutUrl: true, sourceCreatedAt: true },
  })

  // Pedido posterior ao checkout = já converteu (mesma regra do processador).
  const open: RecoveryCheckout[] = []
  for (const row of rows) {
    if (!row.sourceCreatedAt) continue
    const later = await prisma.order.findFirst({
      where: { normalizedPhone: phone, sourceCreatedAt: { gte: row.sourceCreatedAt } },
      select: { id: true },
    })
    if (!later) open.push(row)
  }

  if (open.length === 0) return { kind: 'none' }
  if (open.some((c) => !sameCart(c, open[0]))) return { kind: 'ambiguous' }
  return { kind: 'match', checkout: open[0] }
}

function isRecoveryUrl(url: string): boolean {
  if (!url.startsWith(env.CHECKOUT_BASE_URL)) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

// Resposta mínima: até 3 itens do resumo + link. Nunca nome, e-mail, telefone, endereço ou documento.
export function buildRecoveryReply(checkout: RecoveryCheckout): string | null {
  if (!isRecoveryUrl(checkout.abandonedCheckoutUrl)) return null
  const items = (checkout.productsSummary ?? '')
    .split(/[,;\n]/)
    .map((s) => s.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, RECOVERY_MAX_ITEMS)
  const lines = ['Oi! Que bom te ver por aqui 😊']
  if (items.length > 0) lines.push(`Separei o que ficou no seu carrinho: ${items.join(' · ')}.`)
  lines.push(`Para continuar a compra é só acessar: ${checkout.abandonedCheckoutUrl}`)
  lines.push('Se precisar de ajuda com tamanho, cor ou pagamento, me chama por aqui.')
  return lines.join('\n')
}
