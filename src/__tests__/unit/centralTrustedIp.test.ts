import { describe, expect, it } from 'vitest'
import { trustedClientIp } from '../../services/centralSession'

describe('trustedClientIp — chave do rate limit de login', () => {
  it('hops=0 (local): usa o IP da conexão e ignora X-Forwarded-For', () => {
    expect(trustedClientIp('9.9.9.9', '10.0.0.5', 0)).toBe('10.0.0.5')
  })

  it('Cloud Run direto (hops=1): IP real = última entrada, acrescentada pelo front-end do Google', () => {
    expect(trustedClientIp('177.10.20.30', '169.254.1.1', 1)).toBe('177.10.20.30')
  })

  it('spoof: valores enviados pelo cliente ficam à esquerda e são ignorados', () => {
    expect(trustedClientIp('1.1.1.1, 2.2.2.2, 177.10.20.30', '169.254.1.1', 1)).toBe('177.10.20.30')
  })

  it('usuários diferentes atrás do mesmo proxy recebem chaves diferentes (sem bloqueio global)', () => {
    const a = trustedClientIp('177.10.20.30', '169.254.1.1', 1)
    const b = trustedClientIp('189.40.50.60', '169.254.1.1', 1)
    expect(a).not.toBe(b)
  })

  it('LB + Cloud Run (hops=2): pega a entrada que o primeiro proxy confiável viu', () => {
    expect(trustedClientIp('1.1.1.1, 177.10.20.30, 35.191.0.1', '169.254.1.1', 2)).toBe('177.10.20.30')
  })

  it('cadeia menor que hops (header ausente): cai no IP da conexão, nunca em valor do cliente', () => {
    expect(trustedClientIp(undefined, '169.254.1.1', 1)).toBe('169.254.1.1')
    expect(trustedClientIp('177.10.20.30', '169.254.1.1', 2)).toBe('169.254.1.1')
  })
})
