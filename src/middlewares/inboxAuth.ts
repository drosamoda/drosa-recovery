import { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'

export function inboxAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') {
    next()
    return
  }

  const expectedSecret = env.INBOX_ADMIN_SECRET || env.ADMIN_SECRET
  const providedSecret = req.headers['x-inbox-admin-secret'] ?? req.headers['x-admin-secret']

  if (!providedSecret || providedSecret !== expectedSecret) {
    res.status(401).json({ error: 'Nao autorizado' })
    return
  }

  next()
}
