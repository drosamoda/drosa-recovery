import { PrismaClient } from '@prisma/client'
import { runtimeDatabaseUrl } from './databaseUrl'
import { env } from './env'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const runtimeUrl = runtimeDatabaseUrl(process.env.DATABASE_URL)

// Em CRM_PREVIEW_READONLY, o role dedicado do Postgres tem um teto de conex?es baixo e
// compartilhado entre inst?ncias serverless. Ajuste o pool sem desfazer a transforma??o
// can?nica do runtimeDatabaseUrl (Supabase transaction pooler).
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

const datasourceUrl = env.CRM_PREVIEW_READONLY ? tunedPreviewUrl(runtimeUrl) : runtimeUrl

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
