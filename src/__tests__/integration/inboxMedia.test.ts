import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import app from '../../index'

vi.mock('../../config/prisma', () => ({
  prisma: {
    chatMessage: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'message-1',
        type: 'image',
        rawPayload: {
          image: {
            caption: 'Sem id',
          },
        },
      }),
    },
  },
}))

describe('GET /inbox/messages/:messageId/media', () => {
  it('retorna erro claro quando a mensagem image nao tem media id', async () => {
    const res = await request(app)
      .get('/inbox/messages/message-1/media')
      .set('x-inbox-admin-secret', 'test_inbox_secret')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      error: 'Media id nao encontrado para esta mensagem',
    })
  })
})
