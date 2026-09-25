import { createHmac } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import {
  extractCheckoutConsentSignal,
  extractOrderConsentSignal,
  normalizeEmail,
} from './emailConsentSignals'
import {
  ConsentEventInput,
  ConsentResolution,
  ConsentResolutionReason,
  EmailConsentSource,
  EmailConsentState,
  EmailConsentStatus,
  isValidConsentEvent,
  resolveEmailConsent,
} from './emailConsentResolver'

// Consentimento de e-mail, camada de banco. Separado do WhatsApp: WhatsappConsent,
// Customer.optOut e Suppression NÃO valem aqui. O e-mail nunca é gravado —
// só emailHash = HMAC-SHA256(e-mail normalizado, EMAIL_HASH_PEPPER). Nenhuma
// função deste arquivo envia e-mail, mexe no gate ou chama a Nuvemshop.

export const EMAIL_HASH_PEPPER_MIN_LENGTH = 32

export class EmailHashPepperNotConfiguredError extends Error {
  constructor() {
    super(`EMAIL_HASH_PEPPER ausente ou curto demais (mínimo ${EMAIL_HASH_PEPPER_MIN_LENGTH} caracteres): consentimento de e-mail indisponível.`)
  }
}

export class InvalidConsentEmailError extends Error {
  constructor() {
    super('E-mail inválido para registro de consentimento.')
  }
}

export class InvalidConsentEventError extends Error {}

export function hashEmail(email: string, pepper: string = env.EMAIL_HASH_PEPPER): string {
  if (pepper.length < EMAIL_HASH_PEPPER_MIN_LENGTH) throw new EmailHashPepperNotConfiguredError()
  const normalized = normalizeEmail(email)
  if (!normalized) throw new InvalidConsentEmailError()
  return createHmac('sha256', pepper).update(normalized).digest('hex')
}

type Tx = Prisma.TransactionClient

interface StoredEvent {
  emailHash: string
  status: EmailConsentStatus
  source: EmailConsentSource
  sourceUpdatedAt: Date | null
  capturedAt: Date
}

// Recalcula e grava o estado atual de cada hash a partir do livro-razão.
// O estado é sempre DERIVADO: pode ser refeito do zero a qualquer momento.
async function recomputeStates(tx: Tx, hashes: string[]): Promise<Map<string, ConsentResolution>> {
  const stored: StoredEvent[] = await tx.emailConsentEvent.findMany({
    where: { emailHash: { in: hashes } },
    select: { emailHash: true, status: true, source: true, sourceUpdatedAt: true, capturedAt: true },
  })
  const byHash = new Map<string, ConsentEventInput[]>()
  for (const row of stored) {
    const list = byHash.get(row.emailHash) ?? []
    list.push({ status: row.status, source: row.source, sourceUpdatedAt: row.sourceUpdatedAt, capturedAt: row.capturedAt })
    byHash.set(row.emailHash, list)
  }

  const resolutions = new Map<string, ConsentResolution>()
  for (const hash of hashes) {
    const resolution = resolveEmailConsent(byHash.get(hash) ?? [])
    resolutions.set(hash, resolution)
    if (resolution.status === null) continue
    await tx.emailMarketingConsent.upsert({
      where: { emailHash: hash },
      create: {
        emailHash: hash,
        status: resolution.status,
        reason: resolution.reason,
        eventCount: resolution.eventCount,
        lastEventAt: resolution.lastEventAt,
      },
      update: {
        status: resolution.status,
        reason: resolution.reason,
        eventCount: resolution.eventCount,
        lastEventAt: resolution.lastEventAt,
      },
    })
  }
  return resolutions
}

export interface RecordConsentEventInput {
  email: string
  status: EmailConsentStatus
  source: EmailConsentSource
  // Identifica UMA observação (ex.: "order:123:customer.accepts_marketing" ou
  // "customer:987@2026-09-01T10:00:00Z"). A gravação é idempotente por
  // (emailHash, source, evidenceRef): para leituras repetidas da mesma origem,
  // inclua a versão/horário no ref, senão a mudança seria tratada como duplicata.
  // Nunca coloque e-mail, nome, telefone ou payload aqui.
  evidenceRef: string
  sourceUpdatedAt?: Date | null
  capturedAt?: Date
  customerId?: string | null
}

// Valida a observação e devolve o emailHash. Roda ANTES de abrir qualquer
// transação: entrada inválida nunca chega ao banco.
function prepareConsentEvent(input: RecordConsentEventInput, pepper: string): string {
  if (!isValidConsentEvent(input)) {
    throw new InvalidConsentEventError(`A fonte ${input.source} só pode registrar OPT_OUT.`)
  }
  if (input.evidenceRef.trim() === '') throw new InvalidConsentEventError('evidenceRef é obrigatório.')
  return hashEmail(input.email, pepper)
}

async function writeConsentEvent(
  tx: Tx,
  emailHash: string,
  input: RecordConsentEventByHashInput,
): Promise<ConsentResolution> {
  await tx.emailConsentEvent.createMany({
    data: [
      {
        emailHash,
        customerId: input.customerId ?? null,
        status: input.status,
        source: input.source,
        evidenceRef: input.evidenceRef,
        sourceUpdatedAt: input.sourceUpdatedAt ?? null,
        capturedAt: input.capturedAt ?? new Date(),
      },
    ],
    skipDuplicates: true,
  })
  const resolutions = await recomputeStates(tx, [emailHash])
  return resolutions.get(emailHash) as ConsentResolution
}

// Único caminho de escrita de UM evento (descadastro, evento do provedor,
// NubeSDK, API de clientes...). Grava no livro-razão e devolve o estado novo.
export async function recordEmailConsentEvent(
  input: RecordConsentEventInput,
  pepper: string = env.EMAIL_HASH_PEPPER,
): Promise<ConsentResolution> {
  const emailHash = prepareConsentEvent(input, pepper)
  return prisma.$transaction((tx) => writeConsentEvent(tx, emailHash, input))
}

export interface RecordConsentEventsBatchResult {
  inputEvents: number
  uniqueHashes: number
  eventsInserted: number
  statesRecomputed: number
}

// Caminho em lote para fontes confiáveis já normalizadas em memória (ex. /customers).
// O e-mail existe somente durante a preparação do HMAC; createMany recebe apenas
// emailHash + ids opacos + metadados de consentimento. Reexecução é idempotente
// pelo @@unique(emailHash, source, evidenceRef) do ledger.
export async function recordEmailConsentEventsBatch(
  inputs: readonly RecordConsentEventInput[],
  pepper: string = env.EMAIL_HASH_PEPPER,
  batchSize = 200,
): Promise<RecordConsentEventsBatchResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new InvalidConsentEventError('batchSize inválido.')
  }

  const prepared = inputs.map((input) => ({
    emailHash: prepareConsentEvent(input, pepper),
    customerId: input.customerId ?? null,
    status: input.status,
    source: input.source,
    evidenceRef: input.evidenceRef,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    capturedAt: input.capturedAt ?? new Date(),
  }))
  const byHash = new Map<string, typeof prepared>()
  for (const event of prepared) {
    const list = byHash.get(event.emailHash) ?? []
    list.push(event)
    byHash.set(event.emailHash, list)
  }

  const hashes = [...byHash.keys()]
  let eventsInserted = 0
  let statesRecomputed = 0
  for (let start = 0; start < hashes.length; start += batchSize) {
    const chunk = hashes.slice(start, start + batchSize)
    const data = chunk.flatMap((hash) => byHash.get(hash) ?? [])
    const outcome = await prisma.$transaction(async (tx) => {
      const created = await tx.emailConsentEvent.createMany({ data, skipDuplicates: true })
      const resolutions = await recomputeStates(tx, chunk)
      return { inserted: created.count, recomputed: resolutions.size }
    }, { timeout: 60_000 })
    eventsInserted += outcome.inserted
    statesRecomputed += outcome.recomputed
  }

  return { inputEvents: inputs.length, uniqueHashes: hashes.length, eventsInserted, statesRecomputed }
}

const EMAIL_HASH_FORMAT = /^[0-9a-f]{64}$/

export type RecordConsentEventByHashInput = Omit<RecordConsentEventInput, 'email'>

// Mesma escrita, mas a partir de um emailHash JÁ calculado e dentro de uma
// transação JÁ ABERTA por quem chama. Usada pela supressão de e-mail para
// gravar bloqueio + evento no livro-razão de forma atômica (ou os dois, ou
// nenhum) — inclusive no descadastro por link, onde o token só carrega o hash,
// nunca o e-mail. As mesmas validações de recordEmailConsentEvent se aplicam.
export async function recordEmailConsentEventByHashInTx(
  tx: Tx,
  emailHash: string,
  input: RecordConsentEventByHashInput,
): Promise<ConsentResolution> {
  if (!EMAIL_HASH_FORMAT.test(emailHash)) throw new InvalidConsentEventError('emailHash inválido.')
  if (!isValidConsentEvent(input)) {
    throw new InvalidConsentEventError(`A fonte ${input.source} só pode registrar OPT_OUT.`)
  }
  if (input.evidenceRef.trim() === '') throw new InvalidConsentEventError('evidenceRef é obrigatório.')
  return writeConsentEvent(tx, emailHash, input)
}

export interface EmailConsentLookup {
  state: EmailConsentState
  reason: string | null
}

function stateFromStatus(status: EmailConsentStatus): EmailConsentState {
  if (status === 'OPT_IN') return 'CONFIRMED_OPT_IN'
  if (status === 'OPT_OUT') return 'CONFIRMED_OPT_OUT'
  return 'UNKNOWN'
}

// Leitura para gates e telas. Ausência de linha = NOT_COLLECTED. E-mail
// inválido também é NOT_COLLECTED (fail-closed); já a falta de pepper é erro
// de configuração e propaga.
export async function getEmailConsentState(
  email: string,
  pepper: string = env.EMAIL_HASH_PEPPER,
): Promise<EmailConsentLookup> {
  let emailHash: string
  try {
    emailHash = hashEmail(email, pepper)
  } catch (error) {
    if (error instanceof InvalidConsentEmailError) return { state: 'NOT_COLLECTED', reason: null }
    throw error
  }
  const row = await prisma.emailMarketingConsent.findUnique({
    where: { emailHash },
    select: { status: true, reason: true },
  })
  if (!row) return { state: 'NOT_COLLECTED', reason: null }
  return { state: stateFromStatus(row.status), reason: row.reason }
}

// ---------------------------------------------------------------------------
// Backfill a partir dos payloads já gravados (pedidos e checkouts abandonados).
// A leitura das linhas é feita por quem chama (script com credencial autorizada);
// aqui só há construção pura do plano, prévia sem escrita e a escrita em lotes.
// ---------------------------------------------------------------------------

export interface BackfillOrderRow {
  nuvemshopOrderId: string
  // Order.customerEmail com fallback para o e-mail do Customer ligado ao pedido.
  email: string | null
  customerId: string | null
  rawPayload: unknown
  // sourceUpdatedAt ?? sourceCreatedAt ?? createdAt do pedido (usado quando o payload não traz data).
  capturedAt: Date
}

export interface BackfillCheckoutRow {
  nuvemshopCheckoutId: string
  email: string | null
  customerId: string | null
  rawPayload: unknown
  capturedAt: Date
}

export interface BackfillEvent {
  emailHash: string
  customerId: string | null
  status: EmailConsentStatus
  source: EmailConsentSource
  evidenceRef: string
  sourceUpdatedAt: Date | null
  capturedAt: Date
}

export interface BackfillPlan {
  events: BackfillEvent[]
  skipped: { noEmail: number; invalidEmail: number; noSignal: number }
}

export function buildBackfillEvents(
  rows: { orders: readonly BackfillOrderRow[]; checkouts: readonly BackfillCheckoutRow[] },
  pepper: string = env.EMAIL_HASH_PEPPER,
): BackfillPlan {
  const events: BackfillEvent[] = []
  const skipped = { noEmail: 0, invalidEmail: 0, noSignal: 0 }

  const add = (
    source: EmailConsentSource,
    refPrefix: string,
    row: { email: string | null; customerId: string | null; rawPayload: unknown; capturedAt: Date },
    extract: (raw: unknown) => ReturnType<typeof extractOrderConsentSignal>,
  ): void => {
    if (row.email === null || row.email.trim() === '') {
      skipped.noEmail++
      return
    }
    if (normalizeEmail(row.email) === null) {
      skipped.invalidEmail++
      return
    }
    const signal = extract(row.rawPayload)
    if (signal === null) {
      skipped.noSignal++
      return
    }
    events.push({
      emailHash: hashEmail(row.email, pepper),
      customerId: row.customerId,
      status: signal.status,
      source,
      evidenceRef: `${refPrefix}:${signal.evidencePath}`,
      sourceUpdatedAt: signal.sourceUpdatedAt,
      capturedAt: row.capturedAt,
    })
  }

  for (const order of rows.orders) {
    add('NUVEMSHOP_ORDER_PAYLOAD', `order:${order.nuvemshopOrderId}`, order, extractOrderConsentSignal)
  }
  for (const checkout of rows.checkouts) {
    add('NUVEMSHOP_CHECKOUT_PAYLOAD', `checkout:${checkout.nuvemshopCheckoutId}`, checkout, extractCheckoutConsentSignal)
  }
  return { events, skipped }
}

function groupByHash(events: readonly BackfillEvent[]): Map<string, BackfillEvent[]> {
  const grouped = new Map<string, BackfillEvent[]>()
  for (const event of events) {
    const list = grouped.get(event.emailHash) ?? []
    list.push(event)
    grouped.set(event.emailHash, list)
  }
  return grouped
}

export interface BackfillPreview {
  emailsWithEvents: number
  eventsTotal: number
  byState: Record<EmailConsentState, number>
  byReason: Partial<Record<ConsentResolutionReason, number>>
  eventsBySource: Partial<Record<EmailConsentSource, number>>
  skipped: BackfillPlan['skipped']
}

// Prévia PURA (sem banco): mesma resolução que a gravação usaria, só agregados.
// `emailsWithEvents` não inclui e-mails sem nenhum sinal (NOT_COLLECTED): quem
// chama subtrai do total de e-mails da base.
export function previewBackfill(plan: BackfillPlan): BackfillPreview {
  const byState: Record<EmailConsentState, number> = {
    CONFIRMED_OPT_IN: 0,
    CONFIRMED_OPT_OUT: 0,
    UNKNOWN: 0,
    NOT_COLLECTED: 0,
  }
  const byReason: Partial<Record<ConsentResolutionReason, number>> = {}
  const eventsBySource: Partial<Record<EmailConsentSource, number>> = {}

  for (const event of plan.events) {
    eventsBySource[event.source] = (eventsBySource[event.source] ?? 0) + 1
  }
  const grouped = groupByHash(plan.events)
  for (const events of grouped.values()) {
    const resolution = resolveEmailConsent(
      events.map((event) => ({
        status: event.status,
        source: event.source,
        sourceUpdatedAt: event.sourceUpdatedAt,
        capturedAt: event.capturedAt,
      })),
    )
    byState[resolution.state]++
    byReason[resolution.reason] = (byReason[resolution.reason] ?? 0) + 1
  }
  return {
    emailsWithEvents: grouped.size,
    eventsTotal: plan.events.length,
    byState,
    byReason,
    eventsBySource,
    skipped: plan.skipped,
  }
}

export interface BackfillWriteResult {
  eventsInserted: number
  statesWritten: number
}

// Escrita em lotes por hash. Idempotente: reexecutar não duplica eventos
// (skipDuplicates) e recalcula os mesmos estados. Só chamar com credencial
// e autorização explícitas — o CI nunca aponta para um banco real.
export async function writeBackfill(plan: BackfillPlan, batchSize = 200): Promise<BackfillWriteResult> {
  const grouped = groupByHash(plan.events)
  const hashes = [...grouped.keys()]
  let eventsInserted = 0
  let statesWritten = 0

  for (let start = 0; start < hashes.length; start += batchSize) {
    const chunk = hashes.slice(start, start + batchSize)
    const data = chunk.flatMap((hash) => grouped.get(hash) ?? [])
    const outcome = await prisma.$transaction(
      async (tx) => {
        const created = await tx.emailConsentEvent.createMany({ data, skipDuplicates: true })
        const resolutions = await recomputeStates(tx, chunk)
        const written = [...resolutions.values()].filter((resolution) => resolution.status !== null).length
        return { inserted: created.count, written }
      },
      { timeout: 60_000 },
    )
    eventsInserted += outcome.inserted
    statesWritten += outcome.written
  }
  return { eventsInserted, statesWritten }
}
