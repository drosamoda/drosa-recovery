import { describe, expect, it, vi } from 'vitest'

// env.ts lê process.env no import; estes valores existem só neste arquivo de teste.
vi.hoisted(() => {
  process.env.EMAIL_HASH_PEPPER = 'pepper-de-teste-0123456789-abcdefghijklmnop'
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'segredo-de-teste-A-0123456789-abcdefghij'
})

vi.mock('../../config/prisma', () => ({ prisma: {} }))

import {
  assertUnsubscribeHeadersForRecipient,
  issueUnsubscribeHeaders,
  MissingUnsubscribeHeadersError,
  sendEmailThroughGate,
} from '../../services/emailDispatcher'
import { EmailProviderSendError, OutboundEmail } from '../../services/emailProviderAdapter'
import { EmailRecipientBlockedError, EmailRecipientGateDeps, EmailSendNotAvailableError } from '../../services/emailSendGate'
import { UNSUBSCRIBE_PATH, verifyUnsubscribeToken } from '../../services/emailUnsubscribeToken'
import { hashEmail } from '../../services/emailConsentService'
import { EmailSendNotClaimableError, EmailSendTracking } from '../../services/emailTrackingService'
import { MockEmailProvider } from '../fixtures/mockEmailProvider'

const TO = 'cliente@example.com'
const OTHER = 'outra.pessoa@example.com'
const OPEN_GATE = (): void => undefined

function message(overrides: Partial<OutboundEmail> = {}): OutboundEmail {
  return {
    to: TO,
    from: { address: 'novidades@news.exemplo.test', name: "D'Rosa Moda" },
    subject: 'Assunto de teste',
    html: '<p>oi</p>',
    text: 'oi',
    headers: issueUnsubscribeHeaders(TO, { sendId: 'send_1', baseUrl: 'https://crm.exemplo.test' }),
    tracking: { sendId: 'send_1', campaignKey: 'camp_teste' },
    ...overrides,
  }
}

function recipientDeps(state: 'CONFIRMED_OPT_IN' | 'CONFIRMED_OPT_OUT' | 'NOT_COLLECTED', suppressed = false) {
  return {
    getConsentState: vi.fn().mockResolvedValue({ state }),
    isSuppressed: vi.fn().mockResolvedValue(suppressed),
    isInCooldown: vi.fn().mockResolvedValue(false),
  } satisfies EmailRecipientGateDeps
}

// Tracking falso: por padrão o claim sempre vence (sem estado real). Os testes que
// exercitam a perda do claim passam um `claim` próprio.
function trackingDeps(overrides: Partial<EmailSendTracking> = {}): EmailSendTracking {
  return {
    claim: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('sendEmailThroughGate — o gate global REAL segue fechado', () => {
  it('lança EmailSendNotAvailableError, não chama o adapter e não consulta o destinatário', async () => {
    const provider = new MockEmailProvider('whsec')
    const recipient = recipientDeps('CONFIRMED_OPT_IN')

    const promise = sendEmailThroughGate(provider, message(), { recipient })

    await expect(promise).rejects.toBeInstanceOf(EmailSendNotAvailableError)
    await expect(promise).rejects.toMatchObject({
      missing: expect.arrayContaining(['EMAIL_PROVIDER_NOT_CONFIGURED', 'EMAIL_SEND_DISABLED']),
    })
    expect(provider.sent).toHaveLength(0)
    expect(recipient.getConsentState).not.toHaveBeenCalled()
    expect(recipient.isSuppressed).not.toHaveBeenCalled()
  })

  it('o gate global vem ANTES de qualquer outra checagem (cabeçalhos ruins não mascaram o gate fechado)', async () => {
    const provider = new MockEmailProvider('whsec')
    await expect(sendEmailThroughGate(provider, message({ headers: {} }))).rejects.toBeInstanceOf(EmailSendNotAvailableError)
  })
})

describe('sendEmailThroughGate — com o gate global aberto (injetado só no teste)', () => {
  it('envia UMA vez quando cabeçalhos e destinatário estão corretos, e registra claim + envio', async () => {
    const provider = new MockEmailProvider('whsec')
    const msg = message()
    const tracking = trackingDeps()

    const result = await sendEmailThroughGate(provider, msg, { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking })

    expect(result).toEqual({ providerMessageId: 'mock-1' })
    expect(provider.sent).toEqual([msg])
    expect(tracking.claim).toHaveBeenCalledWith('send_1', hashEmail(TO))
    expect(tracking.markSent).toHaveBeenCalledWith('send_1', { provider: 'mock', providerMessageId: 'mock-1' })
    // Ordem: claim ANTES de marcar como enviado.
    const claimOrder = vi.mocked(tracking.claim).mock.invocationCallOrder[0]
    const markSentOrder = vi.mocked(tracking.markSent).mock.invocationCallOrder[0]
    expect(claimOrder).toBeLessThan(markSentOrder)
  })

  it('perder o claim (tentativa já reivindicada) NÃO chama o adapter nem markSent/markFailed', async () => {
    const provider = new MockEmailProvider('whsec')
    const tracking = trackingDeps({ claim: vi.fn().mockRejectedValue(new EmailSendNotClaimableError('NOT_QUEUED')) })

    await expect(
      sendEmailThroughGate(provider, message(), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking }),
    ).rejects.toBeInstanceOf(EmailSendNotClaimableError)

    expect(provider.sent).toHaveLength(0)
    expect(tracking.markSent).not.toHaveBeenCalled()
    expect(tracking.markFailed).not.toHaveBeenCalled()
  })

  it('o claim só acontece DEPOIS que cabeçalhos e destinatário passam (sem efeito colateral em recusa)', async () => {
    const provider = new MockEmailProvider('whsec')
    const tracking = trackingDeps()

    await expect(
      sendEmailThroughGate(provider, message({ headers: {} }), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking }),
    ).rejects.toBeInstanceOf(MissingUnsubscribeHeadersError)
    expect(tracking.claim).not.toHaveBeenCalled()

    await expect(
      sendEmailThroughGate(provider, message(), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_OUT'), tracking }),
    ).rejects.toBeInstanceOf(EmailRecipientBlockedError)
    expect(tracking.claim).not.toHaveBeenCalled()
  })

  it.each([
    ['sem os dois cabeçalhos', {}],
    ['só List-Unsubscribe', { 'List-Unsubscribe': '<https://crm.exemplo.test/unsubscribe/email?t=x>' }],
    ['List-Unsubscribe-Post errado', { 'List-Unsubscribe': '<https://crm.exemplo.test/x?t=y>', 'List-Unsubscribe-Post': 'Outra=Coisa' }],
    ['URL http (One-Click exige https)', { 'List-Unsubscribe': '<http://crm.exemplo.test/x?t=y>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }],
    ['sem URL entre <>', { 'List-Unsubscribe': 'https://crm.exemplo.test/x?t=y', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }],
    ['token inválido', { 'List-Unsubscribe': '<https://crm.exemplo.test/x?t=lixo>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }],
  ])('recusa mensagem %s — sem adapter e sem consultar o destinatário', async (_label, headers) => {
    const provider = new MockEmailProvider('whsec')
    const recipient = recipientDeps('CONFIRMED_OPT_IN')

    await expect(
      sendEmailThroughGate(provider, message({ headers }), { assertGlobalGate: OPEN_GATE, recipient }),
    ).rejects.toBeInstanceOf(MissingUnsubscribeHeadersError)

    expect(provider.sent).toHaveLength(0)
    expect(recipient.getConsentState).not.toHaveBeenCalled()
  })

  it('recusa o link de descadastro de OUTRO destinatário (não pertence a este e-mail)', async () => {
    const provider = new MockEmailProvider('whsec')
    const foreignHeaders = issueUnsubscribeHeaders(OTHER, { baseUrl: 'https://crm.exemplo.test' })

    await expect(
      sendEmailThroughGate(provider, message({ headers: foreignHeaders }), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN') }),
    ).rejects.toThrow(/não pertence a este destinatário/)
    expect(provider.sent).toHaveLength(0)
  })

  it('recusa link assinado com OUTRA chave (forjado)', async () => {
    const provider = new MockEmailProvider('whsec')
    const forged = issueUnsubscribeHeaders(TO, { baseUrl: 'https://crm.exemplo.test', secret: 'chave-forjada-0123456789-abcdefghijklmnop' })

    await expect(
      sendEmailThroughGate(provider, message({ headers: forged }), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN') }),
    ).rejects.toThrow(/BAD_SIGNATURE/)
    expect(provider.sent).toHaveLength(0)
  })

  it('nomes de cabeçalho não diferenciam maiúsculas de minúsculas', async () => {
    const provider = new MockEmailProvider('whsec')
    const original = issueUnsubscribeHeaders(TO, { baseUrl: 'https://crm.exemplo.test' })
    const lower = { 'list-unsubscribe': original['List-Unsubscribe'], 'LIST-UNSUBSCRIBE-POST': original['List-Unsubscribe-Post'] }

    await sendEmailThroughGate(provider, message({ headers: lower }), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking: trackingDeps() })
    expect(provider.sent).toHaveLength(1)
  })

  it.each([
    ['sem consentimento coletado', recipientDeps('NOT_COLLECTED'), ['EMAIL_CONSENT_NOT_OPT_IN']],
    ['com opt-out', recipientDeps('CONFIRMED_OPT_OUT'), ['EMAIL_CONSENT_NOT_OPT_IN']],
    ['opt-in mas suprimido', recipientDeps('CONFIRMED_OPT_IN', true), ['EMAIL_SUPPRESSED']],
  ])('bloqueia destinatário %s e não chama o adapter', async (_label, recipient, blocks) => {
    const provider = new MockEmailProvider('whsec')

    const promise = sendEmailThroughGate(provider, message(), { assertGlobalGate: OPEN_GATE, recipient })

    await expect(promise).rejects.toBeInstanceOf(EmailRecipientBlockedError)
    await expect(promise).rejects.toMatchObject({ blocks })
    expect(provider.sent).toHaveLength(0)
  })

  it('erro RETRYABLE do adapter propaga e marca a tentativa de volta a QUEUED', async () => {
    const provider = new MockEmailProvider('whsec')
    provider.failNextSend(new EmailProviderSendError('timeout no provedor', true))
    const tracking = trackingDeps()

    const promise = sendEmailThroughGate(provider, message(), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking })

    await expect(promise).rejects.toMatchObject({ retryable: true })
    expect(provider.sent).toHaveLength(0)
    expect(tracking.markFailed).toHaveBeenCalledWith('send_1', { retryable: true, reason: 'PROVIDER_TEMPORARY' })
    expect(tracking.markSent).not.toHaveBeenCalled()
  })

  it('erro NÃO retryable do adapter propaga e marca a tentativa como FAILED', async () => {
    const provider = new MockEmailProvider('whsec')
    provider.failNextSend(new EmailProviderSendError('endereço recusado', false))
    const tracking = trackingDeps()

    await expect(
      sendEmailThroughGate(provider, message(), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking }),
    ).rejects.toMatchObject({ retryable: false })
    expect(tracking.markFailed).toHaveBeenCalledWith('send_1', { retryable: false, reason: 'PROVIDER_REJECTED' })
  })

  it('um erro DESCONHECIDO (não do provedor) propaga sem chamar markFailed nem markSent — a tentativa fica em SENDING para revisão', async () => {
    const provider = new MockEmailProvider('whsec')
    provider.send = vi.fn().mockRejectedValue(new Error('falha inesperada'))
    const tracking = trackingDeps()

    await expect(
      sendEmailThroughGate(provider, message(), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking }),
    ).rejects.toThrow('falha inesperada')
    expect(tracking.markFailed).not.toHaveBeenCalled()
    expect(tracking.markSent).not.toHaveBeenCalled()
  })

  it('quando o envio saiu mas markSent falha, o resultado do envio é devolvido mesmo assim (não relança)', async () => {
    const provider = new MockEmailProvider('whsec')
    const tracking = trackingDeps({ markSent: vi.fn().mockRejectedValue(new Error('banco fora')) })

    const result = await sendEmailThroughGate(provider, message(), { assertGlobalGate: OPEN_GATE, recipient: recipientDeps('CONFIRMED_OPT_IN'), tracking })

    expect(result).toEqual({ providerMessageId: 'mock-1' })
    expect(provider.sent).toHaveLength(1)
  })
})

describe('issueUnsubscribeHeaders', () => {
  it('gera List-Unsubscribe https com token que resolve para o hash do destinatário e o sendId', () => {
    const headers = issueUnsubscribeHeaders(TO, { sendId: 'send_42', baseUrl: 'https://crm.exemplo.test/' })

    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const url = new URL(headers['List-Unsubscribe'].slice(1, -1))
    expect(url.origin + url.pathname).toBe(`https://crm.exemplo.test${UNSUBSCRIBE_PATH}`)

    const verified = verifyUnsubscribeToken(url.searchParams.get('t'))
    expect(verified.ok && verified.payload.emailHash).toBe(hashEmail(TO))
    expect(verified.ok && verified.payload.sendId).toBe('send_42')
  })

  it('o e-mail em claro nunca aparece nos cabeçalhos', () => {
    const headers = issueUnsubscribeHeaders(TO, { baseUrl: 'https://crm.exemplo.test' })
    expect(JSON.stringify(headers).toLowerCase()).not.toContain('example.com')
    expect(JSON.stringify(headers).toLowerCase()).not.toContain('cliente')
  })

  it('recusa URL base http e chave ausente', () => {
    expect(() => issueUnsubscribeHeaders(TO, { baseUrl: 'http://crm.exemplo.test' })).toThrow()
    expect(() => issueUnsubscribeHeaders(TO, { baseUrl: 'https://crm.exemplo.test', secret: '' })).toThrow()
  })

  it('assertUnsubscribeHeadersForRecipient aceita o par emitido para o próprio destinatário', () => {
    const headers = issueUnsubscribeHeaders(TO, { baseUrl: 'https://crm.exemplo.test' })
    expect(() => assertUnsubscribeHeadersForRecipient(headers, TO)).not.toThrow()
    expect(() => assertUnsubscribeHeadersForRecipient(headers, OTHER)).toThrow(MissingUnsubscribeHeadersError)
  })
})
