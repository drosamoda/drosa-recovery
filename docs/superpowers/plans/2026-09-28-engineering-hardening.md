# Engineering Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CI, observability, security redaction, documentation and database capacity controls match the maturity of the production system.

**Architecture:** Improve existing engineering surfaces without rewriting business modules. CI becomes the canonical merge gate for backend, frontend, extension and production build; health separates liveness/readiness/integration status; one redaction policy is shared by logs and Sentry.

**Tech Stack:** GitHub Actions, TypeScript, Express, Vitest, Prisma, Sentry, Cloud Run/Supabase.

**Spec:** `docs/superpowers/specs/2026-09-28-drosa-central-campaign-studio-design.md`

## Global Constraints

- No broad refactor for its own sake.
- Do not change business semantics while hardening.
- Production build gate must include the React build.
- Tests must become deterministic instead of accepting isolated rerun as the permanent fix.
- Security headers must preserve the approved Metabase embed behavior.
- Database pool changes require capacity calculation first.

## Review Focus

1. A frontend-only breaking change must fail CI even if backend `npm run build` succeeds.
2. Redaction must catch secret values under alternate header/env key names, cookies and database URLs.
3. `/health` must remain fast and not depend on third-party calls.
4. A Metabase outage must degrade integration health without marking the process dead.
5. Pool configuration must never allow theoretical Cloud Run connections to exceed the agreed Supabase budget.

---

### Task 1: Make GitHub CI canonical

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Add root script `ci:frontend` that runs frontend install/typecheck/lint/test/build.
- Add root script `ci:production-build` equivalent to production build path without deploy.
- CI must run backend, frontend, NubeSDK, Prisma validate/generate and secret scan.

- [ ] **Step 1: Add scripts locally and intentionally introduce a temporary frontend type error to prove the new command fails; revert the intentional error immediately**.
- [ ] **Step 2: Update CI workflow** with separate named steps for frontend typecheck/lint/test/build.
- [ ] **Step 3: Add `npx prisma validate` and production-build-equivalent step**.
- [ ] **Step 4: Add repository secret-pattern scan excluding fixtures that contain obvious fake CI values**.
- [ ] **Step 5: Run all new commands locally**; expect PASS.
- [ ] **Step 6: Commit** `ci: make frontend and production build mandatory`.

### Task 2: Protect main with required checks

**Files:**
- GitHub repository settings; no application-code file required.
- Document final rule in `docs/runbooks/GITHUB_BRANCH_PROTECTION.md`.

**Interfaces:**
- Protect branch `main`.
- Require pull request before merge.
- Require the canonical CI check from Task 1 and Vercel only if Vercel remains an intentional required deployment check.
- Block force pushes and branch deletion.
- Do not require stale historical check names that no longer run.

- [ ] **Step 1: List the exact check names emitted by a fresh PR after Task 1**.
- [ ] **Step 2: Enable branch protection using only those verified check names**.
- [ ] **Step 3: Attempt a non-destructive direct-main update from a test branch path and verify GitHub rejects it before changing main**.
- [ ] **Step 4: Open/merge a documentation-only test PR through the protected flow, then remove the temporary doc change if necessary**.
- [ ] **Step 5: Document the rule and recovery procedure for administrators**.
- [ ] **Step 6: Record `MAIN_PROTECTION=PASS`**.

### Task 3: Remove deterministic test flakiness

**Files:**
- Modify only tests/helpers proven flaky by repeated CI evidence.
- Candidate: `src/__tests__/integration/emailTabFrontend.test.ts`.

**Interfaces:**
- No global timeout increase as the first fix.
- Use deterministic setup/teardown, isolated ports/resources and explicit readiness.

- [ ] **Step 1: Reproduce each known flaky test in a loop of at least 20 runs under the same concurrency as CI**.
- [ ] **Step 2: Identify shared mutable state, cold-start setup or resource contention**.
- [ ] **Step 3: Write the smallest deterministic fix**.
- [ ] **Step 4: Re-run 20 times plus the full suite twice**.
- [ ] **Step 5: Commit each distinct flake fix separately**.

### Task 4: Unify redaction for logger and Sentry

**Files:**
- Create: `src/config/redaction.ts`
- Modify: `src/config/logger.ts`
- Modify: `src/config/sentry.ts`
- Create: `src/__tests__/unit/redaction.test.ts`

**Interfaces:**
- Produces `redact(value: unknown): unknown`.
- Exact sensitive names include authorization, cookie, set-cookie, x-admin-secret, x-jobs-secret, x-inbox-admin-secret, x-crm-read-secret, database_url, direct_url, bi_database_url, crm_upstream_read_secret, password, token, secret.
- Optional PII masking helper for phone/email in diagnostics.

- [ ] **Step 1: Write failing tests** for nested objects, arrays, mixed casing, cookies, DB URLs and PII masking.
- [ ] **Step 2: Run test**; expect FAIL.
- [ ] **Step 3: Implement common redaction**.
- [ ] **Step 4: Replace logger and Sentry local sanitizers**.
- [ ] **Step 5: Run focused tests/typecheck**; expect PASS.
- [ ] **Step 6: Commit** `security: unify log and Sentry redaction`.

### Task 5: Split liveness, readiness and integration health

**Files:**
- Modify: `src/routes/health.routes.ts`
- Create: `src/services/integrationHealthService.ts`
- Create: `src/__tests__/integration/healthRoutes.test.ts`
- Modify: `frontend/src/routes/health/HealthPage.tsx`

**Interfaces:**
- `GET /health`: no I/O, 200 when process lives.
- `GET /health/ready`: DB + required config only.
- `GET /health/integrations`: safe status/freshness for Meta, Nuvemshop, email, BI, Metabase, jobs and webhooks; no secret values.
- Keep `/health/deep` temporarily as compatibility alias to readiness until cleanup.

- [ ] **Step 1: Write failing route tests** for liveness independence, DB failure readiness 503, third-party degradation without liveness failure.
- [ ] **Step 2: Implement service and routes**.
- [ ] **Step 3: Update Health UI to consume the correct layer**.
- [ ] **Step 4: Run integration/frontend tests**; expect PASS.
- [ ] **Step 5: Commit** `feat(health): split liveness readiness and integrations`.

### Task 6: Add security headers

**Files:**
- Modify: `package.json`
- Modify: `src/index.ts`
- Create: `src/__tests__/integration/securityHeaders.test.ts`

**Interfaces:**
- Prefer `helmet` with explicit policy.
- CSP must allow required self assets and the approved Metabase frame origin.
- Add HSTS in production, X-Content-Type-Options, Referrer-Policy and Permissions-Policy.

- [ ] **Step 1: Write failing header tests** for HTML routes and API routes.
- [ ] **Step 2: Install/configure Helmet** with environment-safe defaults.
- [ ] **Step 3: Verify Metabase embed route/UI still works in preview**.
- [ ] **Step 4: Run integration tests**; expect PASS.
- [ ] **Step 5: Commit** `security: add HTTP security headers`.

### Task 7: Perform database pool capacity and index experiment

**Files:**
- Create: `docs/architecture/DATABASE_POOL_CAPACITY.md`
- Create: `scripts/ops/explain-inbox-conversations.sql`
- Modify schema only if evidence supports it.

**Interfaces:**
- Capacity formula documented: `max_instances × connection_limit <= safe_database_budget`.
- Candidate indexes are experimental until `EXPLAIN ANALYZE` proves benefit.

- [ ] **Step 1: Record current Cloud Run min/max instances, concurrency, production pool URL behavior and Supabase connection budget without exposing credentials**.
- [ ] **Step 2: Capture `EXPLAIN (ANALYZE, BUFFERS)` for the batched Inbox query in a safe environment**.
- [ ] **Step 3: Test candidate indexes on `orders(customerPhone)`, `chat_messages(conversationId, createdAt)`, and `chat_messages(conversationId, direction, createdAt)` one at a time**.
- [ ] **Step 4: Keep only indexes with measured benefit and acceptable write/storage cost; add Prisma migration if justified**.
- [ ] **Step 5: Load-test Inbox + dashboard + readiness concurrently and record p50/p95 plus pool timeouts**.
- [ ] **Step 6: Commit evidence and any justified migration separately**.

### Task 8: Make documentation canonical

**Files:**
- Rewrite: `README.md`
- Create: `docs/handoff/CURRENT_STATE.md`
- Create folders as needed: `docs/architecture/`, `docs/runbooks/`, `docs/archive/2026-09/`
- Move/archive historical handoffs without losing history.

**Interfaces:**
- README describes current Central, not old MVP-only state.
- CURRENT_STATE includes main SHA, live revision, rollback, active flags, active secrets by version name only, open debts and canonical URLs.
- Historical handoffs are marked archive, not current truth.

- [ ] **Step 1: Write CURRENT_STATE from live evidence and repository state**.
- [ ] **Step 2: Rewrite README setup/architecture/test/deploy overview**.
- [ ] **Step 3: Add an archive index explaining that archived handoffs are historical evidence**.
- [ ] **Step 4: Search repository for stale claims such as “P0 Inbox pending”, “migration not applied” and outdated production revision; correct or archive them**.
- [ ] **Step 5: Commit** `docs: establish canonical current state`.

### Task 9: Close stale PR and execute gated cleanup when eligible

**Files:**
- Update: `docs/handoff/POST_CUTOVER_CLEANUP_PLAN_2026-09-28.md`
- GitHub action: close PR #67 with explicit `OBSOLETE_DISCARD` rationale after confirming no newer decision supersedes it.

- [ ] **Step 1: Close PR #67 with a comment linking the consent/LGPD decision; do not merge it**.
- [ ] **Step 2: Verify the required stability windows before removing preview, Vercel BI, legacy routes or old secrets**.
- [ ] **Step 3: Execute cleanup one item at a time with before-state, rollback and smoke**.
- [ ] **Step 4: Update CURRENT_STATE after each irreversible cleanup**.
- [ ] **Step 5: Record `CI_CANONICAL=PASS`, `PRODUCTION_BUILD_GATE=PASS`, `TESTS_DETERMINISTIC=PASS`, `REDACTION=PASS`, `HEALTH_MODEL=PASS`, `CURRENT_STATE_DOC=PASS`, `STALE_PR_CLEANUP=PASS`.



### Task 10: Remediate BI semantic debt without fabricating history

**Files:**
- Create: `docs/sql/bi/00-export-current-view-definitions.sql`
- Create: `docs/sql/bi/10-bi-semantic-fixes.sql`
- Modify: `docs/handoff/METABASE_SEMANTIC_AUDIT_2026-09-28.md`
- Modify: `src/services/metabaseEmbed.ts` only after each dashboard becomes fully approved
- Modify: `src/__tests__/integration/biRoutes.test.ts`
- Modify: `frontend/src/lib/__tests__/biMetrics.test.ts` when metric names/formulas change

**Interfaces:**
- First export every current `bi_*` view with `pg_get_viewdef` before modifying it.
- Daily business dates use `America/Sao_Paulo`, not UTC day boundaries, for new corrected views.
- `purchased_after_contact` is never exposed as causal conversion; retain a compatibility alias only if required and introduce a factual name such as `orders_with_contact_recorded`.
- Historical WhatsApp consent before the forward-only ledger from the Consent Truth plan is **not reconstructible**; charts must show “historical unavailable before <ledger start>” rather than applying current consent state to old dates.
- Metabase card remediation uses admin UI/API, not direct writes to Metabase application tables.
- Known card work: fix 42, 43, 44, 48, 50, 51; hide/rebuild 49; re-audit before adding any dashboard alias to `METABASE_SEMANTICALLY_APPROVED`.

- [ ] **Step 1: Export and commit current production view definitions** without data rows or credentials.
- [ ] **Step 2: Write failing BI contract tests** for São Paulo day boundaries, correct failure-rate denominator, factual contact-linked-order naming, and explicit unavailable historical consent.
- [ ] **Step 3: Create corrected view SQL** and apply first to a read-only validation environment or transaction-safe staging copy.
- [ ] **Step 4: Run boundary probes around 21:00–23:59 Brasília and verify rows fall on the intended local business date**.
- [ ] **Step 5: Update Metabase cards 42/43/44/48/50/51 and hide/rebuild 49 through supported Metabase administration**.
- [ ] **Step 6: Re-run the semantic audit; only dashboards whose every visible card is KEEP may be added to `METABASE_SEMANTICALLY_APPROVED`**.
- [ ] **Step 7: Run BI integration/frontend metric tests and a visual smoke of the BI page**.
- [ ] **Step 8: Commit SQL, tests and updated semantic audit** as `fix(bi): remediate semantic and timezone debt`.
