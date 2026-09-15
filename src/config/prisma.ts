import { PrismaClient } from '@prisma/client'
import { env } from './env'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

// Em CRM_PREVIEW_READONLY, o role dedicado do Postgres tem um teto de conexões baixo e
// compartilhado entre todas as instâncias serverless da Vercel simultaneamente ativas. Cada
// instância abre seu próprio pool Prisma, então um connection_limit alto por instância (ex.: 5)
// somado a poucas instâncias concorrentes já estoura esse teto ("too many connections for role").
// Forçar um valor baixo aqui — no código, não só na env var — garante a proteção mesmo que a
// connection string configurada na Vercel não tenha sido ajustada.
function tunedPreviewUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw
  try {
    const url = new URL(raw)
    url.searchParams.set('connection_limit', '2')
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '30')
    return url.toString()
  } catch {
    return raw
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    ...(env.CRM_PREVIEW_READONLY
      ? { datasources: { db: { url: tunedPreviewUrl(process.env.DATABASE_URL) } } }
      : {}),
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
