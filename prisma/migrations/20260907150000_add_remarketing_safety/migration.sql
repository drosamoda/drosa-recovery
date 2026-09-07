-- Additive-only migration for checkout timing, delivery reconciliation and remarketing audit.
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'unknown';

CREATE TYPE "MirrorStatus" AS ENUM ('pending', 'processing', 'mirrored', 'failed');
CREATE TYPE "RemarketingSegment" AS ENUM ('abandoned_cart', 'pix_pending', 'boleto_pending', 'recent_customer', 'inactive_customer', 'vip_customer', 'engaged_no_purchase');
CREATE TYPE "RemarketingRunMode" AS ENUM ('preview', 'send');
CREATE TYPE "RemarketingRunStatus" AS ENUM ('running', 'completed', 'failed');
CREATE TYPE "RemarketingRecipientStatus" AS ENUM ('eligible', 'suppressed', 'queued', 'sent', 'failed');

ALTER TABLE "orders" ADD COLUMN "sourceCreatedAt" TIMESTAMP(3), ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
ALTER TABLE "abandoned_checkouts" ADD COLUMN "convertedOrderId" TEXT, ADD COLUMN "sourceCreatedAt" TIMESTAMP(3), ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3), ADD COLUMN "abandonedAt" TIMESTAMP(3), ADD COLUMN "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "message_logs" ADD COLUMN "acceptedAt" TIMESTAMP(3), ADD COLUMN "deliveryUnknownAt" TIMESTAMP(3), ADD COLUMN "claimOwner" TEXT, ADD COLUMN "claimExpiresAt" TIMESTAMP(3), ADD COLUMN "templateLanguage" TEXT, ADD COLUMN "templateParameters" JSONB, ADD COLUMN "renderedPreview" TEXT, ADD COLUMN "templateHash" TEXT, ADD COLUMN "mirrorStatus" "MirrorStatus" NOT NULL DEFAULT 'pending', ADD COLUMN "mirrorRetryCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "mirrorLastError" TEXT, ADD COLUMN "mirroredAt" TIMESTAMP(3);

CREATE TABLE "suppressions" (
  "id" TEXT NOT NULL, "normalizedPhone" TEXT NOT NULL, "reason" TEXT NOT NULL, "source" TEXT NOT NULL,
  "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "suppressions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "remarketing_runs" (
  "id" TEXT NOT NULL, "segment" "RemarketingSegment" NOT NULL, "mode" "RemarketingRunMode" NOT NULL,
  "status" "RemarketingRunStatus" NOT NULL DEFAULT 'running', "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "eligibleCount" INTEGER NOT NULL DEFAULT 0, "sentCount" INTEGER NOT NULL DEFAULT 0, "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "remarketing_runs_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "contact_frequency_locks" (
  "normalizedPhone" TEXT NOT NULL, "messageLogId" TEXT NOT NULL, "lockedUntil" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_frequency_locks_pkey" PRIMARY KEY ("normalizedPhone")
);
CREATE TABLE "remarketing_recipients" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "normalizedPhoneHash" TEXT NOT NULL, "entityType" "EntityType" NOT NULL,
  "entityId" TEXT NOT NULL, "templateName" TEXT NOT NULL, "status" "RemarketingRecipientStatus" NOT NULL,
  "reason" TEXT, "eligibilitySnapshot" JSONB NOT NULL, "messageLogId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "remarketing_recipients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppressions_normalizedPhone_key" ON "suppressions"("normalizedPhone");
CREATE INDEX "suppressions_suppressedAt_idx" ON "suppressions"("suppressedAt");
CREATE INDEX "contact_frequency_locks_lockedUntil_idx" ON "contact_frequency_locks"("lockedUntil");
CREATE INDEX "orders_sourceCreatedAt_idx" ON "orders"("sourceCreatedAt");
CREATE INDEX "abandoned_checkouts_sourceCreatedAt_idx" ON "abandoned_checkouts"("sourceCreatedAt");
CREATE INDEX "abandoned_checkouts_sourceUpdatedAt_idx" ON "abandoned_checkouts"("sourceUpdatedAt");
CREATE INDEX "abandoned_checkouts_convertedOrderId_idx" ON "abandoned_checkouts"("convertedOrderId");
CREATE INDEX "message_logs_claimExpiresAt_idx" ON "message_logs"("claimExpiresAt");
CREATE INDEX "message_logs_mirrorStatus_idx" ON "message_logs"("mirrorStatus");
CREATE INDEX "remarketing_runs_segment_startedAt_idx" ON "remarketing_runs"("segment", "startedAt");
CREATE INDEX "remarketing_runs_status_idx" ON "remarketing_runs"("status");
CREATE UNIQUE INDEX "remarketing_recipients_runId_entityType_entityId_key" ON "remarketing_recipients"("runId", "entityType", "entityId");
CREATE INDEX "remarketing_recipients_normalizedPhoneHash_idx" ON "remarketing_recipients"("normalizedPhoneHash");
CREATE INDEX "remarketing_recipients_status_idx" ON "remarketing_recipients"("status");
ALTER TABLE "abandoned_checkouts" ADD CONSTRAINT "abandoned_checkouts_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "remarketing_recipients" ADD CONSTRAINT "remarketing_recipients_runId_fkey" FOREIGN KEY ("runId") REFERENCES "remarketing_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
