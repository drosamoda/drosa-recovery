import { describe, expect, it } from 'vitest'
import { runtimeDatabaseUrl } from '../../config/databaseUrl'

describe('runtimeDatabaseUrl', () => {
  it('moves a Supabase session pooler URL to transaction mode for Prisma runtime', () => {
    const input = 'postgresql://user:pass@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require'
    expect(runtimeDatabaseUrl(input)).toBe(
      'postgresql://user:pass@aws-1-us-west-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1',
    )
  })

  it('preserves explicit Prisma pool parameters without duplicating them', () => {
    const input = 'postgresql://user:pass@aws-1-us-west-2.pooler.supabase.com:5432/postgres?pgbouncer=false&connection_limit=2'
    expect(runtimeDatabaseUrl(input)).toBe(
      'postgresql://user:pass@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=false&connection_limit=2',
    )
  })

  it('leaves non-Supabase and already-transaction URLs unchanged', () => {
    expect(runtimeDatabaseUrl('postgresql://localhost:5432/postgres')).toBe('postgresql://localhost:5432/postgres')
    expect(runtimeDatabaseUrl('postgresql://user:pass@aws-1-us-west-2.pooler.supabase.com:6543/postgres')).toBe(
      'postgresql://user:pass@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
    )
  })

  it('does not invent a URL when DATABASE_URL is absent', () => {
    expect(runtimeDatabaseUrl(undefined)).toBeUndefined()
  })
})
