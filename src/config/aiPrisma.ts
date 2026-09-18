import { PrismaClient } from '@prisma/client'
import { env } from './env'

// Final Pre-Activation Readiness — Activation Wiring v2 (seção 5): este
// client NUNCA cai de volta para o banco compartilhado (config/prisma.ts) —
// nem para leitura. Do ponto de vista deste código, campaign_drafts/ai_runs
// só existem dentro do banco isolado por AI_DATABASE_URL (mesmo Supabase de
// hoje, credencial própria — crm_ai_preview_writer — não um segundo banco
// físico). Sem AI_DATABASE_URL, toda operação de IA (list/getById/create/
// approve/schedule/cancel/learning) fica indisponível (503
// AI_DATABASE_NOT_CONFIGURED) — nunca lê/escreve silenciosamente no
// DATABASE_URL do Preview.
//
// O tipo AiDatabaseClient só expõe campaignDraft/aiRun de propósito — usar
// qualquer outra tabela (Customer/Order/AbandonedCheckout/Consent/
// Suppression/Conversation/...) através deste client vira erro de
// COMPILAÇÃO, não só uma convenção de code review.
export type AiDatabaseClient = Pick<PrismaClient, 'campaignDraft' | 'aiRun'>

export class AiDatabaseNotConfiguredError extends Error {}

export function isAiDatabaseConfigured(): boolean {
  return env.AI_DATABASE_URL.length > 0
}

let dedicatedClient: PrismaClient | null = null

export function getAiPrisma(): AiDatabaseClient {
  if (!isAiDatabaseConfigured()) {
    throw new AiDatabaseNotConfiguredError('AI_DATABASE_URL não configurada — recurso de IA indisponível até a ativação real ser autorizada separadamente.')
  }
  if (!dedicatedClient) {
    dedicatedClient = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
      datasources: { db: { url: env.AI_DATABASE_URL } },
    })
  }
  return dedicatedClient
}
