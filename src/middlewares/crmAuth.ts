import { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'

export function crmAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') {
    next()
    return
  }

  const providedSecret = req.headers['x-crm-read-secret']
  if (!env.CRM_READ_SECRET || !providedSecret || providedSecret !== env.CRM_READ_SECRET) {
    res.status(401).json({ error: 'Nao autorizado' })
    return
  }

  next()
}
