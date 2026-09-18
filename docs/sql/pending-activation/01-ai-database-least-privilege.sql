-- ============================================================================
-- PREPARADO, NÃO EXECUTADO.
-- Final Pre-Activation Readiness — Activation Wiring v2 (seção 7).
--
-- Roda no MESMO Supabase/Postgres já usado hoje pelo Preview — não é um
-- segundo banco físico. AI_DATABASE_URL aponta para este MESMO banco, só com
-- uma credencial (role) diferente e muito mais restrita do que
-- crm_preview_reader (o role read-only já usado por DATABASE_URL). Só deve
-- ser rodado manualmente, por um owner/admin do Supabase, depois que a
-- ativação real for autorizada separadamente. Nenhum secret está neste
-- arquivo — a senha do role é gerada e definida à parte, fora do
-- repositório, no momento da ativação.
--
-- Pré-requisito: a migration inicial
-- (prisma/migrations/20260915173122_add_ai_campaign_intelligence, que já
-- inclui a coluna idempotencyKey e seu índice único) aplicada neste banco via
-- `prisma migrate deploy` ou equivalente — NÃO executada por este script.
-- ============================================================================

-- Role dedicado, sem nenhum privilégio elevado: sem superusuário, sem poder
-- criar bancos/roles, sem replicação. Connection limit baixo — mesmo
-- raciocínio do connection_limit=2 já usado por crm_preview_reader
-- (src/config/prisma.ts): poucas instâncias simultâneas, nenhuma precisa de
-- um pool grande.
CREATE ROLE crm_ai_preview_writer WITH
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  CONNECTION LIMIT 2
  PASSWORD '<definir no momento da ativação, fora do repositório>';

-- Conectar ao banco (ajustar <database_name> para o banco real do Supabase
-- deste projeto) e usar o schema public — sem isso, os GRANTs abaixo não têm
-- efeito nenhum.
GRANT CONNECT ON DATABASE "<database_name>" TO crm_ai_preview_writer;
GRANT USAGE ON SCHEMA public TO crm_ai_preview_writer;

-- Único acesso concedido: leitura e escrita em campaign_drafts e ai_runs.
-- Nenhum DELETE (nem a aplicação usa DELETE nestas tabelas hoje — cancel()
-- só atualiza status para CANCELLED). Nenhum outro GRANT em nenhuma outra
-- tabela — em especial, este role nunca recebe nada que
-- crm_preview_reader já tenha (são completamente independentes).
GRANT SELECT, INSERT, UPDATE ON TABLE campaign_drafts TO crm_ai_preview_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE ai_runs TO crm_ai_preview_writer;

-- CampaignDraft/AiRun usam cuid() gerado em código (@default(cuid())), não
-- uma sequence do Postgres — nenhum GRANT de sequence é necessário.

-- Os únicos tipos enumerados usados por estas duas tabelas
-- (CampaignStatus, ProductTruthStatus, ComplianceStatus, AiRunStatus,
-- OpportunityType) precisam de USAGE para o role poder gravar/ler valores
-- desses tipos — nada além destes cinco.
GRANT USAGE ON TYPE "CampaignStatus" TO crm_ai_preview_writer;
GRANT USAGE ON TYPE "ProductTruthStatus" TO crm_ai_preview_writer;
GRANT USAGE ON TYPE "ComplianceStatus" TO crm_ai_preview_writer;
GRANT USAGE ON TYPE "AiRunStatus" TO crm_ai_preview_writer;
GRANT USAGE ON TYPE "OpportunityType" TO crm_ai_preview_writer;

-- Blindagem explícita (defesa em profundidade — os GRANTs acima já não
-- incluem nenhuma outra tabela, mas o REVOKE deixa a intenção auditável
-- mesmo se o schema ganhar tabelas novas no futuro). Reaplica os dois GRANTs
-- em seguida porque REVOKE ALL também atinge campaign_drafts/ai_runs.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM crm_ai_preview_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE campaign_drafts TO crm_ai_preview_writer;
GRANT SELECT, INSERT, UPDATE ON TABLE ai_runs TO crm_ai_preview_writer;

-- Nunca tocar em crm_preview_reader (o role read-only do Preview) — nenhuma
-- linha deste script concede, revoga ou altera qualquer privilégio dele.
--
-- Nenhuma tabela de cliente (customers, orders, abandoned_checkouts,
-- whatsapp_consents, suppressions, conversations, chat_messages,
-- message_logs, webhook_events, ...) recebe qualquer GRANT para
-- crm_ai_preview_writer — de propósito, é a mesma garantia que
-- src/config/aiPrisma.ts já impõe em nível de tipo (AiDatabaseClient só
-- expõe campaignDraft/aiRun).
