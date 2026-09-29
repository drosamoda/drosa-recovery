# Cria o role dedicado do banco de campanhas (menor privilégio) e grava AI_DATABASE_URL no Secret Manager.
# EXECUTAR PELO DONO (usa a credencial admin dele). Nada é impresso além da versão do secret.
#   pwsh -File scripts/ops/create-ai-db-role.ps1            # cria/atualiza
#   pwsh -File scripts/ops/create-ai-db-role.ps1 -Rollback  # remove o role e desabilita a versão
# Tabelas do módulo de IA no schema: apenas campaign_drafts e ai_runs (não existem "campaigns"/"recipients").
param([switch]$Rollback)
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'; $secret = 'drosa-recovery-ai-database-url'

$admin = gcloud secrets versions access latest --secret=drosa-recovery-database-url --project=$proj
$u = [Uri]$admin
$ref = ($u.UserInfo.Split(':')[0]).Split('.')[1]

function Invoke-Sql([string[]]$statements) {
  $env:ADMIN_URL = $admin; $env:STATEMENTS = ($statements | ConvertTo-Json -Compress)
  try {
    node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasources:{db:{url:process.env.ADMIN_URL}}});(async()=>{for(const s of JSON.parse(process.env.STATEMENTS)){await p.`$executeRawUnsafe(s)}await p.`$disconnect()})().catch(e=>{console.error(e.message.split('\n').pop());process.exit(1)})"
    if ($LASTEXITCODE -ne 0) { throw 'SQL falhou' }
  } finally { $env:ADMIN_URL = ''; $env:STATEMENTS = '' }
}

if ($Rollback) {
  Invoke-Sql @(
    'REVOKE ALL ON public.campaign_drafts, public.ai_runs FROM crm_ai_writer',
    'REVOKE USAGE ON SCHEMA public FROM crm_ai_writer',
    'DROP ROLE IF EXISTS crm_ai_writer'
  )
  gcloud secrets versions list $secret --project=$proj --format='value(name)' | % { gcloud secrets versions disable $_ --secret=$secret --project=$proj --quiet | Out-Null }
  'rollback ok'; exit 0
}

$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$pw = [Convert]::ToHexString($bytes).ToLower()
Invoke-Sql @(
  "DO `$do`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='crm_ai_writer') THEN CREATE ROLE crm_ai_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END `$do`$",
  "ALTER ROLE crm_ai_writer PASSWORD '$pw' CONNECTION LIMIT 3",
  'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM crm_ai_writer',
  'GRANT USAGE ON SCHEMA public TO crm_ai_writer',
  'GRANT SELECT, INSERT, UPDATE ON public.campaign_drafts, public.ai_runs TO crm_ai_writer'
)
$aiUrl = "postgresql://crm_ai_writer.${ref}:$pw@$($u.Host):$($u.Port)$($u.AbsolutePath)?pgbouncer=true&connection_limit=1"
$tmp = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($tmp, $aiUrl)
  gcloud secrets create $secret --project=$proj --data-file=$tmp 2>$null
  if ($LASTEXITCODE -ne 0) { gcloud secrets versions add $secret --project=$proj --data-file=$tmp | Out-Null }
} finally { Remove-Item $tmp -Force; $pw = $null; $aiUrl = $null; $admin = $null }

$sa = gcloud run services describe drosa-recovery --region us-central1 --project $proj --format='value(spec.template.spec.serviceAccountName)'
gcloud secrets add-iam-policy-binding $secret --project=$proj --member="serviceAccount:$sa" --role=roles/secretmanager.secretAccessor | Out-Null
"versão do secret: " + (gcloud secrets versions list $secret --project=$proj --sort-by='~createTime' --limit=1 --format='value(name)')
'Verificação (a cargo do agente após ligar AI_DATABASE_URL): positivo = GET /crm-api/ai/campaigns 200; negativo = o role NÃO lê orders/customers/message_logs (SELECT deve falhar com permission denied).'
