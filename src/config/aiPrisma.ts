import { PrismaClient } from '@prisma/client'
import { env } from './env'
import { prisma } from './prisma'

// Final Pre-Activation Readiness — campaign_drafts e ai_runs terão um banco
// isolado (AI_DATABASE_URL) quando a ativação real for autorizada
// separadamente. Este tipo só expõe os dois delegates que a IA realmente
// precisa — usar qualquer outra tabela (Customer/Order/AbandonedCheckout/
// Consent/Suppression/Conversation/...) através deste client vira erro de
// COMPILAÇÃO, não só uma convenção de code review.
export type AiDatabaseClient = Pick<PrismaClient, 'campaignDraft' | 'aiRun'>

export class AiDatabaseNotConfiguredError extends Error {}

export function isAiDatabaseConfigured(): boolean {
  return env.AI_DATABASE_URL.length > 0
}

// Chamado explicitamente ANTES de qualquer chamada paga ao provedor de IA e
// ANTES de qualquer escrita — nunca dentro de getAiPrisma(), porque leitura
// (list/getById/etc.) precisa continuar funcionando hoje, sem AI_DATABASE_URL,
// contra o banco compartilhado atual (nada muda para quem já usa a tela).
// Só a GERAÇÃO (createFromOpportunity, o único caminho que grava e que chama
// a IA paga) é bloqueada por esta função.
export function assertAiDatabaseConfigured(): void {
  if (!isAiDatabaseConfigured()) {
    throw new AiDatabaseNotConfiguredError('AI_DATABASE_URL não configurada — geração de campanha desabilitada até a ativação real ser autorizada separadamente.')
  }
}

let dedicatedClient: PrismaClient | null = null

// Sem AI_DATABASE_URL, cai de volta para o client compartilhado (hoje —
// campaign_drafts/ai_runs ainda vivem fisicamente no mesmo Postgres de tudo
// mais). É seguro porque generateFromOpportunity() já bloqueou toda escrita
// via assertAiDatabaseConfigured() antes de chegar aqui — este fallback só é
// realmente exercitado pelos caminhos de leitura/administração (list,
// getById, selectStrategy, approve, schedule, cancel), preservando o
// comportamento atual até a migração para o banco isolado ser autorizada.
export function getAiPrisma(): AiDatabaseClient {
  if (!isAiDatabaseConfigured()) return prisma
  if (!dedicatedClient) {
    dedicatedClient = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      datasources: { db: { url: env.AI_DATABASE_URL } },
    })
  }
  return dedicatedClient
}
