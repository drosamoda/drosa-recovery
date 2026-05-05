import { describe, expect, it, vi, beforeEach } from 'vitest'
import request from 'supertest'
import axios from 'axios'
import app from '../../index'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}))

vi.mock('../../config/prisma', () => ({
  prisma: {
    chatMessage: {
      findUnique: vi.fn(),
    },
  },
}))

describe('GET /inbox/messages/:messageId/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retorna erro claro quando a mensagem image nao tem media id', async () => {
    const prisma = await import('../../config/prisma')
    vi.mocked(prisma.prisma.chatMessage.findUnique).mockResolvedValue({
      id: 'message-1',
      type: 'image',
      rawPayload: {
        image: {
          caption: 'Sem id',
        },
      },
    } as never)

    const res = await request(app)
      .get('/inbox/messages/message-1/media')
      .set('x-inbox-admin-secret', 'test_inbox_secret')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      error: 'Media id nao encontrado para esta mensagem',
    })
  })

  it('baixa midia de sticker usando o id em rawPayload.sticker.id', async () => {
    const prisma = await import('../../config/prisma')
    vi.mocked(prisma.prisma.chatMessage.findUnique).mockResolvedValue({
      id: 'message-2',
      type: 'sticker',
      rawPayload: {
        sticker: {
          id: 'media-sticker-1',
          mime_type: 'image/webp',
          sha256: 'hash-sticker-1',
          animated: false,
        },
      },
    } as never)

    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          url: 'https://graph.facebook.com/media/sticker-1',
          mime_type: 'image/webp',
        },
      } as never)
      .mockResolvedValueOnce({
        data: Buffer.from([1, 2, 3]),
        headers: {
          'content-type': 'image/webp',
        },
      } as never)

    const res = await request(app)
      .get('/inbox/messages/message-2/media')
      .set('x-inbox-admin-secret', 'test_inbox_secret')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/webp')
    expect(res.body).toBeInstanceOf(Buffer)
    expect(axios.get).toHaveBeenCalledTimes(2)
  })
})
