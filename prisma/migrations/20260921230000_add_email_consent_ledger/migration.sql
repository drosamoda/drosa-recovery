-- Email Consent Ledger — migration puramente ADITIVA.
-- Cria 2 enums e 2 tabelas novas (livro-razão de eventos + estado atual por
-- e-mail hasheado). Nada é removido, renomeado ou reescrito; nenhuma tabela
-- existente (customers, orders, abandoned_checkouts, whatsapp_consents,
-- suppressions, ...) é alterada. Não guarda e-mail em texto: a chave é um
-- HMAC-SHA256 do e-mail normalizado. Corpo idêntico ao de
-- `prisma migrate diff` entre o schema anterior e o atual.
-- NÃO APLICADA: exige credencial admin e autorização explícita.

-- CreateEnum
CREATE TYPE "EmailConsentStatus" AS ENUM ('OPT_IN', 'OPT_OUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "EmailConsentSource" AS ENUM ('NUVEMSHOP_ORDER_PAYLOAD', 'NUVEMSHOP_CHECKOUT_PAYLOAD', 'NUVEMSHOP_CUSTOMER_API', 'NUBESDK_EXPLICIT', 'CRM_UNSUBSCRIBE', 'PROVIDER_EVENT', 'MANUAL_IMPORT');

-- CreateTable
CREATE TABLE "email_consent_events" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "EmailConsentStatus" NOT NULL,
    "source" "EmailConsentSource" NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_marketing_consents" (
    "emailHash" TEXT NOT NULL,
    "status" "EmailConsentStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_marketing_consents_pkey" PRIMARY KEY ("emailHash")
);

-- CreateIndex
CREATE INDEX "email_consent_events_emailHash_capturedAt_idx" ON "email_consent_events"("emailHash", "capturedAt");

-- CreateIndex
CREATE INDEX "email_consent_events_source_idx" ON "email_consent_events"("source");

-- CreateIndex
CREATE UNIQUE INDEX "email_consent_events_emailHash_source_evidenceRef_key" ON "email_consent_events"("emailHash", "source", "evidenceRef");

-- CreateIndex
CREATE INDEX "email_marketing_consents_status_idx" ON "email_marketing_consents"("status");
