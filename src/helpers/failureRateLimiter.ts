// Limitador de FALHAS por chave (em memória, janela fixa). Conta só tentativas
// que deram errado — ex.: tokens inválidos numa rota pública — e nunca as que
// deram certo. Por que não limitar tudo por IP: clientes de e-mail (Gmail,
// Yahoo) fazem o One-Click a partir de um conjunto pequeno de IPs de servidor;
// um teto por IP sobre TODAS as requisições derrubaria descadastros legítimos
// durante um envio, e descadastro precisa ser sempre honrado.
//
// Limites conhecidos (aceitos): o estado vive na memória de UMA instância (várias
// instâncias somam limites independentes) e some no restart. É defesa em
// profundidade, não a barreira principal — a barreira é a assinatura do token.

export interface FailureRateLimiterOptions {
  // Falhas permitidas por chave dentro da janela; a (max+1)-ésima já é "limited".
  maxFailures: number
  windowMs: number
  // Teto de chaves rastreadas: memória limitada mesmo sob varredura de muitos IPs.
  maxKeys?: number
  now?: () => number
}

export interface FailureLimiterState {
  limited: boolean
  retryAfterSeconds: number
}

export interface FailureRateLimiter {
  // Registra UMA falha para a chave e devolve o estado resultante.
  hit(key: string): FailureLimiterState
  reset(): void
}

interface Entry {
  count: number
  resetAt: number
}

const DEFAULT_MAX_KEYS = 10_000

export function createFailureRateLimiter(options: FailureRateLimiterOptions): FailureRateLimiter {
  const { maxFailures, windowMs } = options
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
  const now = options.now ?? Date.now
  const entries = new Map<string, Entry>()

  function makeRoom(at: number): void {
    if (entries.size < maxKeys) return
    for (const [key, entry] of entries) {
      if (entry.resetAt <= at) entries.delete(key)
    }
    // Ainda cheio (todas ativas): descarta a mais antiga (ordem de inserção do Map).
    while (entries.size >= maxKeys) {
      const oldest = entries.keys().next()
      if (oldest.done === true) break
      entries.delete(oldest.value)
    }
  }

  return {
    hit(key: string): FailureLimiterState {
      const at = now()
      let entry = entries.get(key)
      if (entry === undefined || entry.resetAt <= at) {
        makeRoom(at)
        entry = { count: 0, resetAt: at + windowMs }
        entries.set(key, entry)
      }
      entry.count++
      return {
        limited: entry.count > maxFailures,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - at) / 1000)),
      }
    },
    reset(): void {
      entries.clear()
    },
  }
}
