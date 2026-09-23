-- Email Suppression — migration puramente ADITIVA.
-- Cria 1 enum e 1 tabela nova (lista de bloqueio definitiva de e-mail,
-- chaveada por emailHash = HMAC-SHA256 do e-mail normalizado; o e-mail em
-- texto nunca é gravado). Nada é removido, renomeado ou reescrito; nenhuma
-- tabela existente (inclusive `suppressions`, que é de WhatsApp) é alterada.
-- Corpo idêntico ao de `prisma migrate diff` entre o schema anterior
-- (com o livro-razão de consentimento) e o atual.
-- Depende de 20260921230000_add_email_consent_ledger só por convenção de
-- ordem; não há chave estrangeira entre as tabelas.
-- NÃO APLICADA: exige credencial admin e autorização explícita.

-- CreateEnum
CREATE TYPE "EmailSuppressionReason" AS ENUM ('UNSUBSCRIBE', 'PROVIDER_UNSUBSCRIBE', 'SPAM_COMPLAINT', 'HARD_BOUNCE', 'INVALID_ADDRESS', 'MANUAL');

-- CreateTable
CREATE TABLE "email_suppressions" (
    "emailHash" TEXT NOT NULL,
    "reason" "EmailSuppressionReason" NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "suppressedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("emailHash")
);

-- CreateIndex
CREATE INDEX "email_suppressions_reason_idx" ON "email_suppressions"("reason");

-- CreateIndex
CREATE INDEX "email_suppressions_suppressedAt_idx" ON "email_suppressions"("suppressedAt");
