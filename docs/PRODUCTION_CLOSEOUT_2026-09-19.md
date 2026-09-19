# D'Rosa Recovery — Production Closeout

Date: 2026-09-19

This document is the release closeout checklist for `drosa-recovery`.

## Code baseline

- Main commit at start of closeout: `088fe0549432af1d8ed7a60199343df49bd1abcd`.
- PR #48 is merged and clears stale dry-run metadata after a real WhatsApp send.
- Real-send fail-closed behavior remains unchanged.

## Verified production state

- Cloud Run service: `drosa-recovery`, project `gtm-m4sqc99b-nzjjz`, region `us-central1`.
- Runtime memory validated at 1 GiB after remarketing preview exceeded the prior 512 MiB limit.
- Database reachable.
- Prisma migrations applied.
- Canonical recovery configuration reconciled with zero drift.
- Canonical Meta template contracts pass health verification.
- Controlled real send completed once and reached `read` status.
- Message queue returned to zero pending / zero processing.
- Production gates returned to fail-closed:
  - `ENABLE_INTERNAL_CRON=false`
  - `AUTOMATION_SEND_ENABLED=false`
  - `ABANDONED_CART_ENABLED=false`
  - `REMARKETING_ENABLED=false`
  - `WHATSAPP_DRY_RUN=true`
  - `INBOX_SEND_DRY_RUN=true`
  - `AUTOMATION_ALLOWED_TEMPLATES` empty

## Required closure evidence

The project is considered closed only after all items below are evidenced:

- [x] Full CI succeeds: GitHub Actions CI runs #165 and #168 passed typecheck, lint, unit, integration, build, NubeSDK typecheck/tests/build.
- [ ] Checkout consent E2E verified for GRANTED, UNKNOWN and REVOKED.
- [x] Existing `order.extra` preservation is covered by the active NubeSDK v2 implementation and passing extension tests; D'Rosa keys overlay the existing object without deleting unrelated keys.
- [x] Suppression / opt-out overrides GRANTED consent; an explicit regression test is included in the closeout branch and CI #168 passes.
- [ ] DATABASE_URL and DIRECT_URL are sourced from Google Secret Manager in the production revision.
- [ ] Cloud Scheduler jobs are configured using protected `/jobs` routes; internal cron remains disabled.
- [ ] Initial production automation scope is explicitly allowlisted and rate-limited.
- [ ] Monitoring/alerting covers Cloud Run failures, OOM/resource pressure, automation `unknown` / `failed` and unhealthy preflight.
- [ ] Final `automation-health` is healthy and queue has no unexpected pending/processing rows.
- [ ] Temporary jobs, tags, local files and diagnostic revisions are removed or intentionally retained for rollback.

## Activation policy

Marketing automations must remain disabled until checkout consent E2E is complete. Historical customers without explicit evidence remain UNKNOWN and must not be upgraded to GRANTED.

Transactional/UTILITY automation may be activated only with:
- an explicit template allowlist,
- `WHATSAPP_DRY_RUN=false`,
- `AUTOMATION_SEND_ENABLED=true`,
- a bounded per-run rate,
- a healthy preflight immediately before activation,
- and a scheduler that can be paused independently.

## Rollback

Rollback must preserve:
- the previous known-good Cloud Run revision,
- fail-closed send gates,
- message idempotency,
- Meta message identifiers and terminal statuses,
- consent and suppression records.

No bulk or historical marketing send is part of project closeout.
