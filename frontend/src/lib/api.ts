import { getStoredSecret, clearStoredSecret } from './auth'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Mesmo contrato HTTP do app.js atual: header x-crm-read-secret em toda
// chamada a /crm-api/*. Nenhuma mudanca de backend nesta rodada.
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const secret = getStoredSecret()
  const response = await fetch(`/crm-api/${path}`, {
    headers: { 'x-crm-read-secret': secret },
    signal,
  })
  if (response.status === 401) {
    clearStoredSecret()
    throw new ApiError('Segredo de leitura invalido ou ausente.', 401)
  }
  if (!response.ok) {
    throw new ApiError(`Falha ao carregar dados (HTTP ${response.status}).`, response.status)
  }
  return (await response.json()) as T
}
