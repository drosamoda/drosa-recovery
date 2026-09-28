import { createHmac } from 'crypto'
import { env } from '../config/env'

// Signed embedding do Metabase (mesmo mecanismo do app BI, lib/metabase.ts),
// agora dentro do backend da Central. Regras:
// - o browser NUNCA escolhe um dashboard ID: só um módulo desta allowlist;
// - METABASE_SECRET_KEY nunca sai do servidor (só a URL assinada, que expira);
// - IDs conferidos em 28/09 na tabela report_dashboard do app DB do Metabase
//   (leitura). Em 28/09 só o 2 tinha enable_embedding=true; 3/5/6/7/8 precisam
//   ser habilitados no admin do Metabase para o embed funcionar.
export const METABASE_MODULES = {
  executive: 2,
  recovery: 6,
  messages: 3,
  consents: 5,
  orders: 7,
  integrations: 8,
} as const

export type MetabaseModule = keyof typeof METABASE_MODULES

// Auditoria semântica (28/09, docs/handoff/METABASE_SEMANTIC_AUDIT_2026-09-28.md):
// só dashboards com TODOS os cards KEEP podem ser embutidos na Central. Os
// demais têm KPIs inválidos (ex.: failure rate sobre total com skipped,
// "enviadas", funil com purchased_after_contact, "faturamento" com pedidos não
// pagos) e ficam bloqueados aqui até os cards serem corrigidos no Metabase.
export const METABASE_SEMANTICALLY_APPROVED: ReadonlySet<MetabaseModule> = new Set<MetabaseModule>(['integrations'])

export class MetabaseSemanticReviewPendingError extends Error {
  code = 'METABASE_SEMANTIC_REVIEW_PENDING'
}

export class MetabaseNotConfiguredError extends Error {
  code = 'METABASE_NOT_CONFIGURED'
}

export function isMetabaseModule(value: string): value is MetabaseModule {
  return Object.prototype.hasOwnProperty.call(METABASE_MODULES, value)
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
  const id = METABASE_MODULES[module]
  if (!METABASE_SEMANTICALLY_APPROVED.has(module)) throw new MetabaseSemanticReviewPendingError('Painel em revisão semântica.')
  if (!isMetabaseConfigured()) throw new MetabaseNotConfiguredError('Metabase não configurado para este módulo.')
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
