-- Email Campaign Intelligence — migration puramente ADITIVA.
-- Nada é removido, renomeado ou reescrito; nenhuma linha existente é tocada
-- além do DEFAULT aplicado à nova coluna (drafts antigos viram WHATSAPP).
-- Só afeta as tabelas/tipos de IA (campaign_drafts, OpportunityType). Nenhuma
-- tabela de cliente/pedido/mensagem (customers, orders, message_logs, ...) é
-- alterada.

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- AlterEnum (somente valores novos, todos de canal e-mail)
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_ALL_CUSTOMERS';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_ONE_TIME_BUYERS';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_REPEAT_BUYERS';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_VIP';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_RECENT_BUYERS';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_LAPSED_31_60';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_LAPSED_61_90';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_LAPSED_91_180';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_LAPSED_181_365';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_DORMANT_365_PLUS';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_NO_PURCHASE';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_HIGH_VALUE_NON_VIP';
ALTER TYPE "OpportunityType" ADD VALUE 'EMAIL_CART_ABANDONERS';

-- AlterTable: coluna NOT NULL com DEFAULT — segura para linhas existentes.
ALTER TABLE "campaign_drafts" ADD COLUMN "channel" "CampaignChannel" NOT NULL DEFAULT 'WHATSAPP';

-- CreateIndex
CREATE INDEX "campaign_drafts_channel_idx" ON "campaign_drafts"("channel");
