import { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'

export function jobsAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-jobs-secret']
  if (!secret || secret !== env.JOBS_SECRET) {
    res.status(401).json({ error: 'Não autorizado' })
    return
  }
  next()
}
