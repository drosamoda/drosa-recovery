-- Automation Job Telemetry — migration puramente ADITIVA.
-- Cria 2 enums e 1 tabela nova (automation_job_runs) para registrar execuções
-- dos jobs process-messages, sync-abandoned-checkouts, sync-boleto-expiring,
-- remarketing e email-campaigns. Nada é removido, renomeado ou reescrito;
-- nenhuma tabela existente é alterada. `summary`/`errorCategory` guardam
-- apenas agregados/categorias fechadas — nunca telefone, e-mail, payload,
-- headers ou segredos (ver src/services/automationJobRunService.ts).
-- Corpo idêntico ao de `prisma migrate diff` entre o schema anterior e o
-- atual. NÃO APLICADA: exige credencial admin e autorização explícita
-- (ver docs/superpowers/plans/2026-09-28-operational-reliability.md, Task 6).

-- CreateEnum
CREATE TYPE "AutomationJobKey" AS ENUM ('process_messages', 'sync_abandoned_checkouts', 'sync_boleto_expiring', 'remarketing', 'email_campaigns');

-- CreateEnum
CREATE TYPE "AutomationJobStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "automation_job_runs" (
    "id" TEXT NOT NULL,
    "jobKey" "AutomationJobKey" NOT NULL,
    "status" "AutomationJobStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "summary" JSONB,
    "errorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_job_runs_jobKey_startedAt_idx" ON "automation_job_runs"("jobKey", "startedAt");

-- CreateIndex
CREATE INDEX "automation_job_runs_status_idx" ON "automation_job_runs"("status");
