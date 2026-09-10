CREATE TABLE "whatsapp_consents" (
    "id" TEXT NOT NULL,
    "normalizedPhone" TEXT NOT NULL,
    "consented" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'marketing',
    "consentedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_consents_normalizedPhone_scope_key"
ON "whatsapp_consents"("normalizedPhone", "scope");

CREATE INDEX "whatsapp_consents_consented_revokedAt_idx"
ON "whatsapp_consents"("consented", "revokedAt");
