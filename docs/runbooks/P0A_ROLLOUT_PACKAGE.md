# Pacote de ativação P0A — WhatsApp transacional (runbook, NÃO executado)

Escrito em 2026-09-30 sobre `main` ≥ `9e30daf`. **Nada aqui foi executado.** Cada bloco `GATE` exige
autorização humana explícita. Produção hoje: 100 % em `drosa-recovery-p0-main-1c370a6`; nenhum Scheduler de
`process-messages`; só os 3 jobs de remarketing (13:00/13:10/13:20) ativos; `JOBS_OIDC_*` ausentes;
`CUSTOMER_INITIATED_RECOVERY_ENABLED` ausente (= false); `ENABLE_INTERNAL_CRON=false`;
`AUTOMATION_SEND_ENABLED=true`, `WHATSAPP_DRY_RUN=false`, `INBOX_SEND_DRY_RUN=false`,
allowlist com 12 templates.

Constantes: projeto `gtm-m4sqc99b-nzjjz` · região `us-central1` · serviço `drosa-recovery` ·
URL `https://drosa-recovery-lkuoxpyjlq-uc.a.run.app` · audience OIDC EXATA
`https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/jobs/process-messages` · SA `drosa-scheduler-invoker` ·
job `drosa-process-messages` · `*/2 * * * *` · `America/Sao_Paulo`.

Regras inegociáveis: nunca gravar `JOBS_SECRET` no Scheduler; nunca chamar `/jobs/process-messages` sem
`messageIds` em produção antes do Resume; fila só é processada por Scheduler depois de saneada; segredos
nunca impressos.

## Pré-requisitos (todos devem ser verdadeiros antes da Fase 1)
1. Canário WhatsApp PASS (um envio, `otherQueueMutations=0`, `duplicateSend=0`).
2. Extensão de consentimento corrigida publicada e persistência validada (PR #85 em `main`).
3. `main` verde no CI e o SHA a implantar anotado (`$SHA`).
4. Revisão anterior anotada para rollback: `PREV=drosa-recovery-p0-main-1c370a6`.

```powershell
$proj='gtm-m4sqc99b-nzjjz'; $reg='us-central1'; $svc='drosa-recovery'
$SHA = (git rev-parse origin/main); $short=$SHA.Substring(0,7); $PREV='drosa-recovery-p0-main-1c370a6'
$cand = "drosa-recovery-p0a-live-$short"; $tag='p0alive'
$base = "https://$tag---drosa-recovery-lkuoxpyjlq-uc.a.run.app"
```

## Fase 1 — Migration `automation_job_runs` (GATE: credencial admin + autorização)
A migration `20260928190000_add_automation_job_runs` é **aditiva** (2 enums + 1 tabela + 2 índices).
A role da aplicação não tem DDL: usar credencial admin fornecida pelo dono (nunca impressa).

```powershell
# 1.1 conferir ANTES (deve retornar 0 linhas)
#   select to_regclass('public.automation_job_runs');   -> NULL
# 1.2 aplicar (uma das duas formas; a SQL é a mesma do arquivo versionado)
npx prisma migrate deploy          # com DATABASE_URL/DIRECT_URL admin no ambiente do processo
#   ou: psql "$ADMIN_URL" -f prisma/migrations/20260928190000_add_automation_job_runs/migration.sql
# 1.3 verificar (somente catálogo, sem dados)
#   select to_regclass('public.automation_job_runs');
#   select indexname from pg_indexes where tablename='automation_job_runs';   -- 3 (pkey + jobKey_startedAt + status)
#   select typname from pg_type where typname in ('AutomationJobKey','AutomationJobStatus');  -- 2
```
Gate de saída: `SCHEMA_VERIFIED`. Sem ele, não implantar a revisão (a leitura é tolerante, mas siga a ordem).

## Fase 2 — Revisão nova a 0 % (GATE: autorização de deploy)
```powershell
$dst = "$env:TEMP\drosa-$short"; New-Item -ItemType Directory $dst | Out-Null
git archive --format=tar -o "$dst\s.tar" $SHA; tar -xf "$dst\s.tar" -C $dst; Remove-Item "$dst\s.tar"
gcloud run deploy $svc --source $dst --region $reg --project $proj --no-traffic --tag $tag `
  --revision-suffix "p0a-live-$short" --quiet
# NÃO setar JOBS_OIDC_* nem CUSTOMER_INITIATED_RECOVERY_ENABLED aqui. Env herdada da revisão live.
# Confirmar tráfego: live continua 100 % em $PREV; a nova tem só a tag.
(gcloud run services describe $svc --region $reg --project $proj --format=json | ConvertFrom-Json).status.traffic |
  Where-Object { $_.percent -or $_.tag -eq $tag } | ForEach-Object { "$($_.revisionName) tag=$($_.tag) $($_.percent)%" }
```

## Fase 3 — Smoke da revisão pela URL da tag (read-only, sem processar fila)
Esperado em cada linha (todos sem efeito colateral):
| Chamada | Esperado |
|---|---|
| `GET $base/health` | 200 |
| `GET $base/crm-next/` | 200 |
| `GET $base/crm-api/messages` sem credencial | 401 |
| `GET $base/crm-api/health` com `x-crm-read-secret` | 200, `jobFreshness` presente (array; `never_run` antes do Scheduler) |
| `POST $base/webhooks/nuvemshop/orders` sem HMAC | 400/401 |
| `POST $base/webhooks/meta` sem assinatura | 401/403 |
| `POST $base/jobs/process-messages` sem auth | 401 |
| `POST $base/jobs/process-messages` com segredo antigo inválido | 401 |
| `POST $base/jobs/process-messages` `{"messageIds":[]}` / >5 / tipo inválido | 400 `MESSAGE_IDS_INVALID` |
| `POST $base/jobs/process-customer-recovery` com segredo | 200 `{"enabled":false,...}` (flag desligada: nada faz) |
Reusar `p0a2-smoke.ps1` ajustando os nomes das revisões (ver histórico da sessão) e o `-BASEURL $base`.
Falha em qualquer linha → parar, não promover; a revisão segue a 0 %.

## Fase 4 — Dry-run da fila (GATE: autorização para chamar a revisão com o segredo de jobs)
Somente leitura: nenhum claim, update ou envio (provado por testes). Nunca usar a rota sem `-dry-run`.
```powershell
$jobs = gcloud secrets versions access latest --secret=drosa-recovery-jobs-secret --project=$proj
$r = Invoke-RestMethod -Method Post -Uri "$base/jobs/process-messages-dry-run" -Headers @{'x-jobs-secret'=$jobs}
$jobs = $null
$r | ConvertTo-Json -Depth 5     # só contagens; sem PII
```
Campos: `totalPending`, `totalCandidates`, `wouldExpire`, `wouldSkipTransactionalConsent`,
`wouldSkipMarketingConsent`, `wouldSkipPaymentCompleted`, `wouldRetryLater`, `wouldReachSendStage`,
`reachSendStageByTemplate`, `other/otherReasons`, `notEvaluated`
(`runtime_cooldown_lock`, `runtime_batch_limit`, `runtime_per_flow_send_caps`).
`wouldReachSendStage` = passaria por todos os gates AVALIADOS; **não** é a contagem exata do que será enviado.

Decisão sobre a fila antiga:
- `wouldReachSendStage > 0` → **não** processar em massa. Listar só contagens e templates; decidir caso a caso
  (canário por `messageIds` ≤ 5) antes de qualquer Resume.
- `wouldReachSendStage = 0` → preparar fechamento controlado (abaixo). Continua exigindo autorização.

### Fechamento controlado da fila antiga (somente se `wouldReachSendStage = 0`; GATE)
Regra A aprovada: mensagens sem validade viram `skipped` com razão, sem apagar e sem retry.
Executar por lotes com a própria lógica do processador (que já marca `message_expired`, consentimento
ausente e pagamento concluído como `skipped`) usando `messageIds` de até 5, **nunca** body vazio. Alternativa
mais simples e auditável: com o Scheduler ainda PAUSED, rodar lotes de 5 IDs listados pelo dry-run até
`totalCandidates = 0`. Após cada lote, conferir `skipped` (não `failed`) e que `sent` não aumentou.

## Fase 5 — OIDC: service account e Scheduler PAUSED (GATE)
Backend ainda SEM `JOBS_OIDC_*`: qualquer execução acidental recebe 401 e processa zero mensagens.
```powershell
pwsh -File scripts/ops/process-messages-scheduler-oidc.ps1 -Action Preflight
pwsh -File scripts/ops/process-messages-scheduler-oidc.ps1 -Action Create -DryRun   # revisar
pwsh -File scripts/ops/process-messages-scheduler-oidc.ps1 -Action Create           # SA -> actAs -> job -> PAUSED
pwsh -File scripts/ops/process-messages-scheduler-oidc.ps1 -Action Describe         # state=PAUSED
```

## Fase 6 — Configurar OIDC no serviço (nova revisão a 0 %) (GATE)
```powershell
gcloud run deploy $svc --region $reg --project $proj --no-traffic --tag oidc `
  --image <imagem da revisão $cand> --revision-suffix "p0a-oidc-$short" `
  --update-env-vars "JOBS_OIDC_AUDIENCE=https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/jobs/process-messages,JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS=drosa-scheduler-invoker@gtm-m4sqc99b-nzjjz.iam.gserviceaccount.com" --quiet
```
Smoke OIDC pela tag `oidc` (token emitido para a SA; nunca impresso):
| Caso | Esperado |
|---|---|
| ID token válido (audience exata, SA permitida) em `POST /jobs/process-messages-dry-run` | 200 |
| audience errada | 401 |
| SA não permitida | 401 |
| sem auth | 401 |
| `x-jobs-secret` inválido presente | 401 (sem fallback para OIDC) |
Usar a rota de dry-run para o teste positivo (não processa fila). Nunca testar com `process-messages` real.

## Fase 7 — Promover tráfego (GATE) só se Fases 3, 4 e 6 = PASS
```powershell
gcloud run services update-traffic $svc --region $reg --project $proj --to-revisions "drosa-recovery-p0a-oidc-$short=100"
# reobservar /health, /crm-api/health e 10 min de logs sem erro 5xx novo
```

## Fase 8 — Resume do Scheduler (GATE final)
Somente se TODOS: canário PASS · fila antiga saneada · dry-run seguro · OIDC PASS · rollback pronto.
```powershell
pwsh -File scripts/ops/process-messages-scheduler-oidc.ps1 -Action Resume
```
Acompanhar a primeira rodada: `AutomationJobRun` `completed`, `jobFreshness` fresco, nenhum envio inesperado,
pendentes caindo de forma coerente, `skipped/expired` coerentes, nenhum duplicado, sem pico de falhas do provedor.
**Anomalia → Pause imediato** (`-Action Pause`).

## Rollback (definido antes de executar qualquer fase)
| Situação | Comando |
|---|---|
| Tráfego | `gcloud run services update-traffic $svc --region $reg --project $proj --to-revisions "$PREV=100"` |
| Pausar Scheduler | `pwsh -File scripts/ops/process-messages-scheduler-oidc.ps1 -Action Pause` |
| Remover Scheduler | `... -Action Delete` |
| Env OIDC | `gcloud run deploy ... --remove-env-vars JOBS_OIDC_AUDIENCE,JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS` (nova revisão) ou voltar a `$PREV` |
| Migration | aditiva: **não** dropar a tabela em rollback operacional (a revisão anterior ignora a tabela) |

## Checklist de gates
`MIGRATION_READY → MIGRATION_APPLIED → SCHEMA_VERIFIED → REVISION_0PCT → SMOKE_PASS → DRYRUN_CAPTURED →
QUEUE_CLASSIFIED → SA_CREATED → SCHEDULER_PAUSED → OIDC_CONFIGURED_0PCT → OIDC_SMOKE_PASS → TRAFFIC_PROMOTED →
SCHEDULER_RESUMED → FIRST_RUN_OK`.
