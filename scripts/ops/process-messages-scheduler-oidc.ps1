# Ciclo de vida do Cloud Scheduler de /jobs/process-messages com OIDC (sem JOBS_SECRET, chave JSON ou token fixo).
#
#   -Action Preflight | Create | Describe | Pause | Resume | Delete     (padrão: Preflight, somente leitura)
#   -DryRun   nunca cria/altera/pausa/resume/deleta nada: só imprime o que faria (e roda leituras)
#
# FAIL-CLOSED POR CONSTRUÇÃO (não depende de "nascer pausado"):
#   Fase A  cria a service account dedicada;
#   Fase B  prova iam.serviceAccounts.actAs do executor nessa service account;
#   Fase C  cria o job ENQUANTO o backend ainda NÃO aceita OIDC (JOBS_OIDC_* ausentes). Se houver
#           execução antes do pause, o endpoint responde 401 e processa ZERO mensagens;
#   Fase D  pausa imediatamente e verifica state=PAUSED (aborta com erro se não estiver);
#   Fase E  (separada e explicitamente autorizada, NÃO feita por este script) configurar
#           JOBS_OIDC_AUDIENCE / JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS numa nova revisão; só então Resume.
param(
  [ValidateSet('Preflight', 'Create', 'Describe', 'Pause', 'Resume', 'Delete')][string]$Action = 'Preflight',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'; $loc = 'us-central1'; $job = 'drosa-process-messages'; $svc = 'drosa-recovery'
$saName = 'drosa-scheduler-invoker'; $saEmail = "$saName@$proj.iam.gserviceaccount.com"
$target = 'https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/jobs/process-messages'
$audience = $target   # audience EXATA do endpoint (igual a JOBS_OIDC_AUDIENCE quando for configurada)
$schedule = '*/2 * * * *'; $tz = 'America/Sao_Paulo'

function Say($k, $v) { Write-Host ('{0,-40} {1}' -f $k, $v) }
# Leitura: devolve $null em erro/vazio. Nunca lança nem imprime credencial.
function GcloudRead([string[]]$GArgs) { $out = & gcloud @GArgs 2>$null; if ($LASTEXITCODE -ne 0) { return $null }; return $out }
# Mutação: única porta de escrita; em -DryRun apenas imprime.
function GcloudWrite([string[]]$GArgs) {
  if ($DryRun) { Write-Host ('  [dry-run] gcloud ' + ($GArgs -join ' ')); return }
  & gcloud @GArgs
  if ($LASTEXITCODE -ne 0) { throw "gcloud falhou: $($GArgs[0..2] -join ' ')" }
}

# iam.serviceAccounts.actAs efetivo do executor na SA (testIamPermissions; o token nunca é impresso).
function Test-ActAs {
  $token = & gcloud auth print-access-token 2>$null
  if (-not $token) { return $false }
  try {
    $body = @{ permissions = @('iam.serviceAccounts.actAs') } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Method Post -Uri "https://iam.googleapis.com/v1/projects/$proj/serviceAccounts/${saEmail}:testIamPermissions" `
      -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
    return [bool]($r.permissions -contains 'iam.serviceAccounts.actAs')
  } catch { return $false } finally { $token = $null }
}

# Retorna a lista de falhas críticas (vazia = OK). Imprime cada checagem.
function Invoke-Preflight([bool]$SaMustExist = $false) {
  $fail = New-Object System.Collections.Generic.List[string]
  $num = GcloudRead @('projects', 'describe', $proj, '--format=value(projectNumber)')
  if (-not $num) { $fail.Add('projeto inacessível') }
  Say 'projeto' "$proj (número $num)"
  $api = GcloudRead @('services', 'list', '--enabled', '--project', $proj, '--filter=config.name=cloudscheduler.googleapis.com', '--format=value(config.name)')
  Say 'Cloud Scheduler API' $(if ($api) { 'habilitada' } else { 'NÃO habilitada' }); if (-not $api) { $fail.Add('Scheduler API desabilitada') }
  $svcUrl = GcloudRead @('run', 'services', 'describe', $svc, '--region', $loc, '--project', $proj, '--format=value(status.url)')
  Say 'Cloud Run' $(if ($svcUrl) { "encontrado ($svcUrl)" } else { 'NÃO encontrado' }); if (-not $svcUrl) { $fail.Add('Cloud Run não encontrado') }
  $audOk = [bool]($svcUrl -and $target -eq "$svcUrl/jobs/process-messages" -and $audience -eq $target)
  Say 'target / audience exata' $target; Say 'audience confere com o serviço' $(if ($audOk) { 'sim' } else { 'NÃO' }); if (-not $audOk) { $fail.Add('audience/target divergem do serviço') }
  $agent = "service-$num@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
  $roles = GcloudRead @('projects', 'get-iam-policy', $proj, '--flatten=bindings[].members', "--filter=bindings.members:$agent", '--format=value(bindings.role)')
  $agentOk = [bool]($roles -contains 'roles/cloudscheduler.serviceAgent')
  Say 'service agent do Scheduler' $agent; Say 'roles/cloudscheduler.serviceAgent' $(if ($agentOk) { 'presente' } else { 'AUSENTE' }); if (-not $agentOk) { $fail.Add('service agent sem roles/cloudscheduler.serviceAgent') }
  $me = GcloudRead @('config', 'get-value', 'account'); Say 'executor' $me; if (-not $me) { $fail.Add('executor desconhecido') }
  $saExists = [bool](GcloudRead @('iam', 'service-accounts', 'describe', $saEmail, '--project', $proj, '--format=value(email)'))
  Say 'service account dedicada' $(if ($saExists) { 'existe' } else { 'não existe (Create cria na Fase A)' })
  if ($SaMustExist -and -not $saExists) { $fail.Add('service account inexistente') }
  if ($saExists) { $act = Test-ActAs; Say 'actAs efetivo na SA' $(if ($act) { 'sim' } else { 'NÃO' }); if (-not $act) { $fail.Add('executor sem iam.serviceAccounts.actAs na SA') } }
  else { Say 'actAs efetivo na SA' 'será provado na Fase B, antes de criar o job' }
  $exists = [bool](GcloudRead @('scheduler', 'jobs', 'describe', $job, '--location', $loc, '--project', $proj, '--format=value(name)'))
  Say 'job já existe' $(if ($exists) { 'SIM' } else { 'não' }); if ($exists) { $fail.Add('job já existe') }
  $json = GcloudRead @('run', 'services', 'describe', $svc, '--region', $loc, '--project', $proj, '--format=json')
  if ($json) {
    $d = ($json -join "`n") | ConvertFrom-Json
    $vars = @($d.spec.template.spec.containers[0].env | ? { $_.name -like 'JOBS_OIDC_*' } | % { $_.name })
    Say 'JOBS_OIDC_* no serviço' $(if ($vars.Count) { $vars -join ',' } else { 'ausentes (backend fail-closed: 401 no OIDC)' })
    Say 'tráfego atual' (($d.status.traffic | ? { $_.percent } | % { "$($_.revisionName)=$($_.percent)%" }) -join ', ')
    if ($vars.Count) { $fail.Add('JOBS_OIDC_* já configuradas: o job não pode ser criado enquanto o backend aceita OIDC') }
  }
  return , $fail.ToArray()
}

switch ($Action) {
  'Preflight' { $f = Invoke-Preflight; Say 'RESULTADO' $(if ($f.Count) { 'FALHAS: ' + ($f -join '; ') } else { 'OK' }) }
  'Create' {
    'Pré-checagens (abortam se falharem):'
    $f = Invoke-Preflight
    if ($f.Count) { throw "Preflight falhou, nada foi criado: $($f -join '; ')" }
    'Fase A: service account dedicada (sem papéis de dados)'
    GcloudWrite @('iam', 'service-accounts', 'create', $saName, "--project=$proj", '--display-name=Invoker do Cloud Scheduler (sem papéis de dados)')
    'Fase B: prova de actAs antes de criar o job'
    if (-not $DryRun) { if (-not (Test-ActAs)) { throw 'executor sem iam.serviceAccounts.actAs na service account; nada além dela foi criado. Corrija o IAM (não concedido automaticamente).' } }
    else { '  [dry-run] testIamPermissions iam.serviceAccounts.actAs' }
    'Fase C: cria o job com o backend ainda sem OIDC (qualquer execução antes do pause = 401, zero mensagens)'
    GcloudWrite @('scheduler', 'jobs', 'create', 'http', $job, "--project=$proj", "--location=$loc", "--schedule=$schedule", "--time-zone=$tz", "--uri=$target", '--http-method=POST',
      "--oidc-service-account-email=$saEmail", "--oidc-token-audience=$audience", '--attempt-deadline=120s', '--max-retry-attempts=0', '--quiet')
    'Fase D: pausa imediata e verificação'
    GcloudWrite @('scheduler', 'jobs', 'pause', $job, "--project=$proj", "--location=$loc", '--quiet')
    if (-not $DryRun) {
      $state = GcloudRead @('scheduler', 'jobs', 'describe', $job, "--location=$loc", "--project=$proj", '--format=value(state)')
      if ($state -ne 'PAUSED') { throw "job NÃO está PAUSED (state=$state). Pause manualmente agora: -Action Pause" }
      Say 'state' $state
    }
    'Fase E (NÃO executada aqui): configurar JOBS_OIDC_* em nova revisão, com autorização explícita, e só então -Action Resume.'
  }
  'Describe' { GcloudRead @('scheduler', 'jobs', 'describe', $job, "--location=$loc", "--project=$proj", '--format=value(name.basename(),state,schedule,timeZone,httpTarget.uri,httpTarget.oidcToken.serviceAccountEmail,httpTarget.oidcToken.audience)') }
  'Pause'    { GcloudWrite @('scheduler', 'jobs', 'pause', $job, "--project=$proj", "--location=$loc", '--quiet') }
  'Resume'   { if ($DryRun) { '[dry-run] resume só depois do canário aprovado, da fila antiga tratada e de JOBS_OIDC_* configuradas'; break }; GcloudWrite @('scheduler', 'jobs', 'resume', $job, "--project=$proj", "--location=$loc", '--quiet') }
  'Delete'   { GcloudWrite @('scheduler', 'jobs', 'delete', $job, "--project=$proj", "--location=$loc", '--quiet') }
}
