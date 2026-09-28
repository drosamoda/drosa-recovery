<#
.SYNOPSIS
  Reconcilia os 3 Cloud Scheduler jobs transacionais do drosa-recovery
  (process-messages, sync-abandoned-checkouts, sync-boleto-expiring) contra
  o estado desejado (URL, método, schedule, header x-jobs-secret).

.DESCRIPTION
  Modo padrão: DRY-RUN. Mostra, para cada job, o nome, a URL de destino, o
  schedule e se o job já existe — NUNCA o valor do header x-jobs-secret.
  Nenhuma chamada de escrita ao Cloud Scheduler acontece sem -Apply.

  Em -Apply, cria ou atualiza os 3 jobs com os schedules aprovados:
    drosa-process-messages          * * * * *      (1 min)
    drosa-sync-abandoned-checkouts  */15 * * * *   (15 min)
    drosa-sync-boleto-expiring      0 * * * *       (60 min)

  O valor do JOBS_SECRET só é lido de -JobsSecretFile (um arquivo local que
  você prepara fora deste repo) e nunca aparece em Write-Host, em log ou em
  qualquer saída deste script. LIMITAÇÃO CONHECIDA: a CLI `gcloud scheduler
  jobs create/update http` só aceita headers como argumento de linha de
  comando (não existe --headers-from-file) — nesse instante o valor passa
  pela lista de argumentos do processo `gcloud`, visível a quem tiver acesso
  ao Task Manager/`ps` da própria máquina nesse momento. Rode -Apply só numa
  sessão confiável; isso é uma limitação do `gcloud`, não deste script.

.PARAMETER ProjectId
  Projeto GCP (ex.: gtm-m4sqc99b-nzjjz).

.PARAMETER Region
  Região do Cloud Run / Cloud Scheduler (ex.: us-central1).

.PARAMETER ServiceUrl
  URL pública do serviço drosa-recovery (sem barra final), ex.:
  https://drosa-recovery-lkuoxpyjlq-uc.a.run.app

.PARAMETER JobsSecretFile
  Caminho de um arquivo local contendo só o valor do JOBS_SECRET (sem
  quebras de linha extras). Nunca commitar esse arquivo.

.PARAMETER Apply
  Sem esta flag, roda em dry-run (padrão seguro). Com -Apply, cria/atualiza
  os jobs de verdade.

.EXAMPLE
  # Dry-run — só mostra o que seria feito:
  pwsh -File scripts/ops/reconcile-cloud-scheduler.ps1 `
    -ProjectId gtm-m4sqc99b-nzjjz -Region us-central1 `
    -ServiceUrl https://drosa-recovery-lkuoxpyjlq-uc.a.run.app `
    -JobsSecretFile C:\segredos\jobs-secret.txt

.EXAMPLE
  # Aplica de fato:
  pwsh -File scripts/ops/reconcile-cloud-scheduler.ps1 `
    -ProjectId gtm-m4sqc99b-nzjjz -Region us-central1 `
    -ServiceUrl https://drosa-recovery-lkuoxpyjlq-uc.a.run.app `
    -JobsSecretFile C:\segredos\jobs-secret.txt -Apply
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [Parameter(Mandatory = $true)] [string]$Region,
  [Parameter(Mandatory = $true)] [string]$ServiceUrl,
  [Parameter(Mandatory = $true)] [string]$JobsSecretFile,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$ServiceUrl = $ServiceUrl.TrimEnd('/')

# Ordem e schedules aprovados — ver docs/superpowers/plans/2026-09-28-operational-reliability.md
$DesiredJobs = @(
  [pscustomobject]@{ Name = 'drosa-process-messages'; Path = '/jobs/process-messages'; Schedule = '* * * * *' },
  [pscustomobject]@{ Name = 'drosa-sync-abandoned-checkouts'; Path = '/jobs/sync-abandoned-checkouts'; Schedule = '*/15 * * * *' },
  [pscustomobject]@{ Name = 'drosa-sync-boleto-expiring'; Path = '/jobs/sync-boleto-expiring'; Schedule = '0 * * * *' }
)

if (-not (Test-Path -LiteralPath $JobsSecretFile)) {
  throw "JobsSecretFile não encontrado: $JobsSecretFile"
}

$jobsSecret = [IO.File]::ReadAllText($JobsSecretFile).Trim()
if ([string]::IsNullOrWhiteSpace($jobsSecret)) {
  throw 'JobsSecretFile está vazio.'
}
if ($jobsSecret -match "[`r`n]") {
  throw 'JobsSecretFile contém quebra de linha — deve conter só o valor do segredo.'
}

$mode = if ($Apply) { 'APPLY' } else { 'DRY-RUN' }
Write-Host "=== reconcile-cloud-scheduler — modo $mode ==="
Write-Host "Projeto: $ProjectId | Região: $Region | Serviço: $ServiceUrl"
Write-Host ''

$failures = 0

foreach ($job in $DesiredJobs) {
  $uri = "$ServiceUrl$($job.Path)"
  Write-Host "Job: $($job.Name)"
  Write-Host "  URL:      $uri"
  Write-Host "  Schedule: $($job.Schedule)"
  Write-Host "  Header:   x-jobs-secret=<redacted>, Content-Type=application/json"

  $describe = & gcloud scheduler jobs describe $job.Name --project=$ProjectId --location=$Region --format='value(name)' 2>$null
  $exists = ($LASTEXITCODE -eq 0 -and $describe)
  Write-Host "  Estado atual: $(if ($exists) { 'existe' } else { 'ausente' })"

  if (-not $Apply) {
    Write-Host '  [DRY-RUN] Nenhuma mudança aplicada.'
    Write-Host ''
    continue
  }

  $headerArg = "x-jobs-secret=$jobsSecret,Content-Type=application/json"
  try {
    if ($exists) {
      & gcloud scheduler jobs update http $job.Name --project=$ProjectId --location=$Region `
        --uri=$uri --http-method=POST --schedule=$job.Schedule `
        --update-headers=$headerArg --quiet 2>&1 | Out-Null
    } else {
      & gcloud scheduler jobs create http $job.Name --project=$ProjectId --location=$Region `
        --uri=$uri --http-method=POST --schedule=$job.Schedule `
        --headers=$headerArg --quiet 2>&1 | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
      $failures++
      Write-Host "  [APPLY] FALHOU ao $(if ($exists) { 'atualizar' } else { 'criar' }) $($job.Name). Rode 'gcloud scheduler jobs describe $($job.Name) --project=$ProjectId --location=$Region' para detalhes (não contém o segredo)."
    } else {
      Write-Host "  [APPLY] $($job.Name) $(if ($exists) { 'atualizado' } else { 'criado' })."
    }
  } finally {
    $headerArg = $null
  }
  Write-Host ''
}

$jobsSecret = $null
[GC]::Collect()

if ($failures -gt 0) {
  Write-Host "Concluído com $failures falha(s). Nenhum valor de secret foi impresso."
  exit 1
}
Write-Host 'Concluído. Nenhum valor de secret foi impresso.'
