# Consent Truth and Remarketing Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WhatsApp consent coverage and remarketing blockers explainable in the Central, verify checkout capture, and keep marketing recipients blocked unless marketing consent is proven.

**Architecture:** Build a read-only Consent Truth projection from existing `Customer`, `WhatsappConsent`, `Suppression` and remarketing eligibility logic. Reuse the current checkout extension and remarketing engine; do not create a parallel consent store or infer consent from transactional events.

**Tech Stack:** Prisma, Express CRM API, React Campaigns page, NubeSDK checkout extension, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-drosa-central-campaign-studio-design.md`

## Global Constraints

- Transactional and marketing consent remain independent scopes.
- Unknown marketing consent is blocked, not converted to false proof or granted.
- Suppression/opt-out always wins.
- No backfill/sync branch is merged without separate LGPD review.
- PII remains masked in CRM responses.

## Review Focus

1. A phone with transactional granted and marketing unknown must count as transactional only and remain marketing-ineligible.
2. A marketing consent later revoked must leave the active marketing count immediately.
3. Suppressed contacts with active consent must still be blocked from remarketing.
4. A checkout where neither box was touched must remain UNKNOWN, not revoked or granted.
5. Coverage calculations must deduplicate by normalized phone.

---

### Task 1: Create the Consent Truth service

**Files:**
- Create: `src/services/whatsappConsentTruthService.ts`
- Create: `src/__tests__/unit/whatsappConsentTruthService.test.ts`

**Interfaces:**
- Produces: `getWhatsappConsentTruth(): Promise<WhatsappConsentTruth>`
- `WhatsappConsentTruth` includes `phonesKnown`, `transactional.active`, `marketing.active`, `marketing.revoked`, `marketing.unknown`, `suppressed`, `remarketingEligibleBase`, `marketingCoveragePct`, `bySource`.
- Counts are deduplicated by `normalizedPhone`.

- [ ] **Step 1: Write failing tests** for parallel scopes, revocation, suppression precedence, unknown scope and deduplication.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/unit/whatsappConsentTruthService.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** the service using existing tables only; no raw `Order.rawPayload` is returned.
- [ ] **Step 4: Run focused tests and typecheck**; expect PASS.
- [ ] **Step 5: Commit** `feat(consent): add WhatsApp consent truth projection`.

### Task 2: Extend CRM consent response with summary

**Files:**
- Modify: `src/services/crmReadService.ts`
- Modify: `src/__tests__/unit/crmReadService.test.ts`
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- Existing `GET /crm-api/consents` response becomes `{ data, pagination, summary }`.
- `summary` is the Task 1 projection.
- Existing `data` shape remains unchanged.

- [ ] **Step 1: Add failing CRM read test** proving `summary` is present and PII-free while pagination remains compatible.
- [ ] **Step 2: Run focused test**; expect FAIL.
- [ ] **Step 3: Call Task 1 service** from `crmReadService.consents`.
- [ ] **Step 4: Add frontend types** for the summary.
- [ ] **Step 5: Run focused test/typecheck**; expect PASS.
- [ ] **Step 6: Commit** `feat(crm): expose WhatsApp consent summary`.

### Task 3: Show Consent Truth and remarketing blockers in Campaigns

**Files:**
- Create: `frontend/src/routes/campaigns/ConsentCoveragePanel.tsx`
- Modify: `frontend/src/routes/campaigns/CampaignsPage.tsx`
- Modify: `frontend/src/routes/campaigns/__tests__/CampaignsPage.test.tsx`

**Interfaces:**
- Add tab `WhatsApp` or `Consentimento` alongside existing campaign tabs.
- Reads `GET /crm-api/consents?page=1&pageSize=1` for summary and existing `ai/opportunities?channel=whatsapp`.
- Shows population, transactional active, marketing active, suppressed, marketing unknown, marketing coverage and blocker breakdown.

- [ ] **Step 1: Write frontend test** proving transactional-only users are not displayed as marketing-ready and zero eligible is rendered as a valid state.
- [ ] **Step 2: Run focused frontend test**; expect FAIL.
- [ ] **Step 3: Build the panel** with StatCards and blocker bars using existing design system.
- [ ] **Step 4: Add explanatory copy**: “Elegibilidade de marketing exige consentimento marketing comprovado; consentimento transacional não substitui marketing.”
- [ ] **Step 5: Run frontend test, lint and typecheck**; expect PASS.
- [ ] **Step 6: Commit** `feat(campaigns): show WhatsApp consent coverage`.

### Task 4: Lock checkout-consent behavior with extension tests

**Files:**
- Modify: `whatsapp-consent-checkout/src/consent.test.ts`
- Modify only if test proves a bug: `whatsapp-consent-checkout/src/consent.ts`

**Interfaces:**
- Existing marker constants and scopes remain unchanged.
- Untouched checkbox => no decision persisted.
- Explicit unchecked after previous granted => revoked.

- [ ] **Step 1: Add tests** for untouched checkout, one-scope-only choice, both scopes, persisted revisit, and explicit revoke.
- [ ] **Step 2: Run** `npm test --prefix whatsapp-consent-checkout`; expect current behavior to either PASS or expose a specific bug.
- [ ] **Step 3: If a test fails because implementation is wrong, make the minimal fix**; otherwise make no production-code edit.
- [ ] **Step 4: Run extension typecheck/test/build**; expect PASS.
- [ ] **Step 5: Commit** test-only or minimal fix as `test(consent): lock checkout opt-in semantics`.

### Task 5: Add a consent-source diagnostics view

**Files:**
- Modify: `src/services/whatsappConsentTruthService.ts`
- Modify: `src/__tests__/unit/whatsappConsentTruthService.test.ts`
- Modify: `frontend/src/routes/campaigns/ConsentCoveragePanel.tsx`

**Interfaces:**
- `bySource` returns source + active transactional + active marketing + revoked counts.
- No phone identifiers.

- [ ] **Step 1: Add failing tests** for source aggregation.
- [ ] **Step 2: Implement source aggregation** from `WhatsappConsent.source`.
- [ ] **Step 3: Render source coverage table** in the Central.
- [ ] **Step 4: Run focused backend/frontend tests**; expect PASS.
- [ ] **Step 5: Commit** `feat(consent): expose consent source diagnostics`.

### Task 6: Validate real capture and remarketing eligibility

**Files:**
- Add evidence note under `docs/handoff/`.

**Interfaces:**
- No data mutation beyond ordinary live checkout behavior.

- [ ] **Step 1: Deploy the read-only consent summary changes through preview and 0% revision**.
- [ ] **Step 2: Confirm recent live checkouts with explicit choices produce `WhatsappConsent` rows with the expected source and scope**.
- [ ] **Step 3: Confirm untouched checkouts do not create granted marketing consent**.
- [ ] **Step 4: Run remarketing preview for every segment** and reconcile `found = eligible + blocked`.
- [ ] **Step 5: Confirm a marketing-unknown phone is blocked with `consent_unproven`**.
- [ ] **Step 6: Record `CONSENT_TRUTH_API=PASS`, `CHECKOUT_CAPTURE=PASS`, `MARKETING_CONSENT_NOT_INFERRED=PASS`, `REMARKETING_BLOCKERS_VISIBLE=PASS`, `REMARKETING_ELIGIBILITY_EXPLAINABLE=PASS`.

