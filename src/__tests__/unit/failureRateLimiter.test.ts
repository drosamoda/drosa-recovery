import { describe, expect, it } from 'vitest'
import { createFailureRateLimiter } from '../../helpers/failureRateLimiter'

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

describe('createFailureRateLimiter', () => {
  it('permite até maxFailures falhas e limita a seguinte', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 3, windowMs: 60_000, now: c.now })

    expect(limiter.hit('ip-a').limited).toBe(false)
    expect(limiter.hit('ip-a').limited).toBe(false)
    expect(limiter.hit('ip-a').limited).toBe(false)
    expect(limiter.hit('ip-a').limited).toBe(true)
    expect(limiter.hit('ip-a').limited).toBe(true)
  })

  it('chaves são independentes: um IP abusivo não limita outro', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 1, windowMs: 60_000, now: c.now })

    limiter.hit('ip-a')
    expect(limiter.hit('ip-a').limited).toBe(true)
    expect(limiter.hit('ip-b').limited).toBe(false)
  })

  it('a janela expira e o contador recomeça', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 1, windowMs: 60_000, now: c.now })

    limiter.hit('ip-a')
    expect(limiter.hit('ip-a').limited).toBe(true)
    c.advance(60_000)
    expect(limiter.hit('ip-a').limited).toBe(false)
  })

  it('a janela é fixa a partir da primeira falha (falhas seguintes não a estendem)', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 1, windowMs: 60_000, now: c.now })

    limiter.hit('ip-a') // abre a janela em t0
    c.advance(59_000)
    limiter.hit('ip-a') // limitado, mas NÃO renova a janela
    c.advance(1_000) // t0 + 60s
    expect(limiter.hit('ip-a').limited).toBe(false)
  })

  it('retryAfterSeconds reflete o tempo que falta, com mínimo de 1', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 0, windowMs: 60_000, now: c.now })

    expect(limiter.hit('ip-a')).toEqual({ limited: true, retryAfterSeconds: 60 })
    c.advance(45_500)
    expect(limiter.hit('ip-a').retryAfterSeconds).toBe(15)
    c.advance(14_499)
    expect(limiter.hit('ip-a').retryAfterSeconds).toBe(1)
  })

  it('memória limitada: com muitas chaves ativas descarta as mais antigas, nunca passa de maxKeys', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 1, windowMs: 60_000, maxKeys: 3, now: c.now })

    for (const key of ['a', 'b', 'c']) limiter.hit(key)
    limiter.hit('a') // 'a' fica limitada
    limiter.hit('d') // cheio: descarta a mais antiga ('a')

    // 'a' foi descartada, então volta ao começo em vez de continuar limitada.
    expect(limiter.hit('a').limited).toBe(false)
    // 'c' (não descartada) segue com a falha registrada: a próxima já limita.
    expect(limiter.hit('c').limited).toBe(true)
  })

  it('primeiro descarta as expiradas antes de sacrificar chaves ativas', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 1, windowMs: 60_000, maxKeys: 2, now: c.now })

    limiter.hit('velha')
    c.advance(30_000)
    limiter.hit('ativa')
    c.advance(30_000) // 'velha' expirou, 'ativa' ainda vale
    limiter.hit('nova') // cheio: só a expirada deve sair

    expect(limiter.hit('ativa').limited).toBe(true) // sobreviveu, mantém a falha
  })

  it('reset limpa tudo', () => {
    const c = clock()
    const limiter = createFailureRateLimiter({ maxFailures: 1, windowMs: 60_000, now: c.now })

    limiter.hit('x')
    expect(limiter.hit('x').limited).toBe(true)
    limiter.reset()
    expect(limiter.hit('x').limited).toBe(false)
  })
})
