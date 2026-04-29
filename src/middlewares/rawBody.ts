import { Request, Response } from 'express'

// Augmenta o tipo Request para incluir rawBody
declare global {
  namespace Express {
    interface Request {
      rawBody?: string
    }
  }
}

// Função de verify para usar com express.json({ verify })
// Captura o rawBody antes do parse JSON, necessário para HMAC (Nuvemshop e Meta)
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf.toString('utf8')
}
