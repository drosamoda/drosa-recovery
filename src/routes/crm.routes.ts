import { Request, Response, Router } from 'express'
import { crmReadService } from '../services/crmReadService'

const router = Router()
const query = (req: Request) => req.query as Record<string, unknown>
function found(res: Response, value: unknown) { return value ? res.json(value) : res.status(404).json({ error: 'Registro não encontrado' }) }

router.get('/dashboard', async (req, res) => res.json(await crmReadService.dashboard(String(req.query.period ?? 'today'), req.query.from ? String(req.query.from) : undefined, req.query.to ? String(req.query.to) : undefined)))
router.get('/messages', async (req, res) => res.json(await crmReadService.messages(query(req))))
router.get('/messages/:id', async (req, res) => found(res, await crmReadService.message(req.params.id)))
router.get('/customers', async (req, res) => res.json(await crmReadService.customers(query(req))))
router.get('/customers/:id', async (req, res) => found(res, await crmReadService.customer(req.params.id)))
router.get('/conversations', async (req, res) => res.json(await crmReadService.conversations(query(req))))
router.get('/conversations/:id', async (req, res) => found(res, await crmReadService.conversation(req.params.id)))
router.get('/checkouts', async (req, res) => res.json(await crmReadService.checkouts(query(req))))
router.get('/payments/pix', async (req, res) => res.json(await crmReadService.payments('pix', query(req))))
router.get('/payments/boleto', async (req, res) => res.json(await crmReadService.payments('boleto', query(req))))
router.get('/remarketing', async (req, res) => res.json(await crmReadService.remarketing(query(req))))
router.get('/automations', async (_req, res) => res.json(await crmReadService.automations()))
router.get('/templates', async (_req, res) => res.json(await crmReadService.templates()))
router.get('/consents', async (req, res) => res.json(await crmReadService.consents(query(req))))
router.get('/health', async (_req, res) => res.json(await crmReadService.health()))
router.get('/audit', async (req, res) => res.json(await crmReadService.audit(query(req))))

export default router

