# Verificação do role crm_ai_writer DEPOIS de criado (SOMENTE LEITURA + tentativas que DEVEM falhar).
# Usa a URL do secret drosa-recovery-ai-database-url em memória; nunca imprime credencial nem dados.
#   pwsh -File scripts/ops/verify-ai-db-role.ps1
# Saída: PASS/FAIL por checagem. Nenhuma escrita é concluída (as tentativas negativas rodam em transação READ ONLY
# e, de qualquer forma, o role não tem privilégio).
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'; $secret = 'drosa-recovery-ai-database-url'
$env:AI_URL = gcloud secrets versions access latest --secret=$secret --project=$proj
$js = @'
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient({ datasources: { db: { url: process.env.AI_URL } } })
const out = []
const ok = (name, pass) => out.push((pass ? 'PASS ' : 'FAIL ') + name)
const denied = async (name, sql) => {
  try { await p.$transaction(async (tx) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); await tx.$queryRawUnsafe(sql) }); ok(name + ' (deveria negar)', false) }
  catch (e) { ok(name, /permission denied|must be owner|read-only/i.test(String(e.message))) }
}
;(async () => {
  const role = await p.$queryRawUnsafe("select rolsuper, rolcreatedb, rolcreaterole, rolconnlimit from pg_roles where rolname = current_user")
  ok('NOSUPERUSER', role[0].rolsuper === false)
  ok('NOCREATEDB', role[0].rolcreatedb === false)
  ok('NOCREATEROLE', role[0].rolcreaterole === false)
  ok('CONNECTION LIMIT 3', Number(role[0].rolconnlimit) === 3)
  for (const t of ['campaign_drafts', 'ai_runs']) {
    try { await p.$queryRawUnsafe(`select count(*) from public.${t}`); ok('SELECT ' + t, true) } catch { ok('SELECT ' + t, false) }
  }
  const privs = await p.$queryRawUnsafe("select table_name, privilege_type from information_schema.role_table_grants where grantee = current_user and table_schema = 'public' order by 1,2")
  const tables = [...new Set(privs.map((r) => r.table_name))].sort().join(',')
  ok('privilégios SÓ em ai_runs,campaign_drafts', tables === 'ai_runs,campaign_drafts')
  ok('sem DELETE/TRUNCATE/REFERENCES/TRIGGER', !privs.some((r) => ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'].includes(r.privilege_type)))
  for (const t of ['orders', 'customers', 'message_logs', 'whatsapp_consents', 'email_marketing_consents', 'webhook_events']) {
    await denied('SELECT ' + t + ' negado', `select 1 from public.${t} limit 1`)
  }
  await denied('INSERT em orders negado', "insert into public.orders(id) values ('x')")
  console.log(out.join('\n'))
  console.log(out.some((l) => l.startsWith('FAIL')) ? 'RESULTADO: FAIL' : 'RESULTADO: PASS')
  await p.$disconnect()
})().catch((e) => { console.error('ERRO', String(e.message).split('\n').pop().replace(/postgres\S+/g, '<url>')); process.exit(1) })
'@
try { node -e $js } finally { $env:AI_URL = '' }
