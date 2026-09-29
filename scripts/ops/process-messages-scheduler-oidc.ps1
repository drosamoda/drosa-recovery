# Cloud Scheduler de /jobs/process-messages autenticado por OIDC (sem JOBS_SECRET, sem chave JSON, sem token fixo).
# NÃO executar antes do canário WhatsApp aprovado. O job nasce PAUSADO.
#   -Action Preflight | Create | Describe | Pause | Resume | Delete     (padrão: Preflight, somente leitura)
#   -DryRun                                                             (imprime o que faria, sem criar nada)
param(
  [ValidateSet('Preflight', 'Create', 'Describe', 'Pause', 'Resume', 'Delete')][string]$Action = 'Preflight',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'; $loc = 'us-central1'; $job = 'drosa-process-messages'; $svc = 'drosa-recovery'
$saName = 'drosa-scheduler-invoker'; $saEmail = "$saName@$proj.iam.gserviceaccount.com"
$target = 'https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/jobs/process-messages'
$audience = $target   # audience EXATA do endpoint (igual a JOBS_OIDC_AUDIENCE no Cloud Run)
$schedule = '*/2 * * * *'; $tz = 'America/Sao_Paulo'

function Line($k, $v) { '{0,-42} {1}' -f $k, $v }
function GcloudRead { param([string[]]$a) $out = & gcloud @a 2>$null; if ($LASTEXITCODE -ne 0) { return $null }; return $out }

function Preflight {
  $num = GcloudRead @('projects', 'describe', $proj, '--format=value(projectNumber)')
  Line 'projeto' "$proj (número $num)"
  Line 'Cloud Scheduler API' $(if (GcloudRead @('services', 'list', '--enabled', '--project', $proj, '--filter=config.name=cloudscheduler.googleapis.com', '--format=value(config.name)')) { 'habilitada' } else { 'NÃO habilitada' })
  $svcUrl = GcloudRead @('run', 'services', 'describe', $svc, '--region', $loc, '--project', $proj, '--format=value(status.url)')
  Line 'Cloud Run' $(if ($svcUrl) { "encontrado ($svcUrl)" } else { 'NÃO encontrado' })
  Line 'target URL' $target; Line 'audience exata' $audience
  Line 'audience confere com o serviço' $(if ($svcUrl -and $target.StartsWith($svcUrl)) { 'sim' } else { 'NÃO' })
  $agent = "service-$num@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
  $roles = GcloudRead @('projects', 'get-iam-policy', $proj, '--flatten=bindings[].members', "--filter=bindings.members:$agent", '--format=value(bindings.role)')
  Line 'service agent do Scheduler' $agent
  Line 'roles/cloudscheduler.serviceAgent' $(if ($roles -contains 'roles/cloudscheduler.serviceAgent') { 'presente' } else { 'AUSENTE (habilitar a API cria o agente)' })
  Line 'service account dedicada' $(if (GcloudRead @('iam', 'service-accounts', 'describe', $saEmail, '--project', $proj, '--format=value(email)')) { 'existe' } else { 'não existe (Create cria)' })
  $me = GcloudRead @('config', 'get-value', 'account')
  Line 'executor' $me
  $can = GcloudRead @('iam', 'service-accounts', 'get-iam-policy', $saEmail, '--project', $proj, '--flatten=bindings[].members', "--filter=bindings.members:$me", '--format=value(bindings.role)')
  Line 'actAs na SA (via papel na SA)' $(if ($can) { "papéis: $($can -join ',')" } else { 'sem binding direto na SA; roles/owner ou serviceAccountUser no projeto também bastam — conferir com -DryRun' })
  Line 'job já existe' $(if (GcloudRead @('scheduler', 'jobs', 'describe', $job, '--location', $loc, '--project', $proj, '--format=value(name)')) { 'SIM' } else { 'não' })
  $env = GcloudRead @('run', 'services', 'describe', $svc, '--region', $loc, '--project', $proj, '--format=json') | ConvertFrom-Json
  $vars = $env.spec.template.spec.containers[0].env | ? { $_.name -like 'JOBS_OIDC_*' } | % { $_.name }
  Line 'variáveis JOBS_OIDC_* no serviço' $(if ($vars) { $vars -join ',' } else { 'ausentes (OIDC desligado, fail closed)' })
  $traffic = $env.status.traffic | ? { $_.percent } | % { "$($_.revisionName)=$($_.percent)%" }
  Line 'tráfego atual' ($traffic -join ', ')
}

switch ($Action) {
  'Preflight' { Preflight }
  'Create' {
    $cmds = @(
      "gcloud iam service-accounts create $saName --project=$proj --display-name='Invoker do Cloud Scheduler (sem papéis de dados)'",
      "gcloud scheduler jobs create http $job --project=$proj --location=$loc --schedule='$schedule' --time-zone='$tz' --uri='$target' --http-method=POST --oidc-service-account-email=$saEmail --oidc-token-audience='$audience' --attempt-deadline=120s --max-retry-attempts=0 --quiet",
      "gcloud scheduler jobs pause $job --project=$proj --location=$loc --quiet"
    )
    if ($DryRun) { 'DRY-RUN — nada será criado. Faria:'; $cmds | % { "  $_" }; Line 'service account' $saEmail; Line 'target' $target; Line 'audience' $audience; Line 'schedule' "$schedule ($tz)"; 'Sem papéis de dados; sem JOBS_SECRET; sem chave JSON; nasce PAUSADO.'; exit 0 }
    if (-not (GcloudRead @('iam', 'service-accounts', 'describe', $saEmail, '--project', $proj, '--format=value(email)'))) { Invoke-Expression $cmds[0] }
    Invoke-Expression $cmds[1]; Invoke-Expression $cmds[2]
    gcloud scheduler jobs describe $job --project=$proj --location=$loc --format='value(name.basename(),state,schedule,timeZone)'
  }
  'Describe' { gcloud scheduler jobs describe $job --project=$proj --location=$loc --format='value(name.basename(),state,schedule,timeZone,httpTarget.uri,httpTarget.oidcToken.serviceAccountEmail,httpTarget.oidcToken.audience)' }
  'Pause'    { if ($DryRun) { "DRY-RUN: pause $job"; exit 0 }; gcloud scheduler jobs pause $job --project=$proj --location=$loc --quiet }
  'Resume'   { if ($DryRun) { "DRY-RUN: resume $job (só depois do canário aprovado e da fila antiga tratada)"; exit 0 }; gcloud scheduler jobs resume $job --project=$proj --location=$loc --quiet }
  'Delete'   { if ($DryRun) { "DRY-RUN: delete $job"; exit 0 }; gcloud scheduler jobs delete $job --project=$proj --location=$loc --quiet }
}
