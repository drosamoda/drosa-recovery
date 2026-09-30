import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { env } from '../../config/env'

const mocks = vi.hoisted(() => ({
  chatFindUnique: vi.fn(),
  logCreate: vi.fn(),
  logFindMany: vi.fn(),
  logUpdate: vi.fn(),
  logUpdateMany: vi.fn(),
  convFindUnique: vi.fn(),
  convUpdate: vi.fn(),
  customerFindFirst: vi.fn(),
  suppressionFindUnique: vi.fn(),
  checkoutFindMany: vi.fn(),
  orderFindFirst: vi.fn(),
  sendManualText: vi.fn(),
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    chatMessage: { findUnique: mocks.chatFindUnique },
    messageLog: { create: mocks.logCreate, findMany: mocks.logFindMany, update: mocks.logUpdate, updateMany: mocks.logUpdateMany },
    conversation: { findUnique: mocks.convFindUnique, update: mocks.convUpdate },
    customer: { findFirst: mocks.customerFindFirst },
    suppression: { findUnique: mocks.suppressionFindUnique },
    abandonedCheckout: { findMany: mocks.checkoutFindMany },
    order: { findFirst: mocks.orderFindFirst },
  },
}))
vi.mock('../../services/inboxService', () => ({ inboxService: { sendManualTextMessage: mocks.sendManualText } }))

import {
  RECOVERY_CANONICAL_TEXT,
  RECOVERY_SOURCE,
  buildRecoveryReply,
  extractRecoveryIntents,
  isCartRecoveryIntent,
  matchRecoveryCheckout,
  normalizeIntentText,
  registerRecoveryIntents,
} from '../../services/customerInitiatedRecovery'
import { runProcessCustomerInitiatedRecovery } from '../../jobs/processCustomerInitiatedRecovery'

const PHONE = '5583988887777'

function payload(body: string, over: Record<string, unknown> = {}): unknown {
  return { entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: PHONE, type: 'text', text: { body }, ...over }] } }] }] }
}

const checkout = (over: Record<string, unknown> = {}) => ({
  id: 'ck1',
  productsSummary: '1x Vestido Midi, 2x Blusa Lis',
  abandonedCheckoutUrl: `${env.CHECKOUT_BASE_URL}abc123`,
  sourceCreatedAt: new Date(Date.now() - 3_600_000),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  env.CUSTOMER_INITIATED_RECOVERY_ENABLED = true
  mocks.chatFindUnique.mockResolvedValue({ conversationId: 'conv1' })
  mocks.logCreate.mockResolvedValue({})
  mocks.logUpdate.mockResolvedValue({})
  mocks.logUpdateMany.mockResolvedValue({ count: 1 })
  mocks.convUpdate.mockResolvedValue({})
  mocks.customerFindFirst.mockResolvedValue({ optOut: false })
  mocks.suppressionFindUnique.mockResolvedValue(null)
  mocks.orderFindFirst.mockResolvedValue(null)
  mocks.checkoutFindMany.mockResolvedValue([checkout()])
  mocks.convFindUnique.mockResolvedValue({ id: 'conv1', lastInboundAt: new Date(Date.now() - 60_000), contact: { phone: PHONE } })
  mocks.sendManualText.mockResolvedValue({ success: true, dryRun: false })
  mocks.logFindMany.mockResolvedValue([{ id: 'log1', entityId: 'conv1', normalizedPhone: PHONE }])
})

describe('detecção determinística da intenção', () => {
  it('normaliza acento, caixa e pontuação', () => {
    expect(normalizeIntentText("  Oi!  Quero CONTINUAR minha compra na D'Rosa… ")).toBe('oi quero continuar minha compra na d rosa')
  })
  it('reconhece a mensagem canônica e variações simples; ignora o resto', () => {
    expect(isCartRecoveryIntent(RECOVERY_CANONICAL_TEXT)).toBe(true)
    expect(isCartRecoveryIntent('quero continuar minha compra, por favor')).toBe(true)
    expect(isCartRecoveryIntent('Oi, quanto custa o vestido?')).toBe(false)
    expect(isCartRecoveryIntent(null)).toBe(false)
  })
  it('extrai só TEXTO com a intenção e normaliza o telefone do remetente', () => {
    expect(extractRecoveryIntents(payload(RECOVERY_CANONICAL_TEXT))).toEqual([{ waMessageId: 'wamid.1', phone: PHONE }])
    expect(extractRecoveryIntents(payload(RECOVERY_CANONICAL_TEXT, { type: 'image' }))).toEqual([])
    expect(extractRecoveryIntents(payload('bom dia'))).toEqual([])
  })
})

describe('registro da intenção (webhook)', () => {
  it('flag desligada: zero escrita', async () => {
    env.CUSTOMER_INITIATED_RECOVERY_ENABLED = false
    expect(await registerRecoveryIntents(payload(RECOVERY_CANONICAL_TEXT))).toEqual({ registered: 0, duplicates: 0 })
    expect(mocks.logCreate).not.toHaveBeenCalled()
  })
  it('registra uma linha idempotente por waMessageId, sem consentimento de marketing', async () => {
    const r = await registerRecoveryIntents(payload(RECOVERY_CANONICAL_TEXT))
    expect(r).toEqual({ registered: 1, duplicates: 0 })
    expect(mocks.logCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ idempotencyKey: `${RECOVERY_SOURCE}:wamid.1`, entityType: 'conversation', entityId: 'conv1', status: 'pending', source: RECOVERY_SOURCE }),
    })
  })
  it('mesmo inbound reentregue pela Meta → duplicata, sem erro', async () => {
    mocks.logCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await registerRecoveryIntents(payload(RECOVERY_CANONICAL_TEXT))).toEqual({ registered: 0, duplicates: 1 })
  })
  it('nunca lança: falha inesperada não derruba o webhook', async () => {
    mocks.logCreate.mockRejectedValue(new Error('db down'))
    await expect(registerRecoveryIntents(payload(RECOVERY_CANONICAL_TEXT))).resolves.toEqual({ registered: 0, duplicates: 0 })
  })
})

describe('matching do carrinho', () => {
  it('um carrinho aberto recente → match', async () => {
    expect((await matchRecoveryCheckout(PHONE)).kind).toBe('match')
    expect(mocks.checkoutFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ normalizedPhone: PHONE, status: 'abandoned', convertedAt: null }),
    }))
  })
  it('dois carrinhos com o MESMO conteúdo → pega o mais recente (não é ambíguo)', async () => {
    mocks.checkoutFindMany.mockResolvedValue([checkout({ id: 'a' }), checkout({ id: 'b' })])
    const m = await matchRecoveryCheckout(PHONE)
    expect(m).toMatchObject({ kind: 'match', checkout: { id: 'a' } })
  })
  it('carrinhos diferentes → ambíguo; nenhum → none; pedido posterior → none', async () => {
    mocks.checkoutFindMany.mockResolvedValue([checkout({ id: 'a' }), checkout({ id: 'b', productsSummary: '1x Calça' })])
    expect((await matchRecoveryCheckout(PHONE)).kind).toBe('ambiguous')
    mocks.checkoutFindMany.mockResolvedValue([])
    expect((await matchRecoveryCheckout(PHONE)).kind).toBe('none')
    mocks.checkoutFindMany.mockResolvedValue([checkout()])
    mocks.orderFindFirst.mockResolvedValue({ id: 'o1' })
    expect((await matchRecoveryCheckout(PHONE)).kind).toBe('none')
  })
})

describe('resposta mínima', () => {
  it('até 3 itens + link; nunca nome, e-mail, telefone ou documento', () => {
    const text = buildRecoveryReply(checkout({ productsSummary: 'A, B, C, D, E' })) as string
    expect(text).toContain('A · B · C')
    expect(text).not.toContain('D')
    expect(text).toContain(`${env.CHECKOUT_BASE_URL}abc123`)
    expect(text).not.toMatch(/@|\d{10,}|cpf|maria/i)
  })
  it('URL fora da base do checkout → sem resposta (handoff)', () => {
    expect(buildRecoveryReply(checkout({ abandonedCheckoutUrl: 'https://evil.example/x' }))).toBeNull()
    expect(buildRecoveryReply(checkout({ abandonedCheckoutUrl: 'http://x' }))).toBeNull()
  })
})

describe('job de processamento', () => {
  it('flag desligada: nada é lido nem enviado', async () => {
    env.CUSTOMER_INITIATED_RECOVERY_ENABLED = false
    const r = await runProcessCustomerInitiatedRecovery()
    expect(r.enabled).toBe(false)
    expect(mocks.logFindMany).not.toHaveBeenCalled()
    expect(mocks.sendManualText).not.toHaveBeenCalled()
  })

  it('caminho feliz: envia UMA resposta livre na janela e marca sent', async () => {
    const r = await runProcessCustomerInitiatedRecovery()
    expect(r).toMatchObject({ claimed: 1, sent: 1, handoff: 0, failed: 0 })
    expect(mocks.sendManualText).toHaveBeenCalledTimes(1)
    expect(mocks.sendManualText).toHaveBeenCalledWith('conv1', expect.stringContaining('abc123'))
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'sent', reason: null }) }))
  })

  it('idempotência: claim perdido (outra execução já pegou) → nenhuma resposta', async () => {
    mocks.logUpdateMany.mockResolvedValue({ count: 0 })
    const r = await runProcessCustomerInitiatedRecovery()
    expect(r.claimed).toBe(0)
    expect(mocks.sendManualText).not.toHaveBeenCalled()
  })

  it('fora da janela de 24h → handoff humano, sem resposta e sem falha', async () => {
    mocks.convFindUnique.mockResolvedValue({ id: 'conv1', lastInboundAt: new Date(Date.now() - 30 * 3_600_000), contact: { phone: PHONE } })
    const r = await runProcessCustomerInitiatedRecovery()
    expect(r).toMatchObject({ handoff: 1, sent: 0, failed: 0 })
    expect(mocks.sendManualText).not.toHaveBeenCalled()
    expect(mocks.convUpdate).toHaveBeenCalledWith({ where: { id: 'conv1' }, data: { status: 'open', assignedTo: null } })
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'skipped', reason: 'handoff_outside_window' }) }))
  })

  it('sem carrinho ou ambíguo → handoff, nunca inventa', async () => {
    mocks.checkoutFindMany.mockResolvedValue([])
    let r = await runProcessCustomerInitiatedRecovery()
    expect(r.handoff).toBe(1)
    mocks.checkoutFindMany.mockResolvedValue([checkout({ id: 'a' }), checkout({ id: 'b', productsSummary: '1x Calça' })])
    r = await runProcessCustomerInitiatedRecovery()
    expect(r.handoff).toBe(1)
    expect(mocks.sendManualText).not.toHaveBeenCalled()
  })

  it('opt-out/supressão → não responde (skipped, não é falha)', async () => {
    mocks.suppressionFindUnique.mockResolvedValue({ id: 's1' })
    const r = await runProcessCustomerInitiatedRecovery()
    expect(r).toMatchObject({ skipped: 1, sent: 0, failed: 0 })
    expect(mocks.sendManualText).not.toHaveBeenCalled()
  })

  it('INBOX_SEND_DRY_RUN → simula sem enviar e consome a intenção (fail-closed)', async () => {
    mocks.sendManualText.mockResolvedValue({ success: true, dryRun: true })
    const r = await runProcessCustomerInitiatedRecovery()
    expect(r).toMatchObject({ simulated: 1, sent: 0 })
    expect(mocks.logUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'skipped', reason: 'inbox_send_dry_run' }) }))
  })

  it('falha de envio → failed sem retry automático; exceção → categoria fechada sem vazar mensagem', async () => {
    mocks.sendManualText.mockResolvedValue({ success: false, statusCode: 502, error: 'token=secret' })
    let r = await runProcessCustomerInitiatedRecovery()
    expect(r.failed).toBe(1)
    mocks.sendManualText.mockRejectedValue(new Error('password=hunter2'))
    r = await runProcessCustomerInitiatedRecovery()
    expect(r.failed).toBe(1)
    expect(JSON.stringify(mocks.logUpdate.mock.calls)).not.toMatch(/hunter2|token=secret/)
  })

  it('nunca grava consentimento de marketing (a conversa não é opt-in)', async () => {
    await runProcessCustomerInitiatedRecovery()
    expect(mocks.customerFindFirst).toHaveBeenCalled() // só lê opt-out; não há nenhuma escrita em consentimento mockada
  })
})
