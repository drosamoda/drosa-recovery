# Gera novo JOBS_SECRET e grava como nova versão no Secret Manager. Não imprime o valor.
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$tmp = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($tmp, [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'))
  gcloud secrets versions add drosa-recovery-jobs-secret --project=$proj --data-file=$tmp | Out-Null
} finally {
  Remove-Item $tmp -Force
}
gcloud secrets versions list drosa-recovery-jobs-secret --project=$proj --sort-by='~createTime' --limit=1 --format='value(name)'
