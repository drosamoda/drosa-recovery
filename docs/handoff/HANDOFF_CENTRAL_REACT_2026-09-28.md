# HANDOFF — Central React (D'Rosa) — 28/09/2026

**Leia isto primeiro.** Estado: código completo e preview isolado no ar; **cutover NÃO feito**; `main` intocada.

## Onde está
- Repo `drosamoda/drosa-recovery`, branch **`feat/central-react`** (worktree `C:\Users\peter\OneDrive\Área de Trabalho\claude -meta ads\drosa-recovery`). Nunca commitar em `main`; outras frentes usam worktrees paralelos.
- Preview: **https://drosa-central-preview-1082403977536.us-central1.run.app/crm-next/** (serviço Cloud Run `drosa-central-preview`, us-central1, min 0/max 2, SA `drosa-central-preview@gtm-m4sqc99b-nzjjz.iam.gserviceaccount.com`).
  - Login: e-mail `preview-temp@drosamoda.test`; senha em `gcloud secrets versions access latest --secret=drosa-central-preview-login --project=gtm-m4sqc99b-nzjjz` (linha 2). Temporária — trocar antes do cutover.
  - Legado também funciona: segredo `drosa-crm-read-secret`.
- Live `drosa-recovery`: 100% em **`drosa-recovery-inbox-rot-v3`** (mesma imagem/env da anterior `email-compliance-v1`, só INBOX v3).

## Linha do tempo (commits)
| Fase | Commit | O quê |
|---|---|---|
| A | (anteriores) | Foundation, Dashboard, Cliente 360, Jornada |
| B | 5271d8d | Mensagens + Conversas |
| C | 03f9422 | Recovery |
| D | f379f8b | Campanhas & IA, E-mail, Saúde, Auditoria |
| E | 153c52c | Semântica + preflight de segurança |
| F | a08c748 | BI & Inteligência (views bi_*, Metabase embed) |
| G | d4e4ae0 | Sessão única (flag) + preview readiness |
| H | 3a8a356 | IDs Metabase verificados, trusted IP, pacote de mudanças |
| I | 9399e83 (+ docs) | Proxy GET upstream para o preview |

## Arquitetura
- Frontend `frontend/` (Vite+React+TS+Tailwind+React Query), servido pelo Express em `/crm-next`; `gcp-build` constrói o React.
- Backend: `/crm-api/*` somente GET para a Central; `/crm-api/bi/*` (views `bi_*`, transação READ ONLY, allowlist de datasets); `/crm-api/bi/embed/:alias` (Metabase assinado, allowlist executive=2, messages=3, consents=5, recovery=6, orders=7, integrations=8).
- Auth: `x-crm-read-secret` (legado, intacto) **ou** cookie `central_session` (`CENTRAL_SESSION_ENABLED`, bcrypt, HMAC, httpOnly/SameSite=Strict/Secure, rate limit 5/IP+e-mail e 20/IP por 15 min com IP confiável via `CENTRAL_TRUSTED_PROXY_HOPS`).
- Preview (`CRM_UPSTREAM_URL`): operacional via proxy GET para a API oficial; BI via `drosa_central_bi_reader`; sem credencial `postgres`.

## Recursos de produção criados/alterados nesta rodada (28/09)
| Recurso | Mudança |
|---|---|
| `drosa-recovery-inbox-admin-secret` | v3 criada; **v2 desabilitada** (valor v2 vazou na sessão de 27/09) |
| Serviço `drosa-recovery` | nova revisão `drosa-recovery-inbox-rot-v3` com 100% (imagem idêntica à anterior) |
| Postgres (Supabase) | role `drosa_central_bi_reader` (SELECT nas 12 `bi_*`, read-only default, limit 5, timeout 15 s) |
| Metabase app DB | `report_dashboard.enable_embedding=true` em 3,5,6,7,8 |
| Secret Manager | `drosa-central-session-secret`, `drosa-central-auth-users`, `drosa-central-preview-login`, `drosa-metabase-embed-key`, `drosa-central-bi-db-url` |
| IAM | SA `drosa-central-preview` (sem papéis de projeto; accessor em 5 secrets) |
| Cloud Run | serviço novo `drosa-central-preview` |
Nada foi alterado em domínio/URL oficial, `PUBLIC`, cron, webhooks, consentimento ou regras.

## Incidentes registrados (transparência)
1. 27/09: `INBOX_ADMIN_SECRET` v2 exposto na saída da sessão (alias `H` do PowerShell) → rotacionado em 28/09.
2. 27/09: sonda criou uma TEMP TABLE em produção (sessão, descartada) com a credencial `postgres` → preview nunca usa essa credencial.

## Débitos conhecidos (não bloqueiam preview)
- Views `bi_*` agrupam por dia UTC (BI_TIMEZONE_DEBT); consentimento atual aplicado a períodos passados (HISTORICAL_CONSENT_DEBT); `purchased_after_contact` ≠ conversão; KPIs internos dos dashboards Metabase não auditados; `ai/opportunities` p50 ≈ 5,6 s; título de oportunidade contraditório (`aiOpportunityEngine.ts:168`, `eligible || found`); `/inbox/conversations` 500 (pré-existente); limiter de login por instância.

## Próximo passo (Fase J — só com autorização)
Ver `CUTOVER_PLAN_2026-09-28.md`. Antes: dono loga no preview e revisa; senha definitiva; operador do inbox com v3; decidir débitos; decidir sobre `drosa-recovery-consent-sync-v1`.

## Gotchas operacionais
- Ferramentas: RTK reescreve `grep`/`npm` — usar binários diretos (`./node_modules/.bin/...`, `timeout`); `rm` com variável é bloqueado (usar caminho literal); PowerShell não diferencia maiúsculas em variáveis (`$p` = `$P`) e `H` é alias de `Get-History`.
- Processos: registrar PID+porta+comando; encerrar só por PID exato; nunca `taskkill /IM`.
- Supabase: pooler ignora `options=-c ...` (use `ALTER ROLE ... SET`); porta 5432 inacessível daqui, usar 6543 + `pgbouncer=true`.
- Vercel BI: env "Sensitive" não é legível (`vercel env pull` devolve `[SENSITIVE]`).
- Nunca digitar credenciais em host não-local no navegador; UI de regressão roda em Express local na config do preview.

## Documentos
`docs/handoff/`: `PHASE_I_PREVIEW_REPORT_2026-09-28.md`, `CUTOVER_PLAN_2026-09-28.md`, `PREVIEW_REGRESSION_MATRIX_2026-09-28.md`, `PHASE_H_PRODUCTION_CHANGE_PACKAGE_2026-09-28.md`, `AUTH_AND_PREVIEW_READINESS_2026-09-27.md`, `BI_MODULE_MIGRATION_REPORT_2026-09-27.md`, `DATA_QUALITY_SECURITY_PREFLIGHT_2026-09-27.md`, relatórios de migração B/C/D, `MASTER_HANDOFF_2026-09-27.md`.
