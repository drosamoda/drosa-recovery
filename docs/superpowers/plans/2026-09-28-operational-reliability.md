# Operational Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable transactional WhatsApp automation, rotate the exposed jobs credential, make job freshness observable, and prevent stale queue bulk-send.

**Architecture:** Keep Cloud Scheduler as the production scheduler and `processMessages` as the only dispatcher. Add queue-audit and job-run observability around existing jobs; do not create a second scheduler or dispatcher. Production rollout is staged: rotate secret, audit queue, controlled invocation, then recurring jobs.

**Tech Stack:** Express, Prisma, Cloud Scheduler, Cloud Run, Secret Manager, React Health page, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-drosa-central-campaign-studio-design.md`

## Global Constraints

- Scheduler frequencies: process messages 1 minute, abandoned checkout sync 15 minutes, boleto expiring sync 60 minutes.
- Do not print or echo `JOBS_SECRET`.
- Do not send the historical queue blindly.
- Keep `processMessages` revalidation and expiry logic canonical.
- Rollback must never restore the compromised secret.
- Do not change consent rules.

## Review Focus

1. A pending message older than `AUTOMATION_MAX_MESSAGE_AGE_HOURS` must be classified stale before Scheduler activation.
2. A Scheduler retry must not double-send a claimed message.
3. Job telemetry must not contain phone, email, raw payload, headers or secrets.
4. A job route failure must persist a closed error category without leaking exception text.
5. Scheduler configuration drift must be detectable before recurring execution is enabled.

---

### Task 1: Add deterministic pending-queue audit

**Files:**
- Create: `src/ops/auditPendingMessages.ts`
- Create: `src/__tests__/unit/auditPendingMessages.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `auditPendingMessages(now?: Date): Promise<PendingQueueAudit>`
- Produces: `PendingQueueAudit = { total; stale; ready; byTemplate; bySource; oldestScheduledAt; blockedLegacy }`

- [ ] **Step 1: Write the failing tests** for an empty queue, stale messages, ready messages, legacy-blocked templates and aggregation without returning PII.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/unit/auditPendingMessages.test.ts`; expect FAIL because the module does not exist.
- [ ] **Step 3: Implement** `auditPendingMessages(now?: Date)` using `MessageLog` aggregates and `AUTOMATION_MAX_MESSAGE_AGE_HOURS`; return only counts/template/source/timestamps.
- [ ] **Step 4: Add** `ops:pending-queue:audit` script that prints only the aggregate object.
- [ ] **Step 5: Run** the focused test and `npm run typecheck`; expect PASS.
- [ ] **Step 6: Commit** `feat(ops): add pending queue audit`.

### Task 2: Persist job execution summaries

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_automation_job_runs/migration.sql`
- Create: `src/services/automationJobRunService.ts`
- Create: `src/__tests__/unit/automationJobRunService.test.ts`

**Interfaces:**
- Add model `AutomationJobRun` with: `id`, `jobKey`, `status`, `startedAt`, `finishedAt`, `durationMs`, `summary Json?`, `errorCategory String?`, timestamps.
- Produces: `startAutomationJobRun(jobKey: AutomationJobKey): Promise<string>`
- Produces: `finishAutomationJobRun(id: string, summary: SafeJobSummary): Promise<void>`
- Produces: `failAutomationJobRun(id: string, category: JobErrorCategory): Promise<void>`
- Produces: `latestAutomationJobRuns(): Promise<Record<AutomationJobKey, SafeJobRun | null>>`

- [ ] **Step 1: Write failing service tests** proving only safe summary fields persist and arbitrary exception text is not stored.
- [ ] **Step 2: Run** the focused test; expect FAIL.
- [ ] **Step 3: Add the Prisma model and migration** with indexes on `jobKey, startedAt` and `status`.
- [ ] **Step 4: Implement the service** with the closed keys `process_messages`, `sync_abandoned_checkouts`, `sync_boleto_expiring`, `remarketing`, `email_campaigns`.
- [ ] **Step 5: Run** Prisma generate, focused test and typecheck; expect PASS.
- [ ] **Step 6: Commit** `feat(ops): persist automation job runs`.

### Task 3: Expose the missing boleto job route and instrument all three transactional jobs

**Files:**
- Modify: `src/routes/jobs.routes.ts`
- Modify: `src/__tests__/integration/processMessages.test.ts`
- Modify: `src/__tests__/integration/scheduleAbandonedCheckout.test.ts`
- Create: `src/__tests__/integration/syncBoletoExpiringRoute.test.ts`

**Interfaces:**
- Consumes Task 2 job-run functions.
- Existing `/process-messages` and `/sync-abandoned-checkouts` response bodies remain compatible.
- Adds the currently missing HTTP contract `POST /jobs/sync-boleto-expiring`, returning the result of `runSyncBoletoExpiring()`.

- [ ] **Step 1: Write a failing integration test** proving `POST /jobs/sync-boleto-expiring` exists, requires jobs auth, and invokes `runSyncBoletoExpiring()`; current main should fail because the route is absent.
- [ ] **Step 2: Add failing telemetry tests** proving all three jobs create completed runs on success and failed runs with closed categories on exceptions.
- [ ] **Step 3: Run affected integration tests**; expect FAIL.
- [ ] **Step 4: Import `runSyncBoletoExpiring`, add the missing route, and wrap all three transactional routes with Task 2 telemetry**.
- [ ] **Step 5: Preserve the existing response contracts for the two existing routes and use the job result unchanged for boleto**.
- [ ] **Step 6: Run affected integration tests, typecheck and lint**; expect PASS.
- [ ] **Step 7: Commit** `feat(ops): expose and instrument transactional jobs`.

### Task 4: Surface Scheduler/job freshness in health

**Files:**
- Modify: `src/jobs/automationHealth.ts`
- Modify: `src/__tests__/unit/automationHealth.test.ts`
- Modify: `frontend/src/routes/health/HealthPage.tsx`
- Modify: `frontend/src/routes/health/__tests__/HealthPage.test.tsx`
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- `automationHealth()` adds `jobRuns` and `jobFreshness`.
- Freshness thresholds: process messages 3 min; abandoned sync 45 min; boleto sync 120 min.
- `ENABLE_INTERNAL_CRON=false` alone must not be treated as a production incident when external Scheduler freshness is healthy.

- [ ] **Step 1: Write backend tests** for fresh, stale and never-run job states.
- [ ] **Step 2: Write frontend test** asserting a stale Scheduler job appears as attention and internal cron false is neutral when external jobs are fresh.
- [ ] **Step 3: Run focused tests**; expect FAIL.
- [ ] **Step 4: Implement backend freshness calculations** from `AutomationJobRun`.
- [ ] **Step 5: Add a Jobs panel** to Health using existing design-system status components.
- [ ] **Step 6: Run backend/frontend focused tests and typechecks**; expect PASS.
- [ ] **Step 7: Commit** `feat(health): show automation job freshness`.

### Task 5: Add safe Scheduler reconciliation script

**Files:**
- Create: `scripts/ops/reconcile-cloud-scheduler.ps1`
- Create: `docs/runbooks/WHATSAPP_TRANSACTIONAL_SCHEDULER.md`

**Interfaces:**
- Script parameters: `-ProjectId`, `-Region`, `-ServiceUrl`, `-JobsSecretFile`, `-Apply`.
- Dry-run is default.
- Job names: `drosa-process-messages`, `drosa-sync-abandoned-checkouts`, `drosa-sync-boleto-expiring`.

- [ ] **Step 1: Implement dry-run output** that shows job name, URL and schedule but never header value.
- [ ] **Step 2: Implement apply mode** with schedules `* * * * *`, `*/15 * * * *`, `0 * * * *` in the existing Scheduler timezone.
- [ ] **Step 3: Ensure the secret is read from a file/secure variable and never written to stdout**.
- [ ] **Step 4: Document before-state, apply, verify and rollback commands**.
- [ ] **Step 5: Run PowerShell parser/syntax validation and secret-pattern grep**; expect no secret output.
- [ ] **Step 6: Commit** `ops: add safe scheduler reconciliation`.

### Task 6: Production rotation and controlled activation

**Files:**
- No business-code change beyond Tasks 1–5.
- Update: `docs/handoff/CURRENT_STATE.md` if it exists after Plan 5; otherwise create an operational evidence note under `docs/handoff/`.

**Interfaces:**
- GCP project: `gtm-m4sqc99b-nzjjz`
- Region: `us-central1`
- Service: `drosa-recovery`

- [ ] **Step 1: Capture before-state**: main SHA, live revision, image digest, current Scheduler job names, queue audit totals and rollback revision.
- [ ] **Step 2: Generate a new `JOBS_SECRET` value without displaying it**, add a new Secret Manager version and deploy a 0% revision referencing it.
- [ ] **Step 3: Update Scheduler jobs to the new secret using the safe reconciliation script**; do not enable recurring schedules until Step 5.
- [ ] **Step 4: Invoke each job once against the 0% tagged revision** and verify 2xx plus persisted job-run evidence.
- [ ] **Step 5: Run the queue audit and execute one controlled `process-messages` batch**; verify stale/invalid messages are skipped/deferred by existing rules rather than sent blindly.
- [ ] **Step 6: Enable the recurring schedules** at 1/15/60 minutes.
- [ ] **Step 7: Observe at least 15 minutes**: no new 5xx class, no pool timeout, job freshness green, real webhooks 2xx, pending queue no longer grows solely because processor is absent.
- [ ] **Step 8: Disable the compromised secret version** only after all jobs and the live revision use the new version.
- [ ] **Step 9: Record gates** `JOBS_SECRET_ROTATED=PASS`, `TRANSACTIONAL_SCHEDULERS=PASS`, `PENDING_QUEUE_AUDITED=PASS`, `PROCESS_MESSAGES_FRESH=PASS`, `WEBHOOKS_STABLE=PASS`, `POOL_TIMEOUT=0`.

