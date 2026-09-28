# Campaign Channel Activation and Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect approved Campaign Studio drafts to the existing email and WhatsApp dispatch engines without bypassing consent, template approval, human approval, or idempotency, then surface factual results.

**Architecture:** Add Central session-based admin authorization for campaign writes. Email uses the existing executor and selected approved creative; WhatsApp converts a scheduled campaign into the existing remarketing scheduling path and still sends only through `processMessages` with approved templates. Results are linked back to CampaignDraft; generated WhatsApp copy remains a proposal unless it matches an approved template contract.

**Tech Stack:** Express, Prisma, Central session auth, existing email executor, remarketingService, processMessages, React Campaign Studio.

**Spec:** `docs/superpowers/specs/2026-09-28-drosa-central-campaign-studio-design.md`

## Global Constraints

- Human approval remains mandatory.
- Marketing consent and suppression are checked at dispatch time.
- WhatsApp sends only approved Meta templates.
- Generated free-form WhatsApp copy is never sent as an outbound marketing message.
- Email send gate and live consent revalidation remain unchanged.
- Channel rollouts are independent.

## Review Focus

1. A user whose session role changed from admin to read must lose write access without waiting for the old token expiry.
2. A CampaignDraft cannot schedule without selected strategy and APPROVED status.
3. An approved draft whose recipient loses consent before dispatch must not send.
4. Retrying a scheduled campaign executor must not duplicate EmailSend, RemarketingRun or MessageLog rows.
5. A WhatsApp generated message that differs from the approved template must be displayed as proposal-only, not “will be sent”.

---

### Task 1: Add Campaign Studio approval and scheduling controls

**Files:**
- Modify: `frontend/src/routes/campaigns/CampaignStudio.tsx`
- Modify: `frontend/src/routes/campaigns/__tests__/CampaignsPage.test.tsx`
- Modify: `frontend/src/lib/types.ts`
- Consume: `frontend/src/lib/api.ts` `apiPost` from the Creative Core plan

**Interfaces:**
- Select strategy -> existing `POST /crm-api/ai/campaigns/:id/select`.
- Approve -> existing `POST /crm-api/ai/campaigns/:id/approve`, with `approvedBy` taken from the authenticated Central session identity, not free text typed by the user.
- Schedule -> existing `POST /crm-api/ai/campaigns/:id/schedule`.
- Cancel -> existing `POST /crm-api/ai/campaigns/:id/cancel`.
- All writes already require `centralAdminAuth` from the Creative Core plan.

- [ ] **Step 1: Write failing UI tests** for state-dependent buttons: DRAFT cannot schedule, AWAITING_HUMAN_APPROVAL can select/approve, APPROVED can schedule, SCHEDULED can cancel.
- [ ] **Step 2: Write a failing test** proving `approvedBy` comes from the current session and is not an editable input.
- [ ] **Step 3: Run focused frontend tests**; expect FAIL.
- [ ] **Step 4: Implement mutations with React Query invalidation of campaign detail/list keys after success**.
- [ ] **Step 5: Render backend business-state errors without converting them into success or retry loops**.
- [ ] **Step 6: Run frontend tests/typecheck/lint**; expect PASS.
- [ ] **Step 7: Commit** `feat(campaigns): add human approval and scheduling controls`.

### Task 2: Select and publish an approved email creative asset

**Files:**
- Modify: `src/services/creative/creativeAssetService.ts`
- Create: `src/services/creative/creativeAssetPublicationService.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Create: `src/__tests__/unit/creativeAssetPublicationService.test.ts`

**Interfaces:**
- Env: `CREATIVE_PUBLIC_BASE_URL` default empty.
- Produces `publishSelectedCreativeAsset(draftId: string): Promise<string | null>`.
- Only selected asset with `fidelityStatus=PASS` may publish.
- Published object path: `published/<assetId>.<ext>`.
- Draft asset remains private; published URL contains no secret.

- [ ] **Step 1: Write failing tests** for no selected asset, non-PASS selected asset, publish success and idempotent republish.
- [ ] **Step 2: Run focused test**; expect FAIL.
- [ ] **Step 3: Implement copy-to-published storage operation and persist `publicUrl`**.
- [ ] **Step 4: Run test/typecheck**; expect PASS.
- [ ] **Step 5: Commit** `feat(email): publish approved campaign creative`.

### Task 3: Render selected creative in outbound email

**Files:**
- Modify: `src/services/emailCampaignExecutor.ts`
- Modify: `src/__tests__/unit/emailCampaignExecutor.test.ts`

**Interfaces:**
- Executor reads selected email strategy as today.
- If an approved selected asset exists, include `<img src="...">` with strategy alt text.
- If no asset is selected, existing text-only email remains valid.
- No image means no send failure.

- [ ] **Step 1: Write failing tests** for image HTML, alt text, text-only fallback and no unsafe URL.
- [ ] **Step 2: Run focused tests**; expect FAIL.
- [ ] **Step 3: Integrate Task 2 publication lookup** before composing outbound HTML.
- [ ] **Step 4: Preserve unsubscribe headers/footer and all current send gates**.
- [ ] **Step 5: Run email executor/dispatcher tests**; expect PASS.
- [ ] **Step 6: Commit** `feat(email): render selected campaign creative`.

### Task 4: Link WhatsApp campaigns to remarketing runs

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_link_campaign_remarketing_runs/migration.sql`
- Modify: `src/services/remarketingService.ts`
- Create: `src/services/whatsappCampaignExecutor.ts`
- Create: `src/__tests__/unit/whatsappCampaignExecutor.test.ts`

**Interfaces:**
- Add nullable `campaignDraftId` to `RemarketingRun`, indexed.
- `remarketingSend(segment, options?: { campaignDraftId?: string })` preserves existing callers.
- Produces `runScheduledWhatsappCampaign(draftId: string): Promise<CampaignExecutionResult>`.
- Opportunity type maps to the same canonical segment mapping already used by `campaignService`.

- [ ] **Step 1: Write failing tests** proving draft must be SCHEDULED+WHATSAPP, segment mapping, idempotent retry and campaignDraftId linkage.
- [ ] **Step 2: Run focused test**; expect FAIL.
- [ ] **Step 3: Add migration and optional linkage support**.
- [ ] **Step 4: Implement executor calling existing `remarketingSend`, never bypassing its eligibility gates**.
- [ ] **Step 5: Run remarketing and executor tests**; expect PASS.
- [ ] **Step 6: Commit** `feat(whatsapp): execute scheduled campaign via remarketing engine`.

### Task 5: Add a campaign executor job

**Files:**
- Create: `src/jobs/processCampaignDrafts.ts`
- Modify: `src/routes/jobs.routes.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Create: `src/__tests__/unit/processCampaignDrafts.test.ts`
- Modify: `src/__tests__/integration/aiCampaignsRoutes.test.ts`

**Interfaces:**
- Env `CAMPAIGN_EXECUTOR_ENABLED=false` default.
- `runProcessCampaignDrafts()` processes SCHEDULED drafts in small batches.
- EMAIL delegates to existing `runEmailCampaignExecutor` behavior or channel-specific helper without duplicating recipient logic.
- WHATSAPP delegates to Task 4.
- Completed/failed state is persisted idempotently.

- [ ] **Step 1: Write failing tests** for global gate closed, email delegation, WhatsApp delegation, retry idempotency and channel isolation.
- [ ] **Step 2: Run focused test**; expect FAIL.
- [ ] **Step 3: Implement job and `POST /jobs/process-campaign-drafts`**.
- [ ] **Step 4: Keep executor gate false by default and add the job key to the automation-job telemetry introduced by the Operational Reliability plan**.
- [ ] **Step 5: Extend the safe Scheduler reconciliation script with `drosa-process-campaign-drafts` at `*/5 * * * *`, but keep that Scheduler paused until the channel rollout task explicitly enables it**.
- [ ] **Step 6: Run focused tests/integration/typecheck**; expect PASS.
- [ ] **Step 7: Commit** `feat(campaigns): add channel campaign executor`.

### Task 6: Make WhatsApp template truth explicit in the Studio UI

**Files:**
- Modify: `frontend/src/routes/campaigns/CampaignStudio.tsx`
- Modify: `frontend/src/routes/campaigns/CreativeVariantCard.tsx`
- Modify: `frontend/src/routes/campaigns/__tests__/CampaignsPage.test.tsx`

**Interfaces:**
- WhatsApp strategy shows two separate fields:
  - `Generated proposal`
  - `Approved template that will actually be sent`
- If the generated proposal is not an approved template contract, label `PROPOSAL_ONLY`.
- Schedule button communicates template name verified by backend.

- [ ] **Step 1: Add failing UI test** proving proposal text is not labeled as actual send body.
- [ ] **Step 2: Implement explicit template/proposal presentation**.
- [ ] **Step 3: Run frontend tests/typecheck/lint**; expect PASS.
- [ ] **Step 4: Commit** `fix(campaigns): distinguish WhatsApp proposal from send template`.

### Task 7: Add factual campaign result summary

**Files:**
- Create: `src/services/campaignResultsService.ts`
- Modify: `src/routes/aiCampaigns.routes.ts`
- Create: `src/__tests__/unit/campaignResultsService.test.ts`
- Modify: `frontend/src/routes/campaigns/CampaignStudio.tsx`
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- `getCampaignResults(draftId)` returns channel-specific factual metrics.
- Email: queued/sent/delivered/bounce/complaint/unsubscribe/open/click only where stored.
- WhatsApp: scheduled/accepted/delivered/read/failed/replied where deterministically linked.
- No causal conversion claim.
- Route: `GET /crm-api/ai/campaigns/:id/results`.

- [ ] **Step 1: Write failing service tests** for email, WhatsApp, missing data and no causal conversion field.
- [ ] **Step 2: Run focused tests**; expect FAIL.
- [ ] **Step 3: Implement aggregation over existing EmailSend/EventLog and linked RemarketingRun/MessageLog evidence**.
- [ ] **Step 4: Add read route and UI result section**.
- [ ] **Step 5: Run focused backend/frontend tests**; expect PASS.
- [ ] **Step 6: Commit** `feat(campaigns): show factual campaign results`.

### Task 8: Roll out channels separately

**Files:**
- Evidence notes only.

- [ ] **Step 1: Deploy all code with `CAMPAIGN_EXECUTOR_ENABLED=false`**; smoke creation/approval/scheduling without dispatch.
- [ ] **Step 2: Enable email executor only for the existing capped pilot and prove recipient gates still block non-eligible recipients**.
- [ ] **Step 3: Observe email delivery/webhook behavior before any wider scope**.
- [ ] **Step 4: Enable WhatsApp campaign executor separately; run one approved segment with proven marketing consent**.
- [ ] **Step 5: Verify the message body sent by Meta corresponds to the approved template contract, not free-form proposal copy**.
- [ ] **Step 6: Record `CENTRAL_ADMIN_WRITE_AUTH=PASS`, `EMAIL_SELECTED_CREATIVE=PASS`, `WHATSAPP_APPROVED_TEMPLATE_ONLY=PASS`, `CAMPAIGN_EXECUTOR_IDEMPOTENT=PASS`, `HUMAN_APPROVAL_REQUIRED=PASS`, `RESULT_ATTRIBUTION=PASS`.

