-- ============================================================================
-- PREPARADO, NÃO APLICADO.
-- Final Pre-Activation Readiness — seção 4.
--
-- Este script NÃO foi executado contra nenhum banco (Preview ou Produção).
-- Só deve ser rodado manualmente, por um humano, no banco ISOLADO que
-- receberá AI_DATABASE_URL, depois que a ativação real for autorizada
-- separadamente. Nenhum secret está neste arquivo — a senha do role é
-- gerada e definida à parte, fora do repositório, no momento da ativação.
--
-- Pré-requisito: o schema (campaign_drafts, ai_runs — ver prisma/schema.prisma)
-- já existe neste banco isolado (aplicado via `prisma migrate deploy` ou
-- equivalente, também NÃO executado por este script).
-- ============================================================================

-- Role dedicado, sem privilégio de superusuário, sem acesso a nenhuma tabela
-- além das duas explicitamente listadas abaixo. Nunca reaproveita o role já
-- usado pelo Preview (CRM_PREVIEW_READONLY) nem qualquer role de produção.
CREATE ROLE crm_ai_preview_writer WITH LOGIN PASSWORD '<definir no momento da ativação, fora do repositório>'
  CONNECTION LIMIT 3; -- baixo de propósito — mesmo raciocínio do connection_limit=2 já usado no Preview (src/config/prisma.ts): poucas instâncias simultâneas, nenhuma precisa de um pool grande.

-- Sem acesso de schema por padrão — precisa ser concedido explicitamente,
-- tabela por tabela, nunca "ALL TABLES".
GRANT USAGE ON SCHEMA public TO crm_ai_preview_writer;

-- Único acesso concedido: leitura e escrita em campaign_drafts e ai_runs.
-- Nenhum DELETE (nem a aplicação usa DELETE nestas tabelas hoje — cancel()
-- só atualiza status para CANCELLED).
GRANT SELECT, INSERT, UPDATE ON TABLE campaign_drafts TO crm_ai_preview_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE ai_runs TO crm_ai_preview_writer;

-- Sequências/ids: CampaignDraft e AiRun usam cuid() gerado em código
-- (@default(cuid())), não uma sequence do Postgres — nenhum GRANT de
-- sequence é necessário para estas duas tabelas.

-- Blindagem explícita (defesa em profundidade — o GRANT acima já não inclui
-- nenhuma outra tabela, mas REVOKE deixa a intenção auditável mesmo se o
-- schema ganhar tabelas novas no futuro):
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM crm_ai_preview_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE campaign_drafts TO crm_ai_preview_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE ai_runs TO crm_ai_preview_writer;

-- Nenhuma tabela de cliente (customers, orders, abandoned_checkouts,
-- whatsapp_consents, suppressions, conversations, chat_messages,
-- message_logs, webhook_events, ...) recebe qualquer GRANT para este role —
-- de propósito, é a mesma garantia que src/config/aiPrisma.ts já impõe em
-- nível de tipo (AiDatabaseClient só expõe campaignDraft/aiRun).
