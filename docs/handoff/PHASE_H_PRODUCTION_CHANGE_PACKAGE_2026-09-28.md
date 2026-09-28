# Fase H — Security Remediation + Preview Infrastructure (28/09/2026)

Nada deste documento foi executado em produção. É o pacote único de mudanças para autorização.

## 0. Status normalizado (substitui os status otimistas das fases F/G)
```
AUTH_IMPLEMENTATION=PASS
AUTH_PRODUCTION_READINESS=FAIL      (sem CENTRAL_SESSION_SECRET, usuários, proxy hops e preview reais)
PREVIEW_CODE_READINESS=PASS
PREVIEW_ENV_READINESS=FAIL          (secrets + DB reader + embedding Metabase pendentes)
PROD_SECRET_EXPOSURE_INCIDENT=YES   (INBOX_ADMIN_SECRET v2 exibido na sessão de 27/09)
PROD_DB_WRITE_GUARD=FAIL            (credencial atual = role `postgres`; TEMP TABLE criada em 27/09)
BI_TIMEZONE_DEBT=YES
HISTORICAL_CONSENT_DEBT=YES
PURCHASED_AFTER_CONTACT_DEBT=YES    (não é conversão causal)
PERFORMANCE_DEBT=ai/opportunities p50≈5.6s (não bloqueia preview; limite de ação: >8s/timeout)
METABASE_EMBEDDING_DISABLED=3,5,6,7,8
```

## 1. INBOX_SECRET_ROTATION_PLAN
**Auditoria (código em 28/09):**
- Lido em `src/middlewares/inboxAuth.ts` (`INBOX_ADMIN_SECRET || ADMIN_SECRET`, header `x-inbox-admin-secret` ou `x-admin-secret`) e `src/routes/inbox.routes.ts:43` (simulação de dev; 404 em produção).
- Rotas: todo `/inbox/*` (montado fora de `CRM_PREVIEW_READONLY`).
- Consumidor: só o front `/inbox` (`public/inbox/app.js`), com o valor **digitado pelo operador e guardado em `localStorage`** (`drosa_inbox_secret`). Os jobs do Cloud Scheduler (`remarketing-send`) usam `x-jobs-secret`, não este. O app BI no Vercel não usa este segredo.
- Produção: Secret Manager `drosa-recovery-inbox-admin-secret`, **versão fixada `2`** na revisão.
- Dual-secret: **não existe**. Comparação de valor único.

**Sequência sem downtime (recomendada — exige uma mudança pequena de código, aditiva):**
1. Código: `inboxAuth` aceita `INBOX_ADMIN_SECRET` **ou** `INBOX_ADMIN_SECRET_NEXT` (se não vazia), com comparação em tempo constante. Teste: old/next/nenhum.
2. `gcloud secrets create drosa-recovery-inbox-admin-secret-next` com valor gerado localmente (32 bytes, sem imprimir); conceder `secretAccessor` só à service account do Cloud Run.
3. Deploy de revisão do `drosa-recovery` com `INBOX_ADMIN_SECRET_NEXT=…:1` (OLD continua aceito) → smoke `/inbox` com OLD.
4. Operador troca o valor no `/inbox` (limpar `localStorage` e digitar o NEXT) → smoke com NEXT.
5. `gcloud secrets versions add drosa-recovery-inbox-admin-secret` (v3 = valor do NEXT); revisão com `INBOX_ADMIN_SECRET=…:3` e sem `_NEXT`.
6. Desabilitar v2 (`gcloud secrets versions disable 2 --secret=drosa-recovery-inbox-admin-secret`). Rollback até aqui: reabilitar v2 e reapontar a revisão.

**Alternativa sem mudança de código (janela curta de indisponibilidade só do `/inbox`):** adicionar v3 → deploy apontando para `:3` → operador redigita no `/inbox` → desabilitar v2. Impacto: operador fica sem inbox entre o deploy e a digitação.

**Observação:** `ADMIN_SECRET` é fallback de `inboxAuth`; conferir que ele não tem o mesmo valor do v2 (comparação por hash) antes de retirar o v2.

## 2. PREVIEW_DB_GRANT_PLAN — role `drosa_central_preview_reader`
**Fatos medidos (catálogo, 28/09):** credencial atual = `postgres` (`rolcreatedb`, `rolcreaterole`, `rolbypassrls`, pode `TEMP`, `CREATE` e `INSERT`). `PUBLIC` tem `TEMPORARY` e `CONNECT` no banco `postgres`; `PUBLIC` **não** tem `CREATE` no schema `public`. Nenhuma tabela da allowlist tem RLS. Views `bi_*` pertencem a `postgres`. `drosa_bi_reader` já existe (SELECT nas 12 views `bi_*`).

**Allowlist (objetos lidos pelos endpoints GET da Central — `crmReadService`, `crmJourneyService`, `abandonedCheckoutEligibilityService`, `aiOpportunityEngine`, serviços de e-mail read-only, `biReadService`):**
- Tabelas: `customers, orders, abandoned_checkouts, whatsapp_templates, automation_rules, message_logs, contacts, suppressions, whatsapp_consents, remarketing_runs, remarketing_recipients, conversations, chat_messages, webhook_events, email_consent_events, email_marketing_consents, email_suppressions, email_sends, email_event_logs`
- Views: as 12 `bi_*`.
- **Fora:** `campaign_drafts`, `ai_runs` (banco de IA separado), `contact_frequency_locks`, `whatsapp_envios_importados` (só jobs), `_prisma_migrations`.

**SQL (a executar como `postgres`, após autorização):**
```sql
-- 0. pré-checagem: roles que hoje dependem do TEMP via PUBLIC
select rolname from pg_roles
 where rolname !~ '^pg_' and has_database_privilege(rolname, 'postgres', 'TEMP')
 order by 1;

-- 1. neutralizar o TEMP herdado sem afetar ninguém: conceder explicitamente a cada role
--    listado acima (exceto o reader), e só então revogar do PUBLIC
-- GRANT TEMPORARY ON DATABASE postgres TO <role1>, <role2>, ...;
REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC;

-- 2. role
CREATE ROLE drosa_central_preview_reader LOGIN PASSWORD '<gerado, 32+ bytes, via Secret Manager>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5;
ALTER ROLE drosa_central_preview_reader SET default_transaction_read_only = on;
ALTER ROLE drosa_central_preview_reader SET statement_timeout = '15s';
GRANT CONNECT ON DATABASE postgres TO drosa_central_preview_reader;
GRANT USAGE ON SCHEMA public TO drosa_central_preview_reader;
GRANT SELECT ON public.customers, public.orders, public.abandoned_checkouts, public.whatsapp_templates,
  public.automation_rules, public.message_logs, public.contacts, public.suppressions, public.whatsapp_consents,
  public.remarketing_runs, public.remarketing_recipients, public.conversations, public.chat_messages,
  public.webhook_events, public.email_consent_events, public.email_marketing_consents, public.email_suppressions,
  public.email_sends, public.email_event_logs TO drosa_central_preview_reader;
GRANT SELECT ON public.bi_abandoned_cart_funnel_daily, public.bi_automation_rules, public.bi_consent_current_state,
  public.bi_consent_daily_events, public.bi_message_daily_stats, public.bi_message_hourly_stats,
  public.bi_orders_consent_funnel_daily, public.bi_orders_daily_summary, public.bi_system_pulse,
  public.bi_template_daily_stats, public.bi_templates, public.bi_webhook_daily_summary TO drosa_central_preview_reader;
```
`ALTER ROLE … SET default_transaction_read_only` vale no pooler (é configuração do role, não parâmetro de conexão — ao contrário do `options=` que o pooler ignorou).

**Rollback:** `DROP OWNED BY drosa_central_preview_reader; DROP ROLE drosa_central_preview_reader; GRANT TEMPORARY ON DATABASE postgres TO PUBLIC;`

**Negative tests obrigatórios (conectado como o reader, pelo pooler):**
```
SELECT ................ PASS   (select count(*) from message_logs)
INSERT ................ DENIED (insert into webhook_events …)
UPDATE ................ DENIED (update orders set … where false)
DELETE ................ DENIED (delete from customers where false)
CREATE TABLE .......... DENIED (create table public.__x(i int))
CREATE TEMP TABLE ..... DENIED (create temp table __x(i int))
SET TRANSACTION READ WRITE + INSERT ... DENIED (privilégio, não só o default)
SELECT em campaign_drafts / _prisma_migrations ... DENIED
```
Script pronto para gerar: `scratchpad` → vira `scripts/ops/verifyPreviewReader.ts` na Fase I.

## 3. CENTRAL_SESSION_SECRET
`CENTRAL_SESSION_SECRET_REQUIRED=YES`
- Gerar 48 bytes aleatórios localmente, sem imprimir: `openssl rand -base64 48 | gcloud secrets create drosa-central-session-secret --data-file=- --replication-policy=automatic`.
- IAM: `roles/secretmanager.secretAccessor` **no secret** (não no projeto) para a service account do serviço de preview.
- Referência de versão explícita no preview (`:1`, nunca `latest`).
- Nunca em `.env` commitado (`.env` é gitignored e nunca foi commitado — verificado).

## 4. BI_CONFIG_MIGRATION_PLAN
Verificado no projeto Vercel `drosa-recovery-bi-dashboard` (conta `drosamoda-6608`), só nomes: `DASHBOARD_AUTH_USERS`, `DASHBOARD_AUTH_SECRET`, `METABASE_SECRET_KEY`, `METABASE_SITE_URL`, `METABASE_DASHBOARD_ID`, `DATABASE_URL`, `RECOVERY_JOBS_SECRET`, `RECOVERY_APP_BASE_URL` (Production e Preview).
- **Os valores são “Sensitive” no Vercel: `vercel env pull` devolve `[SENSITIVE]`. Não há como copiar.** A migração precisa partir da fonte original:
  - `METABASE_SECRET_KEY`: Admin do Metabase → Embedding → Static embedding (a mesma chave; **não** regenerar, senão o BI Vercel quebra antes da hora).
  - `METABASE_SITE_URL`: `https://drosa-bi-metabase-lkuoxpyjlq-uc.a.run.app` (serviço Cloud Run existente; `/api/health` 200).
  - Dashboard IDs — **verificados** no app DB do Metabase (`report_dashboard`, leitura): 2 Visão Executiva (embedding **on**), 3 Envios, 5 Consentimentos, 6 Carrinho Abandonado, 7 Pedidos, 8 Webhooks e Saúde (embedding **off**). Fixados na allowlist do servidor; `METABASE_EXECUTIVE_DASHBOARD_ID` removida (não precisa mais de env).
  - `DASHBOARD_AUTH_USERS` → `CENTRAL_AUTH_USERS`: 1 usuário cadastrado. Como o valor não é legível, o dono gera o hash de novo (`node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))"`) e grava no Secret Manager `drosa-central-auth-users`. `DASHBOARD_AUTH_SECRET` **não** é migrado (a Central usa `CENTRAL_SESSION_SECRET` próprio).
  - `DATABASE_URL` (role `drosa_bi_reader`) → opcional `BI_DATABASE_URL`; como a senha também não é legível, é mais simples o preview usar o novo `drosa_central_preview_reader` (que também lê as `bi_*`).
- Ao aposentar o BI Vercel (Fase J): remover `RECOVERY_JOBS_SECRET` do Vercel — é uma cópia do segredo de jobs de produção fora do GCP.

## 5. Metabase (allowlist) — implementado e testado
Aliases server-side: `executive→2, recovery→6, messages→3, consents→5, orders→7, integrations→8`. Testes: cada alias assina o ID certo (200); alias inexistente e ID numérico → 404; `?dashboard=` ignorado; sem sessão/segredo → 401 sem URL; resposta nunca contém a chave. Mudança de produção necessária: **habilitar “Static embedding” nos dashboards 3, 5, 6, 7, 8** no admin do Metabase.

## 6. PROXY_RATE_LIMIT_PLAN — implementado e testado
- Não usamos `app.set('trust proxy', …)` global (mudaria a chave do limiter de descadastro).
- Nova env `CENTRAL_TRUSTED_PROXY_HOPS` (0 local; **1 no Cloud Run direto**; 2 se houver HTTPS LB na frente). O IP do login = entrada do `X-Forwarded-For` escrita pelo primeiro proxy confiável; entradas à esquerda (enviadas pelo cliente) são ignoradas.
- Chave composta: `ip|email_normalizado` (5 falhas) + `ip` (20 falhas), 15 min, bloqueio antes de verificar a senha.
- Testes: IP direto, XFF, spoof variando a esquerda (continua bloqueado), dois clientes atrás do mesmo proxy (um bloqueado, outro entra), cadeia curta cai no IP da conexão. Regressão do descadastro: 22/22 inalterado.
- Validação real pendente para a Fase I: no preview, logar `x-forwarded-for` (só contagem de entradas, sem IP) numa requisição para confirmar que `hops=1` corresponde à cadeia real.

## 7. PREVIEW_DEPLOY_PLAN
**Recomendação: serviço Cloud Run separado, não revisão com tag no `drosa-recovery`.** Motivo: uma revisão `--no-traffic --tag` no mesmo serviço herda e **deixa como base** a configuração dela (env `CRM_PREVIEW_READONLY=true`, `DATABASE_URL` do reader, etc.) para o próximo `gcloud run deploy` do serviço — um deploy normal do `main` depois disso sairia read-only/sem escrita em produção. Serviço separado isola totalmente e o rollback é apagar o serviço.

```bash
gcloud run deploy drosa-central-preview \
  --source . --region us-central1 --project gtm-m4sqc99b-nzjjz \
  --service-account <sa-dedicada-preview>@gtm-m4sqc99b-nzjjz.iam.gserviceaccount.com \
  --min-instances 0 --max-instances 2 \
  --set-env-vars NODE_ENV=production,CRM_PREVIEW_READONLY=true,ENABLE_INTERNAL_CRON=false,\
CRON_PROCESS_MESSAGES_ENABLED=false,CRON_ABANDONED_CART_ENABLED=false,CRON_BOLETO_EXPIRING_ENABLED=false,CRON_EMAIL_CAMPAIGNS_ENABLED=false,\
WHATSAPP_DRY_RUN=true,INBOX_SEND_DRY_RUN=true,AUTOMATION_SEND_ENABLED=false,ABANDONED_CART_ENABLED=false,REMARKETING_ENABLED=false,\
EMAIL_SEND_ENABLED=false,EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false,EMAIL_PROVIDER=none,AI_DATABASE_URL=,\
CENTRAL_SESSION_ENABLED=true,CENTRAL_TRUSTED_PROXY_HOPS=1,CENTRAL_SESSION_TTL_HOURS=12,CENTRAL_ADMIN_EMAILS=<email do dono>,\
METABASE_SITE_URL=https://drosa-bi-metabase-lkuoxpyjlq-uc.a.run.app,APP_BASE_URL=<url do preview>,\
NUVEMSHOP_STORE_ID=preview-inert,NUVEMSHOP_ACCESS_TOKEN=preview-inert,META_ACCESS_TOKEN=preview-inert,META_PHONE_NUMBER_ID=preview-inert \
  --set-secrets DATABASE_URL=drosa-central-preview-db-url:1,CRM_READ_SECRET=drosa-crm-read-secret:<versão atual>,\
CENTRAL_SESSION_SECRET=drosa-central-session-secret:1,CENTRAL_AUTH_USERS=drosa-central-auth-users:1,\
METABASE_SECRET_KEY=drosa-metabase-embed-key:1
```
(Demais variáveis obrigatórias do `env.ts` — `META_VERIFY_TOKEN`, `META_APP_SECRET`, `ADMIN_SECRET`, `JOBS_SECRET`, `INBOX_ADMIN_SECRET`, `WEBHOOK_SECRET`, `CHECKOUT_BASE_URL`, `NUVEMSHOP_USER_AGENT` — recebem valores **inertes aleatórios**, porque as rotas que os usam não são montadas em `CRM_PREVIEW_READONLY`.)
- Tokens de Meta/Nuvemshop inertes: nenhuma chamada externa possível.
- Sem Cloud Scheduler apontando para o preview.
- Acesso: `--allow-unauthenticated` só se o dono aceitar URL pública (o app exige sessão/segredo em `/crm-api`); senão `--no-allow-unauthenticated` + IAP/identity token.
- Validação pós-deploy: `/health` 200; `/jobs/*`, `/webhooks/*`, `/admin/*` → 404; log `[cron] jobs internos desabilitados`; negative tests do reader pela própria revisão.
- Rollback: `gcloud run services delete drosa-central-preview` — o serviço `drosa-recovery` não é tocado.

## PROD_CHANGES_REQUIRED (para uma autorização única)
1. **Rotacionar `INBOX_ADMIN_SECRET`** (seção 1; recomendado com `_NEXT` + código aditivo).
2. **Criar secrets**: `drosa-central-session-secret` (novo), `drosa-central-auth-users` (hash regerado pelo dono), `drosa-metabase-embed-key` (valor copiado do admin do Metabase), `drosa-central-preview-db-url` (reader).
3. **Criar o role `drosa_central_preview_reader`** + neutralizar TEMP do `PUBLIC` (seção 2) e rodar os negative tests.
4. **Habilitar Static embedding** nos dashboards Metabase 3, 5, 6, 7, 8.
5. **Publicar o serviço `drosa-central-preview`** (seção 7), 0 tráfego do domínio oficial.
