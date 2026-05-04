import { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow CORS preflight through without auth
  if (req.method === 'OPTIONS') {
    next()
    return
  }
  const secret = req.headers['x-admin-secret']
  if (!secret || secret !== env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Não autorizado' })
    return
  }
  next()
}
