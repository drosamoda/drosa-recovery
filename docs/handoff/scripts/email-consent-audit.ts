// SOMENTE LEITURA. Cada consulta roda em transação READ ONLY própria. Só imprime agregados (contagens / nomes de chaves).
// Uso: AUDIT_DB_URL=... AUDIT_QUERIES=<arquivo .sql com blocos "-- @rotulo"> ts-node consent-audit.ts
const { PrismaClient } = require('C:/Users/peter/OneDrive/Peter/particular/Documentos/desafio pai e filho/drosa-recovery-crm-ops/node_modules/@prisma/client')
const fs = require('fs')

function parse(text: string): Array<{ label: string; sql: string }> {
  const out: Array<{ label: string; sql: string }> = []
  let cur: { label: string; lines: string[] } | null = null
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^--\s*@(.+)$/)
    if (m) { if (cur) out.push({ label: cur.label, sql: cur.lines.join('\n').trim() }); cur = { label: m[1].trim(), lines: [] } }
    else if (cur) cur.lines.push(line)
  }
  if (cur) out.push({ label: cur.label, sql: cur.lines.join('\n').trim() })
  return out.filter(q => q.sql)
}

async function main() {
  const u = new URL(process.env.AUDIT_DB_URL as string)
  u.searchParams.set('connection_limit', '1'); u.searchParams.set('pool_timeout', '60')
  const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } })
  const queries = parse(fs.readFileSync(process.env.AUDIT_QUERIES as string, 'utf8'))
  for (const { label, sql } of queries) {
    try {
      const rows = await prisma.$transaction(async (tx: { $executeRawUnsafe: (s: string) => Promise<unknown>; $queryRawUnsafe: (s: string) => Promise<unknown[]> }) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
        return tx.$queryRawUnsafe(sql)
      }, { timeout: 120000, maxWait: 60000 })
      console.log(`## ${label}`)
      for (const r of rows as Array<Record<string, unknown>>) console.log('  ' + JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)))
      if (!(rows as unknown[]).length) console.log('  (0 linhas)')
    } catch (e) {
      console.log(`## ${label}\n  ERRO: ${(e as Error).message.trim().split('\n').slice(-1)[0].slice(0, 200)}`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e: Error) => { console.error('ERR', e.message.slice(0, 200)); process.exit(1) })
