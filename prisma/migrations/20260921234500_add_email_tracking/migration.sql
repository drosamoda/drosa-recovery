-- Email Tracking — migration puramente ADITIVA.
-- Cria 2 enums e 2 tabelas novas: tentativas de envio (email_sends) e eventos do
-- provedor + compras atribuídas (email_event_logs). Nada é removido, renomeado ou
-- reescrito; nenhuma tabela existente é alterada. Só guarda ids opacos e o
-- emailHash (HMAC do e-mail): nenhum e-mail, nome ou telefone. Corpo idêntico ao
-- de `prisma migrate diff` entre o schema anterior e o atual. Depende (na ordem)
-- de 20260921230000_add_email_consent_ledger e 20260921233000_add_email_suppression.
-- NÃO APLICADA: exige credencial admin e autorização explícita.

-- CreateEnum
CREATE TYPE "EmailSendStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'SOFT_BOUNCED', 'HARD_BOUNCED', 'COMPLAINED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'DEFERRED', 'SOFT_BOUNCE', 'HARD_BOUNCE', 'BLOCKED', 'OPEN', 'CLICK', 'SPAM_COMPLAINT', 'UNSUBSCRIBE', 'PURCHASE');

-- CreateTable
CREATE TABLE "email_sends" (
    "id" TEXT NOT NULL,
    "sendKey" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "status" "EmailSendStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_event_logs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "type" "EmailEventType" NOT NULL,
    "emailHash" TEXT NOT NULL,
    "sendId" TEXT,
    "campaignKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT,
    "revenue" DECIMAL(12,2),
    "currency" TEXT,
    "attributionModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_sends_sendKey_key" ON "email_sends"("sendKey");

-- CreateIndex
CREATE INDEX "email_sends_emailHash_sentAt_idx" ON "email_sends"("emailHash", "sentAt");

-- CreateIndex
CREATE INDEX "email_sends_campaignKey_status_idx" ON "email_sends"("campaignKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "email_sends_provider_providerMessageId_key" ON "email_sends"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "email_event_logs_sendId_type_idx" ON "email_event_logs"("sendId", "type");

-- CreateIndex
CREATE INDEX "email_event_logs_emailHash_type_occurredAt_idx" ON "email_event_logs"("emailHash", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "email_event_logs_campaignKey_type_idx" ON "email_event_logs"("campaignKey", "type");

-- CreateIndex
CREATE UNIQUE INDEX "email_event_logs_provider_providerEventId_key" ON "email_event_logs"("provider", "providerEventId");
