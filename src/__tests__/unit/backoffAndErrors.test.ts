import { describe, it, expect } from 'vitest'

// -----------------------------------------------------------------------
// Backoff exponencial (lógica replicada para teste puro, sem I/O)
// -----------------------------------------------------------------------
function calcNextRetryAt(retryCount: number, baseDelayMs: number): Date {
  const delay = baseDelayMs * Math.pow(2, retryCount - 1)
  return new Date(Date.now() + delay)
}

describe('backoff exponencial', () => {
  const BASE = 1000 // 1s

  it('tentativa 1 → delay ~1s', () => {
    const before = Date.now()
    const next = calcNextRetryAt(1, BASE)
    expect(next.getTime() - before).toBeGreaterThanOrEqual(BASE - 10)
    expect(next.getTime() - before).toBeLessThanOrEqual(BASE + 50)
  })

  it('tentativa 2 → delay ~2s', () => {
    const before = Date.now()
    const next = calcNextRetryAt(2, BASE)
    expect(next.getTime() - before).toBeGreaterThanOrEqual(2 * BASE - 10)
  })

  it('tentativa 3 → delay ~4s', () => {
    const before = Date.now()
    const next = calcNextRetryAt(3, BASE)
    expect(next.getTime() - before).toBeGreaterThanOrEqual(4 * BASE - 10)
  })

  it('delay cresce exponencialmente', () => {
    const d1 = calcNextRetryAt(1, BASE).getTime() - Date.now()
    const d2 = calcNextRetryAt(2, BASE).getTime() - Date.now()
    const d3 = calcNextRetryAt(3, BASE).getTime() - Date.now()
    expect(d2).toBeGreaterThan(d1)
    expect(d3).toBeGreaterThan(d2)
  })
})

// -----------------------------------------------------------------------
// Classificação de erros da Meta (lógica replicada para teste puro)
// -----------------------------------------------------------------------
const TEMPORARY_CODES = new Set([131056, 130429])
const PERMANENT_CODES = new Set([132000, 132001, 131030, 100])
const TEMPORARY_HTTP = new Set([429, 500, 502, 503, 504])

function classifyMetaError(
  errorCode?: number,
  httpStatus?: number
): 'temporary' | 'permanent' {
  if (errorCode) {
    if (TEMPORARY_CODES.has(errorCode)) return 'temporary'
    if (PERMANENT_CODES.has(errorCode)) return 'permanent'
  }
  if (httpStatus) {
    if (TEMPORARY_HTTP.has(httpStatus)) return 'temporary'
    return 'permanent'
  }
  return 'temporary'
}

describe('classificação de erros Meta', () => {
  it('error_code 131056 é temporário', () => {
    expect(classifyMetaError(131056)).toBe('temporary')
  })

  it('error_code 130429 é temporário (rate limit)', () => {
    expect(classifyMetaError(130429)).toBe('temporary')
  })

  it('error_code 132000 é permanente', () => {
    expect(classifyMetaError(132000)).toBe('permanent')
  })

  it('error_code 132001 é permanente', () => {
    expect(classifyMetaError(132001)).toBe('permanent')
  })

  it('error_code 131030 é permanente', () => {
    expect(classifyMetaError(131030)).toBe('permanent')
  })

  it('error_code 100 é permanente (número inválido)', () => {
    expect(classifyMetaError(100)).toBe('permanent')
  })

  it('HTTP 429 é temporário', () => {
    expect(classifyMetaError(undefined, 429)).toBe('temporary')
  })

  it('HTTP 500 é temporário', () => {
    expect(classifyMetaError(undefined, 500)).toBe('temporary')
  })

  it('HTTP 503 é temporário', () => {
    expect(classifyMetaError(undefined, 503)).toBe('temporary')
  })

  it('HTTP 400 é permanente', () => {
    expect(classifyMetaError(undefined, 400)).toBe('permanent')
  })

  it('sem código nem status é temporário (default seguro)', () => {
    expect(classifyMetaError(undefined, undefined)).toBe('temporary')
  })
})
