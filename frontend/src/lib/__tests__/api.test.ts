import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiGet, ApiError } from '../api'
import * as auth from '../auth'

function mockFetchOnce(response: Partial<Response> & { json?: () => unknown }) {
  const fullResponse = {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (async () => ({})),
  } as Response
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fullResponse))
}

beforeEach(() => {
  vi.spyOn(auth, 'getStoredSecret').mockReturnValue('test-secret')
  vi.spyOn(auth, 'clearStoredSecret').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('apiGet', () => {
  it('retorna o payload em caso de sucesso', async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ total: 42 }) })
    const result = await apiGet<{ total: number }>('dashboard')
    expect(result).toEqual({ total: 42 })
  })

  it('envia o header x-crm-read-secret em toda chamada', async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({}) })
    await apiGet('dashboard')
    expect(fetch).toHaveBeenCalledWith(
      '/crm-api/dashboard',
      expect.objectContaining({ headers: { 'x-crm-read-secret': 'test-secret' } }),
    )
  })

  it('lanca ApiError 401 e limpa o segredo guardado quando o servidor rejeita', async () => {
    mockFetchOnce({ ok: false, status: 401 })
    await expect(apiGet('dashboard')).rejects.toMatchObject({ status: 401 } satisfies Partial<ApiError>)
    expect(auth.clearStoredSecret).toHaveBeenCalledOnce()
  })

  it('lanca ApiError para outros status de erro (403)', async () => {
    mockFetchOnce({ ok: false, status: 403 })
    await expect(apiGet('dashboard')).rejects.toBeInstanceOf(ApiError)
    await expect(apiGet('dashboard')).rejects.toMatchObject({ status: 403 })
  })

  it('lanca ApiError para erro de servidor (500)', async () => {
    mockFetchOnce({ ok: false, status: 500 })
    await expect(apiGet('dashboard')).rejects.toMatchObject({ status: 500, message: expect.stringContaining('500') })
  })

  it('propaga erro de rede (fetch rejeitado)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiGet('dashboard')).rejects.toThrow('Failed to fetch')
  })

  it('lanca ApiError quando o payload de sucesso nao e JSON valido', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await expect(apiGet('dashboard')).rejects.toMatchObject({ message: 'Resposta invalida do servidor.' })
  })
})
