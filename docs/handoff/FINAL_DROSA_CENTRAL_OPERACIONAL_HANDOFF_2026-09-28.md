# D'Rosa Central Operacional — Handoff final do cutover (28/09/2026)

## Estado
- **Cutover concluído.** URL canônica: `https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/crm` → `/crm-next/` (Central React). Sem domínio próprio no serviço.
- Serviço único de produção: Cloud Run `drosa-recovery` (us-central1). Revisão ativa: **`drosa-recovery-central-86c8047`** (100%), imagem `sha256:86b152ac3e9f2b4e68fe2d2d3303b34bd4f88c6d1a315a42f87fb65cd816a5cd`, construída de `main` = `86c8047` (PR #68).
- **Rollback:** `gcloud run services update-traffic drosa-recovery --region us-central1 --to-revisions drosa-recovery-inbox-rot-v3=100` (imagem anterior + INBOX v3; nunca reabilitar `drosa-recovery-inbox-admin-secret:2`). Alternativa sem troca de revisão: nova revisão com `CENTRAL_REACT_CANONICAL=false` (volta `/crm` e `/crm-v2` legados) e/ou `CENTRAL_SESSION_ENABLED=false` (volta ao segredo de leitura).

## Arquitetura final
`drosa-recovery` = Express + `/crm-api/*` (same-origin, somente GET para a Central) + React em `/crm-next` + WhatsApp/Meta + e-mail + Recovery + jobs (Cloud Scheduler; cron interno desligado) + BI (`/crm-api/bi/*` pelo role `drosa_central_bi_reader`, só 12 views `bi_*`, transação READ ONLY) + Metabase (motor analítico interno, signed embed com allowlist; só o dashboard 8 liberado — ver `METABASE_SEMANTIC_AUDIT_2026-09-28.md`).

## Auth
- Sessão única: cookie `central_session` (HttpOnly, Secure, SameSite=Strict, 12 h), usuário `drosamoda@gmail.com` (admin) em `drosa-central-auth-users:2`, chave `drosa-central-session-secret:1`, rate limit 5/IP+e-mail e 20/IP por 15 min (IP confiável via `CENTRAL_TRUSTED_PROXY_HOPS=1`).
- Legado `x-crm-read-secret` ainda aceito (rollback) — remover depois da janela.
- Trocar senha: `pwsh -File scripts/ops/set-central-password.ps1` → nova versão do secret → nova revisão apontando para ela.

## Segredos (estado)
| Secret | Estado |
|---|---|
| drosa-central-session-secret, drosa-central-auth-users(v2), drosa-metabase-embed-key, drosa-central-bi-db-url | ACTIVE_REQUIRED (produção + preview) |
| drosa-recovery-inbox-admin-secret v3 | ACTIVE_REQUIRED; v2 REVOKED (disabled); v1 LEGACY_PENDING_REMOVAL |
| drosa-central-auth-users v1, drosa-central-preview-login | LEGACY_PENDING_REMOVAL (credencial temporária de preview) |
| Vercel BI: DASHBOARD_AUTH_*, METABASE_*, DATABASE_URL, **RECOVERY_JOBS_SECRET** | LEGACY_PENDING_REMOVAL (ao aposentar o BI Vercel; depois rotacionar JOBS_SECRET) |

## Legados
- `/crm` e `/crm-v2`: **FROZEN** — redirecionam para a Central; UIs antigas em `/crm-legacy` e `/crm-v2-legacy` só para rollback.
- BI Vercel `drosa-recovery-bi-dashboard`: **FROZEN** (sem mudanças; ainda no ar como rollback analítico).
- `drosa-central-preview`: **ACTIVE_FOR_OBSERVATION**.

## Evidências do cutover
Freeze verificado 3× sem drift; smoke pré-tráfego e pós-corte 100% (health, UI, redirects, legados, auth, 14 rotas `/crm-api`, 6 datasets BI, embed 8, gates semânticos, jobs/webhooks/inbox sem credencial → 401); smoke de UI em produção logado (16 telas × 375/1440, refresh, logout, BI/embed, console limpo); webhooks reais Nuvemshop processados (200) após o corte.

## Backlog pós-projeto (não resolvido)
1. **P0 — `/inbox/conversations` 500 + pool Prisma de 1 conexão no runtime de produção**: a rota falha após ~10 s e prende a única conexão; chamadas concorrentes de `/crm-api` e `/health/deep` dão 500/503 nesse intervalo. Pré-existente (reproduzido na revisão antiga). Corrigir a query da rota e revisar `connection_limit` do runtime.
2. WEBHOOK_NUVEMSHOP_ERRORS (order/updated ~18,7% com erro em 30 d).
3. METABASE_CARD_FIXES (cards 42, 43, 44, 48, 50, 51; ocultar 49) antes de liberar os demais embeds.
4. BI_TIMEZONE_DEBT, HISTORICAL_CONSENT_DEBT, PURCHASED_AFTER_CONTACT_DEBT.
5. AI_OPPORTUNITIES_PERFORMANCE_DEBT (~5,6–6,5 s).
6. DISTRIBUTED_RATE_LIMIT_DEBT (limiter por instância).
7. KNOWN_FLAKY_TEST `emailTabFrontend.test.ts` (timeout de hook sob carga).
8. Título de oportunidade `eligible || found` (`aiOpportunityEngine.ts:168`).
9. Branch `feat/nuvemshop-current-consent-sync` / revisão `consent-sync-v1` (OBSOLETE_DISCARD para o corte; exige revisão LGPD própria).

Plano de limpeza: `POST_CUTOVER_CLEANUP_PLAN_2026-09-28.md`.
