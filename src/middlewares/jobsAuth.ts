import { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'
import { isAllowedOidcIdentity, verifyGoogleIdToken } from '../services/jobsOidc'

function deny(res: Response): void {
  res.status(401).json({ error: 'Não autorizado' })
}

// /jobs aceita duas credenciais, em paralelo:
// 1. x-jobs-secret (manual, smoke, emergência; compatibilidade);
// 2. ID token OIDC do Cloud Scheduler (Authorization: Bearer), verificado por
//    assinatura + issuer + audience + service account permitida.
// Header x-jobs-secret presente e inválido nunca cai para o OIDC. Nada é logado
// do token nem do segredo.
export async function jobsAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secret = req.headers['x-jobs-secret']
  if (secret !== undefined) {
    if (secret === env.JOBS_SECRET && env.JOBS_SECRET) return next()
    return deny(res)
  }

  const authorization = req.headers.authorization
  const match = typeof authorization === 'string' ? /^Bearer (\S+)$/.exec(authorization) : null
  if (!match || !env.JOBS_OIDC_AUDIENCE || env.JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS.length === 0) return deny(res)

  try {
    const claims = await verifyGoogleIdToken(match[1], env.JOBS_OIDC_AUDIENCE)
    const allowed = isAllowedOidcIdentity(claims, { audience: env.JOBS_OIDC_AUDIENCE, allowedServiceAccounts: env.JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS })
    if (allowed) return next()
  } catch {
    // token malformado/expirado/assinatura inválida: 401 sem detalhe e sem logar o token
  }
  deny(res)
}
