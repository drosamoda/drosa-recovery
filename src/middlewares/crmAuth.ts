import { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import { readCookie, SESSION_COOKIE, verifySessionToken } from '../services/centralSession'

// Duas formas de acesso a /crm-api, em paralelo durante a migração:
// 1. x-crm-read-secret (legado, inalterado — continua sendo o rollback);
// 2. cookie de sessão da Central, SOMENTE com CENTRAL_SESSION_ENABLED=true.
// Com a flag desligada (padrão), o comportamento é idêntico ao anterior.
export function crmAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') {
    next()
    return
  }

  const providedSecret = req.headers['x-crm-read-secret']
  if (env.CRM_READ_SECRET && providedSecret && providedSecret === env.CRM_READ_SECRET) {
    next()
    return
  }

  if (env.CENTRAL_SESSION_ENABLED && verifySessionToken(readCookie(req.headers.cookie, SESSION_COOKIE))) {
    next()
    return
  }

  res.status(401).json({ error: 'Nao autorizado' })
}
