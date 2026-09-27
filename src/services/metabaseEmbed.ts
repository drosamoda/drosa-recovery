import { createHmac } from 'crypto'
import { env } from '../config/env'

// Signed embedding do Metabase (mesmo mecanismo do app BI, lib/metabase.ts),
// agora dentro do backend da Central. Regras:
// - o browser NUNCA escolhe um dashboard ID: só um módulo desta allowlist;
// - METABASE_SECRET_KEY nunca sai do servidor (só a URL assinada, que expira);
// - IDs vêm do mapeamento já aprovado no audit de consolidação (26/09).
export const METABASE_MODULES = {
  recovery: 6,
  messages: 3,
  consents: 5,
  orders: 7,
  integrations: 8,
} as const

export type MetabaseModule = keyof typeof METABASE_MODULES | 'executive'

export class MetabaseNotConfiguredError extends Error {
  code = 'METABASE_NOT_CONFIGURED'
}

export function isMetabaseModule(value: string): value is MetabaseModule {
  return value === 'executive' || Object.prototype.hasOwnProperty.call(METABASE_MODULES, value)
}

function dashboardId(module: MetabaseModule): number | null {
  if (module === 'executive') {
    const id = Number(env.METABASE_EXECUTIVE_DASHBOARD_ID)
    return Number.isInteger(id) && id > 0 ? id : null
  }
  return METABASE_MODULES[module]
}

export function isMetabaseConfigured(): boolean {
  return Boolean(env.METABASE_SITE_URL && env.METABASE_SECRET_KEY)
}

const b64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url')

// JWT HS256 — o mesmo formato que jsonwebtoken.sign produz no app BI.
export function signMetabaseToken(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export function buildEmbedUrl(module: MetabaseModule, ttlSeconds = 600, now = Date.now()): { url: string; expiresAt: string } {
  const id = dashboardId(module)
  if (!isMetabaseConfigured() || id === null) throw new MetabaseNotConfiguredError('Metabase não configurado para este módulo.')
  const exp = Math.round(now / 1000) + ttlSeconds
  const token = signMetabaseToken({ resource: { dashboard: id }, params: {}, exp }, env.METABASE_SECRET_KEY)
  return {
    url: `${env.METABASE_SITE_URL.replace(/\/$/, '')}/embed/dashboard/${token}#bordered=false&titled=false`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

// Metabase roda em Cloud Run com scale-to-zero: o primeiro acesso pode estar
// frio. Esta checagem é só leitura (/api/health), com timeout curto.
export async function metabaseStatus(timeoutMs = 4000): Promise<{ configured: boolean; reachable: boolean | null; latencyMs: number | null }> {
  if (!env.METABASE_SITE_URL) return { configured: false, reachable: null, latencyMs: null }
  const started = Date.now()
  try {
    const res = await fetch(`${env.METABASE_SITE_URL.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    return { configured: isMetabaseConfigured(), reachable: res.ok, latencyMs: Date.now() - started }
  } catch {
    return { configured: isMetabaseConfigured(), reachable: false, latencyMs: null }
  }
}
