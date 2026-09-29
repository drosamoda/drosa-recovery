# Cloud Scheduler do /jobs/process-messages (a cada 2 min). NÃO executar antes do canário WhatsApp aprovado.
#   -Action Create | Pause | Resume | Delete (rollback = Pause ou Delete)
# O segredo é lido do Secret Manager em memória; nunca é impresso nem vai ao repositório.
param([ValidateSet('Create', 'Pause', 'Resume', 'Delete')][string]$Action = 'Create', [int]$SecretVersion = 2)
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'; $job = 'drosa-process-messages'; $loc = 'us-central1'
$uri = 'https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/jobs/process-messages'
switch ($Action) {
  'Create' {
    $s = gcloud secrets versions access $SecretVersion --secret=drosa-recovery-jobs-secret --project=$proj
    gcloud scheduler jobs create http $job --project=$proj --location=$loc --schedule='*/2 * * * *' --uri=$uri --http-method=POST `
      --headers="x-jobs-secret=$s,Content-Type=application/json" --attempt-deadline=120s --max-retry-attempts=0 --quiet
    $s = $null
    gcloud scheduler jobs pause $job --project=$proj --location=$loc --quiet   # nasce PAUSADO; Resume só após autorização
  }
  'Pause'  { gcloud scheduler jobs pause $job --project=$proj --location=$loc --quiet }
  'Resume' { gcloud scheduler jobs resume $job --project=$proj --location=$loc --quiet }
  'Delete' { gcloud scheduler jobs delete $job --project=$proj --location=$loc --quiet }
}
gcloud scheduler jobs describe $job --project=$proj --location=$loc --format='value(name.basename(),state,schedule)' 2>$null
