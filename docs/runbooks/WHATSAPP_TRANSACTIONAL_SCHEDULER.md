# Runbook — Scheduler dos jobs transacionais de WhatsApp

Cobre `process-messages`, `sync-abandoned-checkouts` e `sync-boleto-expiring`:
os três jobs que efetivamente tiram mensagens da fila (`message_logs`
`pending`) e as enviam pela Meta Cloud API. `remarketing-send` já tem seus
próprios Cloud Scheduler jobs (`drosa-remarketing-*`) e não é coberto aqui.

## Contexto (auditoria de 28/09/2026)

`ENABLE_INTERNAL_CRON=false` em produção desliga o cron interno do processo
Node — por desenho, para que o Cloud Scheduler seja a única fonte de
disparo (nunca duas fontes concorrentes). Só que nenhum job do Cloud
Scheduler para estes 3 endpoints jamais foi criado: só existiam os 3 jobs de
remarketing. Resultado: a fila de mensagens transacionais fica presa em
`pending` indefinidamente, só avançando quando alguém chama
`POST /jobs/process-messages` manualmente. Este runbook fecha essa lacuna,
em duas etapas deliberadamente separadas:

- **Plano 1 (este código):** observabilidade (auditoria da fila, telemetria
  de execução, rota `sync-boleto-expiring` que faltava, freshness na Saúde)
  e este script de reconciliação — sempre em dry-run por padrão, sem tocar
  produção.
- **Etapa de produção (fora deste PR):** rotação do `JOBS_SECRET` exposto,
  deploy da revisão 0%, teste controlado e só então ativação dos schedules
  recorrentes — ver Tarefa 6 do plano de confiabilidade operacional.

## Antes de aplicar — before-state

Capture e guarde (sem imprimir segredos):

```powershell
$proj = 'gtm-m4sqc99b-nzjjz'
$region = 'us-central1'

# SHA do main, revisão live e digest da imagem
git rev-parse origin/main
gcloud run services describe drosa-recovery --project $proj --region $region `
  --format='value(status.latestReadyRevisionName)'
gcloud run services describe drosa-recovery --project $proj --region $region `
  --format='value(status.traffic)'

# Jobs do Scheduler existentes hoje (nomes/schedules apenas — sem headers)
gcloud scheduler jobs list --project $proj --location $region `
  --format='table(name,schedule,state,httpTarget.uri)'

# Auditoria da fila pendente (sem PII — ver Tarefa 1)
npm run ops:pending-queue:audit --silent
```

## Aplicar (dry-run primeiro, sempre)

```powershell
# 1) Dry-run — mostra o que seria feito, nunca o valor do segredo
pwsh -File scripts/ops/reconcile-cloud-scheduler.ps1 `
  -ProjectId gtm-m4sqc99b-nzjjz -Region us-central1 `
  -ServiceUrl https://drosa-recovery-lkuoxpyjlq-uc.a.run.app `
  -JobsSecretFile <caminho-local-fora-do-repo>\jobs-secret.txt

# 2) Só depois de revisar a saída do dry-run, aplicar de fato
pwsh -File scripts/ops/reconcile-cloud-scheduler.ps1 `
  -ProjectId gtm-m4sqc99b-nzjjz -Region us-central1 `
  -ServiceUrl https://drosa-recovery-lkuoxpyjlq-uc.a.run.app `
  -JobsSecretFile <caminho-local-fora-do-repo>\jobs-secret.txt -Apply
```

`-JobsSecretFile` aponta para um arquivo local, fora do repositório, contendo
só o valor do `JOBS_SECRET` (uma linha, sem espaço/quebra extra). Nunca
commitar esse arquivo. O script nunca escreve o valor em stdout/log; a única
limitação conhecida é que `gcloud scheduler jobs create/update http` exige o
header como argumento de linha de comando (não existe `--headers-from-file`),
então o valor passa brevemente pela lista de argumentos do processo `gcloud`
nessa chamada — rode `-Apply` só numa sessão de confiança.

## Verificar depois de aplicar

```powershell
$proj = 'gtm-m4sqc99b-nzjjz'; $region = 'us-central1'
gcloud scheduler jobs list --project $proj --location $region `
  --format='table(name,schedule,state,httpTarget.uri)'

# Sem imprimir o segredo: confirma que os 3 jobs respondem 2xx pela tag/URL
# de teste, e depois confere freshness em /jobs/automation-health ou na
# aba Saúde da Central React (`jobFreshness`), sem nunca chamar
# `gcloud scheduler jobs describe ... --format=yaml/json` (isso imprime o
# header com o segredo — usar sempre `--format='value(name,schedule,state)'`).
```

Critério de sucesso (ver Tarefa 6 do plano): os 3 jobs `status=fresh` na
Saúde, sem crescimento da fila `pending` só por falta de processador, sem
5xx novo, sem timeout de pool.

## Rollback

```powershell
# Pausa um job específico (não some com ele, só para de disparar)
gcloud scheduler jobs pause drosa-process-messages --project gtm-m4sqc99b-nzjjz --location us-central1

# Ou remove o job criado por engano
gcloud scheduler jobs delete drosa-process-messages --project gtm-m4sqc99b-nzjjz --location us-central1 --quiet
```

Rodar o script em dry-run de novo a qualquer momento é sempre seguro — ele só
lê o estado atual e nunca aplica nada sem `-Apply`.
