import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import { swaggerSpec } from '../config/swagger'

const router = Router()

router.use('/', swaggerUi.serve)
router.get('/', swaggerUi.setup(swaggerSpec, { customSiteTitle: "D'Rosa Recovery API" }))

export default router
