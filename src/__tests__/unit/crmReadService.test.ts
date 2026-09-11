import { describe, expect, it } from 'vitest'
import { maskEmail, maskPhone, normalizeFailure, parsePage, parsePageSize } from '../../services/crmReadService'

describe('crmReadService read-only helpers', () => {
  it('limits server pagination and rejects invalid page values', () => {
    expect(parsePage('3')).toBe(3)
    expect(parsePage('0')).toBe(1)
    expect(parsePageSize('50')).toBe(50)
    expect(parsePageSize('10000')).toBe(100)
    expect(parsePageSize('invalid')).toBe(25)
  })

  it('masks customer PII before returning it to the browser', () => {
    expect(maskPhone('+55 (31) 99846-2802')).toBe('55*****02')
    expect(maskPhone('12')).toBe('***')
    expect(maskEmail('cliente@exemplo.com')).toBe('c***@exemplo.com')
    expect(maskEmail('invalid')).toBeNull()
  })

  it.each([
    ['delivery_unknown', null, 'unknown', 'DELIVERY_UNKNOWN'],
    ['template_contract_mismatch', null, 'failed', 'TEMPLATE_CONFIGURATION'],
    ['consent_missing', null, 'failed', 'CONSENT_BLOCK'],
    ['opt_out', null, 'failed', 'SUPPRESSION_BLOCK'],
    ['network timeout', null, 'failed', 'NETWORK_TRANSIENT'],
    ['provider rejected', '131000', 'failed', 'PROVIDER_REJECTION'],
  ])('normalizes operational failures without exposing provider payloads', (reason, code, status, expected) => {
    expect(normalizeFailure(reason, code, status)).toBe(expected)
  })
})
