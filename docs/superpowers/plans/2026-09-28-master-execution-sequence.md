# D'Rosa Central Master Execution Sequence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the approved D'Rosa Central architecture in safe, independently testable stages: operational reliability, consent truth, Campaign Studio creative generation, channel activation, then engineering hardening.

**Architecture:** Keep `drosa-recovery` as the modular monolith. Each sub-plan ships independently and must leave production in a stable, rollbackable state before the next plan starts. Campaign generation is separated from campaign dispatch; AI never decides eligibility or bypasses human approval.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL/Supabase, React 18, Vite, TanStack Query, Cloud Run, Cloud Scheduler, Meta WhatsApp Cloud API, Resend, Nuvemshop, Google Cloud Storage, OpenAI image generation adapter.

**Spec:** `docs/superpowers/specs/2026-09-28-drosa-central-campaign-studio-design.md`

## Global Constraints

- Keep `drosa-recovery` as the single operational backend.
- Fail closed for irreversible actions.
- AI creates content; deterministic eligibility decides recipients; humans approve; dispatchers send.
- Never infer consent.
- Never invent product, stock, price, promotion, scarcity, conversion, or availability.
- Preserve Product Truth as Nuvemshop-backed source of product facts.
- Preserve WhatsApp template approval verification before dispatch.
- Do not combine operational reliability changes and Campaign Studio rollout in one production cutover.
- Never print secrets.
- Keep rollback, preview and frozen legacy surfaces until their explicit cleanup gate.

## Review Focus

1. Stale historical pending messages must not be bulk-sent when Scheduler is restored; queue audit and revalidation must prevent that.
2. Customers with transactional consent but no marketing consent must remain blocked from marketing remarketing.
3. Product-specific generated images must never be publishable without a verified product reference and fidelity approval.
4. A CampaignDraft must never transition to sendable state from AI output alone; admin approval remains mandatory.
5. A failed canary, pool timeout, new 5xx class, or secret/config drift must stop promotion and preserve rollback.

---

## Execution Order

### Plan 1 — Operational Reliability

Implement:
`docs/superpowers/plans/2026-09-28-operational-reliability.md`

Exit gates:

```text
JOBS_SECRET_ROTATED=PASS
TRANSACTIONAL_SCHEDULERS=PASS
PENDING_QUEUE_AUDITED=PASS
PROCESS_MESSAGES_FRESH=PASS
WEBHOOKS_STABLE=PASS
POOL_TIMEOUT=0
```

Do not start Plan 2 until these gates pass.

### Plan 2 — Consent Truth + Remarketing Eligibility

Implement:
`docs/superpowers/plans/2026-09-28-consent-truth-remarketing.md`

Exit gates:

```text
CONSENT_TRUTH_API=PASS
CHECKOUT_CAPTURE=PASS
MARKETING_CONSENT_NOT_INFERRED=PASS
REMARKETING_BLOCKERS_VISIBLE=PASS
REMARKETING_ELIGIBILITY_EXPLAINABLE=PASS
```

This plan may still end with zero eligible marketing recipients; zero is valid when the data says zero.

### Plan 3 — Campaign Studio Creative Core

Implement:
`docs/superpowers/plans/2026-09-28-campaign-studio-creative-core.md`

Exit gates:

```text
COPY_VARIANTS=PASS
IMAGE_PROVIDER=PASS
ASSET_STORAGE=PASS
PRODUCT_FIDELITY_GATE=PASS
CAMPAIGN_STUDIO_UI=PASS
NO_SEND_PATH=PASS
```

Creative generation remains non-dispatching.

### Plan 4 — Channel Activation + Results

Implement:
`docs/superpowers/plans/2026-09-28-channel-activation-results.md`

Exit gates:

```text
CENTRAL_ADMIN_WRITE_AUTH=PASS
EMAIL_SELECTED_CREATIVE=PASS
WHATSAPP_APPROVED_TEMPLATE_ONLY=PASS
CAMPAIGN_EXECUTOR_IDEMPOTENT=PASS
HUMAN_APPROVAL_REQUIRED=PASS
RESULT_ATTRIBUTION=PASS
```

Roll out email and WhatsApp separately.

### Plan 5 — Engineering Hardening

Implement:
`docs/superpowers/plans/2026-09-28-engineering-hardening.md`

Exit gates:

```text
CI_CANONICAL=PASS
PRODUCTION_BUILD_GATE=PASS
TESTS_DETERMINISTIC=PASS
REDACTION=PASS
HEALTH_MODEL=PASS
CURRENT_STATE_DOC=PASS
STALE_PR_CLEANUP=PASS
```

---

## Final Program Gate

- [ ] All five sub-plans report PASS on their exit gates.
- [ ] Production revision, image digest, rollback revision and main SHA are recorded.
- [ ] No unresolved P0 remains.
- [ ] Remaining P1/P2 debts are explicitly listed.
- [ ] Campaign Studio can generate real copy and real image assets without enabling send by accident.
- [ ] WhatsApp remarketing eligibility reflects proven marketing consent only.
- [ ] Transactional WhatsApp automation is scheduled, observable and stable.

