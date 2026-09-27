import { getStoredSecret, clearStoredSecret } from './auth'
import { AUTH_LOST_EVENT } from './session'

export class ApiError extends Error {
  status: number
  // Codigo de erro do backend quando ele envia um (ex.: AI_DATABASE_NOT_CONFIGURED).
  code: string | null
  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function readErrorBody(response: Response): Promise<{ error?: string; code?: string } | null> {
  try {
    const body: unknown = await response.json()
    return body && typeof body === 'object' ? (body as { error?: string; code?: string }) : null
  } catch {
    return null
  }
}

// Duas credenciais aceitas pelo backend em paralelo: header legado
// x-crm-read-secret (so quando o usuario informou o segredo) ou o cookie
// httpOnly da sessao da Central (enviado automaticamente, same-origin).
// Somente GET — o frontend novo nao chama nenhuma rota de escrita de dados.
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const secret = getStoredSecret()
  const response = await fetch(`/crm-api/${path}`, {
    headers: secret ? { 'x-crm-read-secret': secret } : {},
    credentials: 'same-origin',
    signal,
  })
  if (response.status === 401) {
    clearStoredSecret()
    window.dispatchEvent(new Event(AUTH_LOST_EVENT))
    throw new ApiError('Segredo de leitura invalido ou ausente.', 401)
  }
  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new ApiError(body?.error ?? `Falha ao carregar dados (HTTP ${response.status}).`, response.status, body?.code ?? null)
  }
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('Resposta invalida do servidor.', response.status)
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}
