import { describe, expect, it } from 'vitest'
import { buildConversationSearch, buildCustomerSearch, buildDashboardFilters, buildMessageSearch, buildMessageTimeline, extractMetaStatusTimestamp, maskEmail, maskPhone, normalizeFailure, parsePage, parsePageSize, phoneSearchTerm, summarizeInbound } from '../../services/crmReadService'

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

  it.each([
    ['customers', buildCustomerSearch],
    ['conversations', buildConversationSearch],
    ['messages', buildMessageSearch],
  ])('does not add an empty phone predicate to %s text searches', (_name, builder) => {
    const maria = JSON.stringify(builder('Maria'))
    const email = JSON.stringify(builder('cliente@example.com'))
    const phone = JSON.stringify(builder('31998'))

    expect(maria).not.toContain('normalizedPhone')
    expect(maria).not.toContain('"phone"')
    expect(email).not.toContain('normalizedPhone')
    expect(email).not.toContain('"phone"')
    expect(phone).toContain('31998')
    expect(builder('')).toEqual({})
  })

  it.each([
    ['Maria', null],
    ['cliente@example.com', null],
    ['31998', '31998'],
    ['', null],
    ['12', null],
  ])('only creates a useful phone search for %j', (search, expected) => {
    expect(phoneSearchTerm(search)).toBe(expected)
  })

  it('does not infer delivery or read timestamps from updatedAt', () => {
    const updatedAt = new Date('2026-09-11T12:00:00Z')
    const delivered = buildMessageTimeline({ status: 'delivered', createdAt: new Date('2026-09-10T12:00:00Z'), scheduledAt: new Date('2026-09-10T13:00:00Z'), acceptedAt: null, sentAt: null, updatedAt })
    const read = buildMessageTimeline({ status: 'read', createdAt: new Date('2026-09-10T12:00:00Z'), scheduledAt: new Date('2026-09-10T13:00:00Z'), acceptedAt: null, sentAt: null, updatedAt })

    expect(delivered).not.toContainEqual({ stage: 'delivered', at: updatedAt })
    expect(read).not.toContainEqual({ stage: 'read', at: updatedAt })
  })

  it('uses only the persisted Meta status timestamp as delivery evidence', () => {
    expect(extractMetaStatusTimestamp({ status: 'delivered', timestamp: '1789128000' }, 'delivered')).toEqual(new Date(1789128000 * 1000))
    expect(extractMetaStatusTimestamp({ status: 'read', timestamp: '1789128060' }, 'delivered')).toBeNull()
    expect(extractMetaStatusTimestamp({ status: 'read' }, 'read')).toBeNull()
  })

  it('uses business timestamps for each dashboard metric', () => {
    const period = { gte: new Date('2026-09-11T00:00:00Z'), lte: new Date('2026-09-11T23:59:59Z') }
    const filters = buildDashboardFilters(period)

    expect(filters.messagesCreated).toEqual({ createdAt: period })
    expect(filters.messagesSent).toEqual({ sentAt: period })
    expect(filters.orders).toEqual({ sourceCreatedAt: period })
    expect(filters.abandoned).toEqual({ abandonedAt: period })
    expect(filters.converted).toEqual({ convertedAt: period })
    expect(filters.inbound).toEqual({ direction: 'inbound', OR: [{ timestamp: period }, { timestamp: null, createdAt: period }] })
  })

  it('distinguishes inbound messages from distinct conversations', () => {
    expect(summarizeInbound(5, [{ conversationId: 'a' }, { conversationId: 'b' }])).toEqual({ inboundMessages: 5, inboundConversations: 2 })
  })
})
