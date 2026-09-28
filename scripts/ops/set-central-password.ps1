# Define o usuário/senha DEFINITIVOS da Central (sessão única).
# Rodar no SEU terminal (PowerShell), na raiz do repo drosa-recovery:
#   pwsh -File scripts/ops/set-central-password.ps1
# - A senha é digitada de forma oculta e nunca é exibida.
# - O hash bcrypt é gerado localmente e gravado DIRETO como nova versão do
#   secret `drosa-central-auth-users` (Secret Manager). Nada vai para stdout,
#   arquivo do repo ou log — só o número da versão criada.
# - A versão anterior (usuário temporário do preview) continua existindo e é o
#   rollback; o preview continua fixado na versão 1.
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'
$secret = 'drosa-central-auth-users'

$email = (Read-Host 'E-mail de login da Central').Trim().ToLower()
if ($email -notmatch '^[^@\s:,]+@[^@\s:,]+\.[^@\s:,]+$') { throw 'E-mail inválido (não pode conter ":" nem ",").' }
$p1 = Read-Host 'Senha (mín. 12 caracteres)' -AsSecureString
$p2 = Read-Host 'Repita a senha' -AsSecureString
$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
try {
  if ($plain1 -ne $plain2) { throw 'As senhas não conferem.' }
  if ($plain1.Length -lt 12) { throw 'Senha curta demais (mínimo 12).' }
  $env:CENTRAL_PW = $plain1
  # gera o hash e confere (bcrypt.compare) antes de gravar — sem imprimir nada
  $hash = & node -e "const b=require('./node_modules/bcryptjs');const h=b.hashSync(process.env.CENTRAL_PW,12);if(!b.compareSync(process.env.CENTRAL_PW,h))process.exit(2);process.stdout.write(h)"
  if ($LASTEXITCODE -ne 0 -or -not $hash) { throw 'Falha ao gerar o hash.' }
  $tmp = [IO.Path]::Combine([IO.Path]::GetTempPath(), [IO.Path]::GetRandomFileName())
  try {
    [IO.File]::WriteAllText($tmp, "${email}:$hash")
    & gcloud secrets versions add $secret --project=$proj --data-file=$tmp 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao gravar no Secret Manager.' }
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  $v = & gcloud secrets versions list $secret --project=$proj --sort-by='~createTime' --limit=1 --format='value(name)'
  Write-Host "OK: nova versão $v de $secret gravada para $email (senha e hash não exibidos)."
  Write-Host "Informe ao agente: versão=$v, e-mail=$email"
} finally {
  $env:CENTRAL_PW = ''; $plain1 = $null; $plain2 = $null; $hash = $null
}
