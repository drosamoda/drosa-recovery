import { Router, Request, Response } from 'express'
import { normalizePhoneBrazil } from '../helpers/phoneService'
import { customerService } from '../services/customerService'
import { adminAuth } from '../middlewares/adminAuth'

const router = Router()
router.use(adminAuth)

// POST /customers/opt-out
router.post('/opt-out', async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string }

  if (!phone) {
    res.status(400).json({ error: 'Campo "phone" é obrigatório' })
    return
  }

  const normalizedPhone = normalizePhoneBrazil(phone)
  if (!normalizedPhone) {
    res.status(400).json({ error: 'Telefone inválido' })
    return
  }

  await customerService.applyOptOutByPhone(normalizedPhone)

  res.json({ success: true, normalizedPhone })
})

// GET /customers — stub para listagem futura
router.get('/', (_req: Request, res: Response) => {
  res.status(501).json({ error: 'customers.list não implementado nesta etapa' })
})

export default router
