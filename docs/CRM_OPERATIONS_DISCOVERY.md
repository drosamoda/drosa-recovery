# D'Rosa Recovery — CRM Operations Discovery

## CURRENT_ARCHITECTURE_MAP

- Express/TypeScript API (`src/index.ts`), Prisma/PostgreSQL (`prisma/schema.prisma`) and static Inbox (`public/inbox`).
- Meta and Nuvemshop webhooks are isolated from protected operator and job routes.
- `runProcessMessages` remains the only automation dispatch pipeline and is not called by this CRM.
- Operator authentication uses the dedicated `crmAuth` boundary and `CRM_READ_SECRET`, without fallback to Inbox, admin or jobs credentials.

## CURRENT_SCHEMA_MAP

- Customer truth: `customers`, `orders`, `abandoned_checkouts`.
- Messaging truth: `message_logs`; Inbox truth: `contacts`, `conversations`, `chat_messages`.
- Policy truth: `whatsapp_consents`, `suppressions`, `customers.optOut`, `contact_frequency_locks`.
- Configuration: `automation_rules`, `whatsapp_templates`.
- Remarketing audit: `remarketing_runs`, `remarketing_recipients`.
- Integration evidence: `webhook_events` and environment gates exposed only as booleans.

## EXISTING_UI_MAP

- `/inbox` is a conversation UI with write controls.
- `/admin/*` provides limited JSON listings and includes mutations.
- There was no unified read-only CRM, dashboard, paginated customer/message views, message detail, health evidence or failure normalization.

## REUSE_MATRIX

| Capability | Existing authority reused |
| --- | --- |
| Sends and delivery | `message_logs` |
| Conversation timeline | `conversations`, `chat_messages` |
| Customer/order/checkout | existing Prisma models |
| Checkout eligibility | `evaluateAbandonedCheckoutEligibility()` |
| Consent/opt-out/suppression | existing independent concepts |
| Rules/templates | existing models |
| Runtime state | existing environment gates |
| Health/audit | message and webhook evidence |

## MISSING_CAPABILITIES

- Read-only, paginated contracts covering the operator surface.
- PII masking at list API boundaries.
- Failure classification that preserves raw reason/error code.
- Unified dashboard, details, customer 360, payment, health and audit views.
- A complete actor/action/before/after audit log does not exist; the CRM reports this gap honestly.

## PROPOSED_PAGE_MAP

One authenticated SPA at `/crm`: Dashboard, Clientes, Conversas, Envios, Carrinho abandonado, Pix, Boleto, Remarketing, Automações, Templates, Consentimentos, Saúde and Auditoria. Details load on demand in a drawer.

## PROPOSED_SERVER_CONTRACTS

Protected read-only `/crm-api/*` endpoints with server-side pagination, filters and search. List responses mask phone/email. Raw payloads are excluded from lists and are not exposed by default in details.

`CRM_READ_SECRET` is required at runtime for CRM access. It grants access only to `/crm-api` and is sent by the browser solely in the `x-crm-read-secret` header.

Dashboard time sources are semantic: message creation uses `message_logs.createdAt`; sends and contacted customers use `sentAt`; inbound uses `chat_messages.timestamp` with documented fallback to `createdAt` only when the provider timestamp is absent; abandonment uses `abandonedAt`; conversion uses `convertedAt`; Pix/boleto orders use `sourceCreatedAt`. Delivery/read time remains `NOT_AVAILABLE` because no dedicated persisted timestamp exists.

## MIGRATION_REQUIREMENTS

`NONE`. Existing data supports the visibility layer. The complete audit ledger remains a documented future gap.

## SECURITY_RISKS

- PII leakage: mask list fields and omit raw payloads.
- Accidental sends: no write controls and no CRM route imports jobs/senders.
- False health: show evidence/freshness or `NOT_AVAILABLE`.
- Status regression: display `read > delivered > sent` without writing status.
- Large tables: bounded server-side `skip/take` plus count.

## IMPLEMENTATION_PLAN

1. CRM-A: Dashboard, Central de Envios and message detail.
2. CRM-B: Customers, Customer 360 and conversations read-only.
3. CRM-C: Checkout, Pix, boleto and remarketing visibility.
4. CRM-D: Rules, templates, consent, health and audit gap.
5. Test mappings, masking, pagination, auth and no-send invariants.
6. Run Prisma validation/generation, typecheck, lint and the full test suite. No production deploy.
