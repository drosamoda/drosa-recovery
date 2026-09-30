# Runbook — Telemetria dos jobs (AutomationJobRun) e ordem de rollout

Reconcilia o que faltava do PR #73 sobre a `main` atual. **Não** cria Scheduler,
**não** aplica migration e **não** usa `JOBS_SECRET` em nenhum script.

## O que entra
- Tabela `automation_job_runs` (migration aditiva, NÃO aplicada por este PR).
- `withJobTelemetry` envolve `process-messages`, `sync-abandoned-checkouts` e a
  nova rota `POST /jobs/sync-boleto-expiring`. O processador continua intocado
  (gates, `messageIds` ≤ 5, consentimento, expiração): a telemetria só observa.
- Saúde (`/crm-api/health`) e `/jobs/automation-health` expõem `jobFreshness`.
- `npm run ops:pending-queue:audit`: agregados da fila, sem PII, somente leitura.

## Semântica (duas dimensões independentes)
| Campo | Pergunta | Valores |
|---|---|---|
| `timing` | a última execução começou dentro do limiar? | `fresh` · `stale` · `never_run` |
| `lastResult` | como a última execução terminou? | `completed` · `failed` · `running` · `null` |
| `healthy` | `timing = fresh` **e** `lastResult ≠ failed` | boolean |

Um job `fresh` cuja última execução falhou **não** é "Em dia". `jobFreshness = null`
significa telemetria indisponível (tabela ausente ou banco falhou) e nunca é
mostrado como "Em dia". Limiares: process-messages 3 min, sync-abandoned-checkouts
45 min, sync-boleto-expiring 120 min. `ENABLE_INTERNAL_CRON=false` sozinho não é
incidente.

## Privacidade
- Nunca persistir/logar `error.message`: só categoria fechada
  (`database_unreachable`, `upstream_timeout`, `upstream_rate_limited`,
  `validation_error`, `unexpected_error`).
- `summary` guarda apenas números, booleanos e um vocabulário fechado de strings;
  chaves com phone/email/payload/header/secret/token/address/customer/name são descartadas.

## Ordem de rollout (gates, um de cada vez)
1. `MIGRATION_READY` — SQL revisado (`prisma/migrations/20260928190000_add_automation_job_runs`).
2. `MIGRATION_APPLIED` — aplicada por quem tem credencial admin, com autorização explícita.
3. `SCHEMA_VERIFIED` — `automation_job_runs` e os 2 enums existem (consulta de catálogo, sem dados).
4. `REVISION_DEPLOYED` — só agora uma revisão que consulta a tabela (0% de tráfego primeiro).
5. `SMOKE_PASS` — `GET /crm-api/health` devolve `jobFreshness` e a Saúde mostra o cartão.

Até o gate 3, uma revisão com este código continua segura: a leitura é tolerante
(`jobFreshness: null`) e a gravação é best-effort. Ainda assim, não promova antes da migration.

## Scheduler (fora deste PR)
Só via OIDC: `scripts/ops/process-messages-scheduler-oidc.ps1` (cria pausado,
audience exata do endpoint). Nunca reintroduzir header estático com `JOBS_SECRET`.
