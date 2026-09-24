import { describe, expect, it, vi } from 'vitest'

// O gate importa o serviço de consentimento, que importa o Prisma: nenhuma
// consulta real acontece aqui, tudo entra por injeção de dependência.
vi.mock('../../config/prisma', () => ({ prisma: {} }))

import { EmailConsentState } from '../../services/emailConsentResolver'
import {
  assertEmailRecipientAllowed,
  EmailRecipientBlockedError,
  EmailRecipientGateDeps,
  evaluateEmailRecipientGate,
  evaluateEmailSendForRecipient,
  evaluateEmailSendGate,
} from '../../services/emailSendGate'

const EMAIL = 'cliente@example.com'

function deps(state: EmailConsentState, suppressed = false): EmailRecipientGateDeps & {
  getConsentState: ReturnType<typeof vi.fn>
  isSuppressed: ReturnType<typeof vi.fn>
} {
  return {
    getConsentState: vi.fn().mockResolvedValue({ state }),
    isSuppressed: vi.fn().mockResolvedValue(suppressed),
  }
}

describe('evaluateEmailRecipientGate — só OPT_IN confirmado e não suprimido libera', () => {
  it('libera CONFIRMED_OPT_IN não suprimido', async () => {
    expect(await evaluateEmailRecipientGate(EMAIL, deps('CONFIRMED_OPT_IN'))).toEqual({
      allowed: true,
      blocks: [],
      consentState: 'CONFIRMED_OPT_IN',
    })
  })

  it.each(['CONFIRMED_OPT_OUT', 'UNKNOWN', 'NOT_COLLECTED'] as const)('bloqueia %s', async (state) => {
    const result = await evaluateEmailRecipientGate(EMAIL, deps(state))
    expect(result).toEqual({ allowed: false, blocks: ['EMAIL_CONSENT_NOT_OPT_IN'], consentState: state })
  })

  it('a supressão vence o consentimento: OPT_IN suprimido é bloqueado', async () => {
    const result = await evaluateEmailRecipientGate(EMAIL, deps('CONFIRMED_OPT_IN', true))
    expect(result).toEqual({ allowed: false, blocks: ['EMAIL_SUPPRESSED'], consentState: 'CONFIRMED_OPT_IN' })
  })

  it('suprimido E sem consentimento acumula os dois bloqueios', async () => {
    const result = await evaluateEmailRecipientGate(EMAIL, deps('NOT_COLLECTED', true))
    expect(result.blocks).toEqual(['EMAIL_SUPPRESSED', 'EMAIL_CONSENT_NOT_OPT_IN'])
  })

  it.each(['', '   ', 'nao-e-email', 'a@b', '@example.com'])('e-mail inválido (%j) bloqueia sem consultar o banco', async (email) => {
    const d = deps('CONFIRMED_OPT_IN')
    expect(await evaluateEmailRecipientGate(email, d)).toEqual({ allowed: false, blocks: ['EMAIL_INVALID'], consentState: null })
    expect(d.getConsentState).not.toHaveBeenCalled()
    expect(d.isSuppressed).not.toHaveBeenCalled()
  })

  it('erro na leitura do consentimento OU da supressão bloqueia (fail-closed), sem vazar a mensagem', async () => {
    const consentDown: EmailRecipientGateDeps = {
      getConsentState: vi.fn().mockRejectedValue(new Error('senha do banco: hunter2')),
      isSuppressed: vi.fn().mockResolvedValue(false),
    }
    const suppressionDown: EmailRecipientGateDeps = {
      getConsentState: vi.fn().mockResolvedValue({ state: 'CONFIRMED_OPT_IN' }),
      isSuppressed: vi.fn().mockRejectedValue(new Error('tabela email_suppressions não existe')),
    }
    for (const broken of [consentDown, suppressionDown]) {
      const result = await evaluateEmailRecipientGate(EMAIL, broken)
      expect(result).toEqual({ allowed: false, blocks: ['EMAIL_RECIPIENT_CHECK_UNAVAILABLE'], consentState: null })
      expect(JSON.stringify(result)).not.toContain('hunter2')
    }
  })
})

describe('assertEmailRecipientAllowed', () => {
  it('não lança para destinatário liberado', async () => {
    await expect(assertEmailRecipientAllowed(EMAIL, deps('CONFIRMED_OPT_IN'))).resolves.toBeUndefined()
  })

  it('lança EmailRecipientBlockedError com os bloqueios, sem o e-mail na mensagem', async () => {
    const promise = assertEmailRecipientAllowed(EMAIL, deps('CONFIRMED_OPT_OUT', true))
    await expect(promise).rejects.toBeInstanceOf(EmailRecipientBlockedError)
    await expect(promise).rejects.toMatchObject({ blocks: ['EMAIL_SUPPRESSED', 'EMAIL_CONSENT_NOT_OPT_IN'] })
    await expect(promise).rejects.not.toThrow(/example\.com|cliente@/)
  })
})

describe('evaluateEmailSendForRecipient — gate global primeiro, destinatário depois', () => {
  it('com o gate global FECHADO (estado real hoje) nem consulta o destinatário', async () => {
    const d = deps('CONFIRMED_OPT_IN')
    const decision = await evaluateEmailSendForRecipient(EMAIL, d)

    expect(decision.allowed).toBe(false)
    expect(decision.recipient).toBeNull()
    expect(decision.globalMissing).toEqual(evaluateEmailSendGate().missing)
    expect(d.getConsentState).not.toHaveBeenCalled()
    expect(d.isSuppressed).not.toHaveBeenCalled()
  })

  it('com o global aberto (injetado) decide pelo destinatário', async () => {
    const open = () => ({ allowed: true, missing: [] })
    const allowed = await evaluateEmailSendForRecipient(EMAIL, deps('CONFIRMED_OPT_IN'), open)
    expect(allowed).toMatchObject({ allowed: true, globalMissing: [] })

    const blocked = await evaluateEmailSendForRecipient(EMAIL, deps('UNKNOWN'), open)
    expect(blocked.allowed).toBe(false)
    expect(blocked.recipient?.blocks).toEqual(['EMAIL_CONSENT_NOT_OPT_IN'])
  })
})

describe('regressão: o gate global continua FECHADO nesta fase', () => {
  it('provider, consentimento, supressão, domínio, jurídico e flag de envio são condições independentes', () => {
    const gate = evaluateEmailSendGate()
    expect(gate.allowed).toBe(false)
    expect(gate.missing).toEqual([
      'EMAIL_PROVIDER_NOT_CONFIGURED',
      'EMAIL_MARKETING_CONSENT_SOURCE_NOT_CONFIGURED',
      'EMAIL_UNSUBSCRIBE_SUPPRESSION_NOT_IMPLEMENTED',
      'EMAIL_DOMAIN_NOT_AUTHENTICATED',
      'EMAIL_TRANSFER_MECHANISM_REQUIRED',
      'EMAIL_LEGAL_REVIEW_REQUIRED',
      'EMAIL_SEND_DISABLED',
    ])
  })
})
