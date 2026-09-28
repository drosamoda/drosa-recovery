import { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import { logger } from '../config/logger'

// Modo preview: os módulos operacionais NÃO tocam banco. /crm-api/* (exceto
// /crm-api/bi, lido localmente pelo reader das views bi_*) é encaminhado,
// server-side, para a API oficial /crm-api de produção — que já é read-only
// para GET. Regras:
// - só GET/HEAD; qualquer outro método => 405 (nem chega ao upstream);
// - allowlist explícita de rotas; não é proxy genérico de URL (o host é fixo);
// - o x-crm-read-secret do upstream é injetado aqui e nunca vai ao browser;
// - nenhum header/cookie do cliente é repassado;
// - timeout; 401/403 do upstream viram 502 (é erro de configuração do preview,
//   não do usuário — senão o front apagaria a sessão do usuário);
// - log só com rota normalizada e status (sem query: busca pode conter PII).
const ALLOWED: RegExp[] = [
  /^\/(dashboard|messages|customers|journey|conversations|checkouts|remarketing|automations|templates|consents|health|audit)$/,
  /^\/(messages|customers|journey|conversations)\/[^/]+$/,
  /^\/payments\/(pix|boleto)$/,
  /^\/ai\/(opportunities|campaigns|learning)$/,
  /^\/ai\/campaigns\/[^/]+$/,
  /^\/email\/(audiences|campaign-library|recommendations)$/,
]

const TIMEOUT_MS = 25_000

export function isUpstreamMode(): boolean {
  return Boolean(env.CRM_UPSTREAM_URL && env.CRM_UPSTREAM_READ_SECRET)
}

export function isAllowedUpstreamPath(path: string): boolean {
  return ALLOWED.some((re) => re.test(path))
}

function routeLabel(path: string): string {
  return path.replace(/^\/(messages|customers|journey|conversations|ai\/campaigns)\/[^/]+$/, '/$1/:id')
}

export async function crmUpstreamProxy(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    res.status(405).json({ error: 'Método não permitido no preview (somente leitura).' })
    return
  }
  // /crm-api/bi é servido localmente (views bi_* via reader dedicado).
  if (req.path === '/bi' || req.path.startsWith('/bi/')) return next()
  if (!isAllowedUpstreamPath(req.path)) {
    res.status(404).json({ error: 'Rota não encontrada' })
    return
  }

  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
  const target = `${env.CRM_UPSTREAM_URL.replace(/\/$/, '')}/crm-api${req.path}${query}`
  const started = Date.now()
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'x-crm-read-secret': env.CRM_UPSTREAM_READ_SECRET, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    })
    const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status >= 500 && upstream.status !== 503 ? 502 : upstream.status
    logger.info('[crm-upstream]', { route: routeLabel(req.path), status: upstream.status, ms: Date.now() - started })
    res.status(status)
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const body = await upstream.text()
    const isJson = (upstream.headers.get('content-type') ?? '').includes('application/json')
    if (status === 502 && upstream.status !== 502) {
      res.json({ error: 'Falha ao consultar a API oficial.', code: 'UPSTREAM_ERROR' })
      return
    }
    res.type(isJson ? 'application/json' : 'text/plain').send(body)
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError'
    logger.warn('[crm-upstream] falha', { route: routeLabel(req.path), reason: timeout ? 'timeout' : 'network', ms: Date.now() - started })
    res.status(timeout ? 504 : 502).json({ error: 'Falha ao consultar a API oficial.', code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR' })
  }
}
