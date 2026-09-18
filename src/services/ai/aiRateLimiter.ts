import { env } from '../../config/env'

// Guarda-corpo de custo — nunca decide elegibilidade de negócio (isso
// continua só em remarketingService/campaignEvidenceService). Em memória, de
// propósito: Preview roda uma única instância nesta fase; se/quando escalar
// para múltiplas instâncias simultâneas, isto precisa virar um contador
// compartilhado (Postgres/Redis) — documentado aqui para não ser esquecido,
// não implementado além do necessário para a fase de prep atual.
let activeGenerations = 0
const recentGenerationTimestamps: number[] = []

export class AiConcurrencyLimitError extends Error {}
export class AiRateLimitExceededError extends Error {}

// Chamado uma única vez por geração, ANTES de qualquer chamada paga ao
// provedor. Retorna a função de liberação — o chamador é responsável por
// chamá-la em um finally, sucesso ou falha, para não vazar o slot.
export function acquireGenerationSlot(): () => void {
  if (activeGenerations >= env.AI_MAX_CONCURRENT_GENERATIONS) {
    throw new AiConcurrencyLimitError(`Limite de ${env.AI_MAX_CONCURRENT_GENERATIONS} geração(ões) simultânea(s) de campanha atingido — tente novamente em instantes.`)
  }
  const now = Date.now()
  const windowStart = now - 60_000
  while (recentGenerationTimestamps.length && recentGenerationTimestamps[0] < windowStart) recentGenerationTimestamps.shift()
  if (recentGenerationTimestamps.length >= env.AI_GENERATION_MAX_PER_MINUTE) {
    throw new AiRateLimitExceededError(`Limite de ${env.AI_GENERATION_MAX_PER_MINUTE} geração(ões) de campanha por minuto atingido — tente novamente em instantes.`)
  }

  activeGenerations++
  recentGenerationTimestamps.push(now)
  let released = false
  return () => {
    if (released) return
    released = true
    activeGenerations--
  }
}
