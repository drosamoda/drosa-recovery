-- ============================================================================
-- PREPARADO, NÃO APLICADO.
-- Final Pre-Activation Readiness — seção 5.
--
-- Este script NÃO foi executado. Só deve ser rodado manualmente depois que a
-- ativação real for autorizada. Até lá, campaignService.createFromOpportunity()
-- já protege contra RETRY sequencial (mesma idempotencyKey, uma requisição
-- de cada vez) via um findFirst antes do create — este índice é o que falta
-- para proteger também contra DOIS CLIQUES CONCORRENTES com a mesma key
-- (corrida verdadeira), fechando a lacuna que o código sozinho não fecha.
--
-- Por que um índice funcional em JSON em vez de uma coluna nova: a chave é
-- guardada dentro de "audienceSnapshot" (Json já existente no schema), não em
-- uma coluna própria — assim nenhuma alteração de schema.prisma nem
-- `prisma generate` foi necessária nesta rodada, o que evita o modo de falha
-- já visto neste projeto (comentário em src/routes/aiCampaigns.routes.ts):
-- um client Prisma regenerado esperando uma coluna que a migration real ainda
-- não aplicou quebra list()/getById() em produção/Preview. Quando este
-- projeto migrar para uma coluna dedicada de verdade, este índice pode ser
-- substituído por um UNIQUE de coluna normal na mesma migration.
-- ============================================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS campaign_drafts_idempotency_key_uidx
  ON campaign_drafts ((("audienceSnapshot" ->> 'idempotencyKey')))
  WHERE "audienceSnapshot" ->> 'idempotencyKey' IS NOT NULL;
