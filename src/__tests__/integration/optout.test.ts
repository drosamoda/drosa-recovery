import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import app from '../../index'

vi.mock('../../services/customerService', () => ({
  customerService: {
    applyOptOutByPhone: vi.fn().mockResolvedValue(undefined),
    upsertCustomer: vi.fn(),
    findByPhoneOrEmail: vi.fn(),
    isOptOut: vi.fn().mockResolvedValue(false),
  },
}))

const ADMIN_SECRET = process.env.ADMIN_SECRET!

describe('POST /customers/opt-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aplica opt-out para telefone válido', async () => {
    const { customerService } = await import('../../services/customerService')

    const res = await request(app)
      .post('/customers/opt-out')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ phone: '31998021418' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, normalizedPhone: '5531998021418' })
    expect(customerService.applyOptOutByPhone).toHaveBeenCalledWith('5531998021418')
  })

  it('retorna 400 para telefone inválido', async () => {
    const res = await request(app)
      .post('/customers/opt-out')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({ phone: '123' })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: 'Telefone inválido' })
  })

  it('retorna 400 sem campo phone', async () => {
    const res = await request(app)
      .post('/customers/opt-out')
      .set('x-admin-secret', ADMIN_SECRET)
      .send({})

    expect(res.status).toBe(400)
  })

  it('retorna 401 sem admin secret', async () => {
    const res = await request(app)
      .post('/customers/opt-out')
      .send({ phone: '31998021418' })

    expect(res.status).toBe(401)
  })

  it('retorna 401 com admin secret errado', async () => {
    const res = await request(app)
      .post('/customers/opt-out')
      .set('x-admin-secret', 'senha-errada')
      .send({ phone: '31998021418' })

    expect(res.status).toBe(401)
  })
})
