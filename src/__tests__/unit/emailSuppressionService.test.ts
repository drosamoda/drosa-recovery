import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emailDb } from '../fixtures/inMemoryEmailDb'

vi.mock('../../config/prisma', async () => {
  const { emailDb: db } = await import('../fixtures/inMemoryEmailDb')
  return { prisma: db.prisma }
})

import {
  EmailHashPepperNotConfiguredError,
  InvalidConsentEmailError,
  InvalidConsentEventError,
  recordEmailConsentEvent,
  recordEmailConsentEventByHashInTx,
} from '../../services/emailConsentService'
import { NormalizedEmailEvent, EmailProviderEventType } from '../../services/emailProviderAdapter'
import {
  applyProviderEvent,
  InvalidSuppressionError,
  isEmailSuppressed,
  suppressEmail,
  suppressEmailByHash,
  suppressionReasonForProviderEvent,
} from '../../services/emailSuppressionService'

const PEPPER = 'pepper-de-teste-0123456789-abcdefghijklmnop'
const EMAIL = 'Cliente.Teste@Example.com'
const HASH = createHmac('sha256', PEPPER).update('cliente.teste@example.com').digest('hex')
const AT = new Date('2026-09-22T12:00:00.000Z')

function providerEvent(type: EmailProviderEventType, id = 'evt-1'): NormalizedEmailEvent {
  return {
    provider: 'mock',
    providerEventId: id,
    type,
    providerMessageId: 'mock-1',
    recipient: EMAIL,
    occurredAt: AT,
    sendId: null,
    campaignKey: null,
  }
}

beforeEach(() => {
  emailDb.reset()
})

describe('suppressEmailByHash — bloqueio + livro-razão', () => {
  it('UNSUBSCRIBE grava o bloqueio e um OPT_OUT CRM_UNSUBSCRIBE; o estado derivado vira OPT_OUT', async () => {
    const result = await suppressEmailByHash({ emailHash: HASH, reason: 'UNSUBSCRIBE', evidenceRef: 'unsubscribe-link:s1:1', occurredAt: AT })

    expect(result).toEqual({ newlySuppressed: true, consentRevoked: true })
    expect(emailDb.suppressions.get(HASH)).toMatchObject({ reason: 'UNSUBSCRIBE', evidenceRef: 'unsubscribe-link:s1:1', suppressedAt: AT })
    expect(emailDb.events).toHaveLength(1)
    expect(emailDb.events[0]).toMatchObject({ emailHash: HASH, status: 'OPT_OUT', source: 'CRM_UNSUBSCRIBE', evidenceRef: 'unsubscribe-link:s1:1' })
    expect(emailDb.states.get(HASH)).toMatchObject({ status: 'OPT_OUT', reason: 'HARD_REVOCATION' })
  })

  it.each([
    ['PROVIDER_UNSUBSCRIBE', 'PROVIDER_EVENT'],
    ['SPAM_COMPLAINT', 'PROVIDER_EVENT'],
    ['MANUAL', 'MANUAL_IMPORT'],
  ] as const)('%s registra revogação na fonte %s', async (reason, source) => {
    const result = await suppressEmailByHash({ emailHash: HASH, reason, evidenceRef: 'ref-1', occurredAt: AT })
    expect(result.consentRevoked).toBe(true)
    expect(emailDb.events.map((e) => [e.source, e.status])).toEqual([[source, 'OPT_OUT']])
  })

  it.each(['HARD_BOUNCE', 'INVALID_ADDRESS'] as const)(
    '%s bloqueia o envio mas NÃO mexe no consentimento (endereço ruim não é revogação)',
    async (reason) => {
      const result = await suppressEmailByHash({ emailHash: HASH, reason, evidenceRef: 'ref-1', occurredAt: AT })
      expect(result).toEqual({ newlySuppressed: true, consentRevoked: false })
      expect(emailDb.suppressions.has(HASH)).toBe(true)
      expect(emailDb.events).toHaveLength(0)
      expect(emailDb.states.size).toBe(0)
    },
  )

  it('é idempotente: repetir o mesmo evento não duplica bloqueio nem linha do livro-razão', async () => {
    const input = { emailHash: HASH, reason: 'UNSUBSCRIBE', evidenceRef: 'unsubscribe-link:s1:1', occurredAt: AT } as const
    const first = await suppressEmailByHash(input)
    const second = await suppressEmailByHash(input)

    expect(first.newlySuppressed).toBe(true)
    expect(second).toEqual({ newlySuppressed: false, consentRevoked: true })
    expect(emailDb.suppressions.size).toBe(1)
    expect(emailDb.events).toHaveLength(1)
  })

  it('a primeira supressão vence: outro motivo depois não reescreve o bloqueio, mas o evento entra no livro-razão', async () => {
    await suppressEmailByHash({ emailHash: HASH, reason: 'UNSUBSCRIBE', evidenceRef: 'a', occurredAt: AT })
    const later = await suppressEmailByHash({ emailHash: HASH, reason: 'SPAM_COMPLAINT', evidenceRef: 'b', occurredAt: new Date(AT.getTime() + 1000) })

    expect(later.newlySuppressed).toBe(false)
    expect(emailDb.suppressions.get(HASH)).toMatchObject({ reason: 'UNSUBSCRIBE', evidenceRef: 'a', suppressedAt: AT })
    expect(emailDb.events.map((e) => e.evidenceRef)).toEqual(['a', 'b'])
  })

  it('é ATÔMICO: se o livro-razão falha, o bloqueio também não fica gravado (rollback)', async () => {
    emailDb.failNextLedgerWrite = true
    await expect(
      suppressEmailByHash({ emailHash: HASH, reason: 'UNSUBSCRIBE', evidenceRef: 'a', occurredAt: AT }),
    ).rejects.toThrow('falha simulada')

    expect(emailDb.suppressions.size).toBe(0)
    expect(emailDb.events).toHaveLength(0)
    expect(emailDb.states.size).toBe(0)
  })

  it('valida antes de abrir transação: hash malformado e evidenceRef vazio não chegam ao banco', async () => {
    const tx = vi.spyOn(emailDb.prisma, '$transaction')
    await expect(suppressEmailByHash({ emailHash: 'x', reason: 'HARD_BOUNCE', evidenceRef: 'a' })).rejects.toThrow(InvalidSuppressionError)
    await expect(suppressEmailByHash({ emailHash: HASH, reason: 'HARD_BOUNCE', evidenceRef: '  ' })).rejects.toThrow(InvalidSuppressionError)
    expect(tx).not.toHaveBeenCalled()
    expect(emailDb.suppressions.size).toBe(0)
    tx.mockRestore()
  })

  it('a supressão vence o consentimento: um opt-in explícito posterior levanta a revogação no livro-razão, mas o e-mail continua suprimido', async () => {
    await suppressEmail({ email: EMAIL, reason: 'UNSUBSCRIBE', evidenceRef: 'a', occurredAt: AT }, PEPPER)

    // O único opt-in que o resolvedor aceita depois de uma revogação explícita.
    const resolution = await recordEmailConsentEvent(
      {
        email: EMAIL,
        status: 'OPT_IN',
        source: 'NUBESDK_EXPLICIT',
        evidenceRef: 'nube:1',
        sourceUpdatedAt: new Date(AT.getTime() + 60_000),
        capturedAt: new Date(AT.getTime() + 60_000),
      },
      PEPPER,
    )
    expect(resolution.state).toBe('CONFIRMED_OPT_IN')

    // A lista de bloqueio é a barreira definitiva: consentimento reaberto não a remove.
    await expect(isEmailSuppressed(EMAIL, PEPPER)).resolves.toBe(true)
  })
})

describe('suppressEmail / isEmailSuppressed — chave por hash, nunca por e-mail', () => {
  it('normaliza o e-mail (caixa e espaços) e grava só o HMAC com o pepper', async () => {
    await suppressEmail({ email: `  ${EMAIL}  `, reason: 'MANUAL', evidenceRef: 'manual:1', occurredAt: AT }, PEPPER)

    expect([...emailDb.suppressions.keys()]).toEqual([HASH])
    const everythingStored = JSON.stringify({ s: [...emailDb.suppressions.values()], e: emailDb.events, st: [...emailDb.states.values()] })
    expect(everythingStored.toLowerCase()).not.toContain('example.com')
    expect(everythingStored.toLowerCase()).not.toContain('cliente.teste')
  })

  it('isEmailSuppressed responde true/false pelo mesmo hash', async () => {
    await expect(isEmailSuppressed(EMAIL, PEPPER)).resolves.toBe(false)
    await suppressEmail({ email: EMAIL, reason: 'HARD_BOUNCE', evidenceRef: 'r' }, PEPPER)
    await expect(isEmailSuppressed('cliente.teste@example.com', PEPPER)).resolves.toBe(true)
    await expect(isEmailSuppressed('outro@example.com', PEPPER)).resolves.toBe(false)
  })

  it('e-mail inválido e pepper ausente lançam antes de qualquer escrita', async () => {
    const tx = vi.spyOn(emailDb.prisma, '$transaction')
    await expect(suppressEmail({ email: 'nao-e-email', reason: 'MANUAL', evidenceRef: 'r' }, PEPPER)).rejects.toThrow(InvalidConsentEmailError)
    await expect(suppressEmail({ email: EMAIL, reason: 'MANUAL', evidenceRef: 'r' }, 'curto')).rejects.toThrow(EmailHashPepperNotConfiguredError)
    await expect(isEmailSuppressed(EMAIL, '')).rejects.toThrow(EmailHashPepperNotConfiguredError)
    expect(tx).not.toHaveBeenCalled()
    tx.mockRestore()
  })

  it('o ledger continua rejeitando combinação inválida (defesa em profundidade)', async () => {
    // Uma fonte "só OPT_OUT" com OPT_IN nunca é gravada: o serviço só emite OPT_OUT,
    // mas a validação do livro-razão é a última barreira.
    await expect(
      recordEmailConsentEventByHashInTx(emailDb.tx as never, HASH, { status: 'OPT_IN', source: 'CRM_UNSUBSCRIBE', evidenceRef: 'x' }),
    ).rejects.toThrow(InvalidConsentEventError)
    await expect(
      recordEmailConsentEventByHashInTx(emailDb.tx as never, 'hash-ruim', { status: 'OPT_OUT', source: 'CRM_UNSUBSCRIBE', evidenceRef: 'x' }),
    ).rejects.toThrow(InvalidConsentEventError)
  })
})

describe('eventos do provedor → supressão', () => {
  it.each([
    ['HARD_BOUNCE', 'HARD_BOUNCE'],
    ['SPAM_COMPLAINT', 'SPAM_COMPLAINT'],
    ['UNSUBSCRIBE', 'PROVIDER_UNSUBSCRIBE'],
    ['DELIVERED', null],
    ['DEFERRED', null],
    ['SOFT_BOUNCE', null],
    ['BLOCKED', null],
    ['OPEN', null],
    ['CLICK', null],
  ] as const)('%s → %s', (type, reason) => {
    expect(suppressionReasonForProviderEvent(type)).toBe(reason)
  })

  it('HARD_BOUNCE suprime; o mesmo evento reenviado pelo provedor é ALREADY_SUPPRESSED', async () => {
    await expect(applyProviderEvent(providerEvent('HARD_BOUNCE'), PEPPER)).resolves.toBe('SUPPRESSED')
    await expect(applyProviderEvent(providerEvent('HARD_BOUNCE'), PEPPER)).resolves.toBe('ALREADY_SUPPRESSED')

    expect(emailDb.suppressions.get(HASH)).toMatchObject({ reason: 'HARD_BOUNCE', evidenceRef: 'provider:mock:evt-1', suppressedAt: AT })
    expect(emailDb.events).toHaveLength(0) // bounce não é revogação
  })

  it('SPAM_COMPLAINT e UNSUBSCRIBE do provedor suprimem E registram OPT_OUT PROVIDER_EVENT', async () => {
    await applyProviderEvent(providerEvent('SPAM_COMPLAINT', 'evt-9'), PEPPER)
    expect(emailDb.suppressions.get(HASH)?.reason).toBe('SPAM_COMPLAINT')
    expect(emailDb.events.map((e) => [e.source, e.status, e.evidenceRef])).toEqual([['PROVIDER_EVENT', 'OPT_OUT', 'provider:mock:evt-9']])
    expect(emailDb.states.get(HASH)?.status).toBe('OPT_OUT')
  })

  it.each(['DELIVERED', 'DEFERRED', 'SOFT_BOUNCE', 'BLOCKED', 'OPEN', 'CLICK'] as const)(
    '%s é ignorado: nenhuma transação, nenhuma escrita',
    async (type) => {
      const tx = vi.spyOn(emailDb.prisma, '$transaction')
      await expect(applyProviderEvent(providerEvent(type), PEPPER)).resolves.toBe('IGNORED')
      expect(tx).not.toHaveBeenCalled()
      expect(emailDb.suppressions.size).toBe(0)
      tx.mockRestore()
    },
  )
})
