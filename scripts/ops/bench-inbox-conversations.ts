// Read-only benchmark for P0 /inbox/conversations with a single-connection pool
// (same as production runtime). Prints only timings/counts — no PII.
//   npx tsx scripts/ops/bench-inbox-conversations.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now()
  try {
    const r = await fn()
    console.log(`${label.padEnd(44)} ${((Date.now() - t) / 1000).toFixed(2)}s`)
    return r
  } catch (e: unknown) {
    const code = (e as { code?: string }).code ?? 'error'
    console.log(`${label.padEnd(44)} ${((Date.now() - t) / 1000).toFixed(2)}s FAIL ${code}`)
    throw e
  }
}

async function main(): Promise<void> {
  const raw = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!raw) throw new Error('DIRECT_URL/DATABASE_URL missing')
  const url = new URL(raw)
  url.searchParams.set('connection_limit', '1')
  url.searchParams.set('pool_timeout', '10')
  const client = new PrismaClient({ datasources: { db: { url: url.toString() } } })
  ;(globalThis as unknown as { prisma: PrismaClient }).prisma = client
  const { inboxService } = await import('../../src/services/inboxService')

  const rows = await timed('listConversations (cold)', () => inboxService.listConversations())
  await timed('listConversations (warm)', () => inboxService.listConversations())
  console.log(`conversations=${rows.length} withOrder=${rows.filter((r) => r.lastOrder).length} unanswered>0=${rows.filter((r) => r.unansweredCount > 0).length}`)
  const t = Date.now()
  const health = client.$queryRaw`SELECT 1`.then(() => (Date.now() - t) / 1000)
  const [, healthSecs] = await timed('concurrent inbox + health SELECT 1', () => Promise.all([
    inboxService.listConversations(),
    health,
  ]))
  console.log(`health SELECT 1 waited ${healthSecs.toFixed(2)}s behind inbox`)
  await client.$disconnect()
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message.split('\n').filter(Boolean).slice(-1)[0] : 'error')
  process.exit(1)
})
