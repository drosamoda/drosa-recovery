import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import app from '../../index'

vi.mock('../../services/inboxService', () => ({
  inboxService: {
    saveSimulatedInboundMessage: vi.fn().mockResolvedValue({
      conversation: {
        id: 'conversation-1',
        status: 'open',
        contact: {
          id: 'contact-1',
          phone: '5583999999999',
          name: 'Cliente Teste',
        },
      },
      message: {
        id: 'message-1',
        direction: 'inbound',
        type: 'text',
        body: 'Oi, quero atendimento',
      },
    }),
    listConversations: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
    updateConversation: vi.fn(),
    sendManualTextMessage: vi.fn(),
  },
}))

describe('POST /inbox/dev/simulate-inbound', () => {
  beforeEach(() => {
    process.env.INBOX_ADMIN_SECRET = 'test_inbox_secret'
    vi.clearAllMocks()
  })

  it('simula mensagem inbound em ambiente nao-producao com segredo da inbox', async () => {
    const { inboxService } = await import('../../services/inboxService')

    const res = await request(app)
      .post('/inbox/dev/simulate-inbound')
      .set('x-inbox-admin-secret', 'test_inbox_secret')
      .send({
        phone: '5583999999999',
        name: 'Cliente Teste',
        text: 'Oi, quero atendimento',
      })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      success: true,
      data: {
        conversation: { id: 'conversation-1' },
        message: { id: 'message-1', body: 'Oi, quero atendimento' },
      },
    })
    expect(inboxService.saveSimulatedInboundMessage).toHaveBeenCalledWith({
      phone: '5583999999999',
      name: 'Cliente Teste',
      text: 'Oi, quero atendimento',
    })
  })

  it('bloqueia quando o header x-inbox-admin-secret esta ausente', async () => {
    const res = await request(app)
      .post('/inbox/dev/simulate-inbound')
      .send({
        phone: '5583999999999',
        text: 'Oi',
      })

    expect(res.status).toBe(401)
  })
})
