-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('ABANDONED_CART', 'PIX_PENDING', 'BOLETO_PENDING', 'REPEAT_PURCHASE', 'WINBACK', 'VIP', 'RECENT_CUSTOMER', 'ENGAGED_NO_PURCHASE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'AI_READY', 'PRODUCT_TRUTH_APPROVED', 'COMPLIANCE_APPROVED', 'AWAITING_HUMAN_APPROVAL', 'APPROVED', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductTruthStatus" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('ok', 'error');

-- CreateTable
CREATE TABLE "campaign_drafts" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "opportunityType" "OpportunityType" NOT NULL,
    "opportunityTitle" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT,
    "audienceSnapshot" JSONB NOT NULL,
    "strategies" JSONB,
    "selectedStrategy" INTEGER,
    "productTruthStatus" "ProductTruthStatus" NOT NULL DEFAULT 'PENDING',
    "complianceStatus" "ComplianceStatus" NOT NULL DEFAULT 'PENDING',
    "complianceFindings" JSONB,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "campaignDraftId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT,
    "status" "AiRunStatus" NOT NULL DEFAULT 'ok',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_drafts_idempotencyKey_key" ON "campaign_drafts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "campaign_drafts_status_idx" ON "campaign_drafts"("status");

-- CreateIndex
CREATE INDEX "campaign_drafts_opportunityType_idx" ON "campaign_drafts"("opportunityType");

-- CreateIndex
CREATE INDEX "campaign_drafts_createdAt_idx" ON "campaign_drafts"("createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_campaignDraftId_idx" ON "ai_runs"("campaignDraftId");

-- CreateIndex
CREATE INDEX "ai_runs_createdAt_idx" ON "ai_runs"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_campaignDraftId_fkey" FOREIGN KEY ("campaignDraftId") REFERENCES "campaign_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

