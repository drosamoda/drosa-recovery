# Fase G — Auth única + Preview Readiness (27/09/2026)

> **Status normalizado em 28/09 (Fase H):** AUTH_IMPLEMENTATION=PASS · AUTH_PRODUCTION_READINESS=FAIL · PREVIEW_CODE_READINESS=PASS · PREVIEW_ENV_READINESS=FAIL · PROD_SECRET_EXPOSURE_INCIDENT=YES · PROD_DB_WRITE_GUARD=FAIL. Ver `PHASE_H_PRODUCTION_CHANGE_PACKAGE_2026-09-28.md`.


## AUTH_CURRENT_STATE
| Superfície | Mecanismo | Onde fica a credencial |
|---|---|---|
| `/crm`, `/crm-v2`, `/crm-next` (API `/crm-api/*`) | header `x-crm-read-secret` = `CRM_READ_SECRET` (um segredo compartilhado, sem usuário) | `sessionStorage` do browser |
| App BI (Vercel) | e-mail + senha (`DASHBOARD_AUTH_USERS` bcrypt), JWT HS256 em cookie `drosa_bi_session` httpOnly, 7 dias | cookie httpOnly |
| `/inbox`, `/admin`, `/jobs` | `x-inbox-admin-secret`, `x-admin-secret`, `x-jobs-secret` | fora do escopo desta fase (não alterados) |

## AUTH_TARGET_STATE (implementado, desligado por padrão)
- `CENTRAL_SESSION_ENABLED=false` (padrão): **comportamento idêntico ao anterior** — `/central-auth` não existe; `crmAuth` só aceita o header legado; cookie forjado não vale nada (teste).
- Com a flag ligada:
  - `POST /central-auth/login` (JSON obrigatório → formulário cross-site simples não dispara login), `POST /central-auth/logout`, `GET /central-auth/me`.
  - Usuários em `CENTRAL_AUTH_USERS` no **mesmo formato** de `DASHBOARD_AUTH_USERS` (`email:hashBcrypt,...`) → a lista do BI migra sem recriar senhas. Papéis: `CENTRAL_ADMIN_EMAILS` = admin; demais = leitura.
  - Cookie `central_session`: `HttpOnly`, `SameSite=Strict`, `Secure` quando `NODE_ENV=production`, `Max-Age` = `CENTRAL_SESSION_TTL_HOURS` (padrão 12h, máx 168h). Token `v1.<payload>.<HMAC-SHA256>` com `CENTRAL_SESSION_SECRET` (mín. 32 chars), comparação em tempo constante, expiração verificada no servidor; usuário removido da lista perde a sessão na requisição seguinte.
  - Rate limit de login: helper existente `failureRateLimiter` (ganhou `check()`/`clear()` aditivos): 5 falhas por IP+e-mail ou 20 por IP em 15 min → `429` + `Retry-After`, **antes** de verificar a senha.
  - `crmAuth` aceita header legado **ou** cookie válido. `x-crm-read-secret` continua funcionando igual (teste com a flag ligada).
  - Em `CRM_PREVIEW_READONLY`, só `/central-auth/login` e `/logout` são exceção ao bloqueio de escrita (não tocam banco).
  - Metabase signed embed (`/crm-api/bi/embed/:module`) fica atrás do mesmo `crmAuth` → integrado à mesma sessão.
- Frontend: portão detecta sessão (`/central-auth/me`); 401 → login e-mail/senha; 404/503 → formulário legado; segredo legado já informado entra direto (rollback). Nada em `localStorage`; o cookie não é legível por JS (verificado no browser). Topbar mostra e-mail·papel e "Sair" chama logout.
- Não é um terceiro mecanismo permanente: substitui o login do BI e, após o cutover aprovado, o segredo manual. Remoção do header legado fica para depois da regressão.

### Validação real (local)
Backend desta branch inerte (preview read-only) + Vite: login → cookie httpOnly → `/crm-api/messages` e `/crm-api/bi/*` só com cookie → logout → `/crm-api` 401. Legado com a flag ligada: OK.

## PREVIEW_READINESS
1. **Build React no pipeline**: `gcp-build` (buildpack do Cloud Run) agora roda `npm run build:frontend` (`npm ci --include=dev` no `frontend/` — o buildpack roda com `NODE_ENV=production` e o Vite é devDependency). Validado numa cópia isolada simulando o buildpack.
2. **Express serve o build**: já existia — `/crm-next` → `frontend/dist` (SPA fallback). `/crm` e `/crm-v2` continuam servidos em paralelo, intocados.
3. **Preview isolado** (serviço Cloud Run separado, ex. `drosa-recovery-preview`, sem tráfego do domínio oficial):
   - `gcloud run deploy drosa-recovery-preview --source . --region us-central1` (serviço novo; não toca `drosa-recovery`). Acesso público à URL ou IAM (`--no-allow-unauthenticated`) é decisão do dono — o app já exige sessão/segredo em `/crm-api`.
   - Env obrigatória do preview: `CRM_PREVIEW_READONLY=true` (desliga cron, webhooks, admin, jobs, escrita), `ENABLE_INTERNAL_CRON=false`, todos `CRON_*_ENABLED=false`, `WHATSAPP_DRY_RUN=true`, `INBOX_SEND_DRY_RUN=true`, `AUTOMATION_SEND_ENABLED=false`, `EMAIL_SEND_ENABLED=false`, `EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false`, `AI_DATABASE_URL` vazio.
   - Banco: o pooler do Supabase **ignora** `options=-c default_transaction_read_only=on` (provado). Para read-only no nível do banco, o preview deve usar um role read-only (ex. o `drosa_bi_reader` ampliado, ou novo role) — hoje não existe um role read-only com acesso às tabelas operacionais; decidir antes do preview. Sem isso, a garantia é a do app (preview read-only + só GET).
   - `app.set('trust proxy', 1)` **não** está ligado: atrás do Cloud Run, `req.ip` é o do proxy e o teto de 20 falhas/IP do login vira global (risco de lockout de todos por 15 min; o legado continua como saída). Recomendado ligar antes do preview — muda também a chave do limiter de descadastro, por isso não foi feito nesta rodada.
4. **Rollback**: preview é serviço separado → rollback = apagar o serviço/revisão; nada muda no `drosa-recovery`. No cutover futuro: `gcloud run services update-traffic drosa-recovery --to-revisions=<revisão anterior>=100`; flag `CENTRAL_SESSION_ENABLED=false` volta ao legado sem novo deploy.
5. **Segredos necessários para o preview** (nenhum criado/copiado nesta rodada):
   - `CENTRAL_SESSION_SECRET` — **novo** (gerar no Secret Manager).
   - `CENTRAL_AUTH_USERS` — migração de `DASHBOARD_AUTH_USERS` (Vercel BI).
   - `METABASE_SECRET_KEY` (IDs dos dashboards agora fixos e verificados na allowlist), `METABASE_SITE_URL` — migração do Vercel BI (**METABASE_SECRET_MIGRATION=YES**).
   - `BI_DATABASE_URL` (opcional, menor privilégio) — migração do Vercel BI.
   - `CRM_READ_SECRET` — já existe.

## Plano de rotação do INBOX_ADMIN_SECRET (não executado)
Motivo: o valor de produção (v2) apareceu na saída desta sessão por erro meu (alias `H` do PowerShell). Passos seguros:
1. Levantar quem envia `x-inbox-admin-secret` hoje (frontend `/inbox` digitado pelo operador; integrações externas, se houver).
2. `gcloud secrets versions add drosa-recovery-inbox-admin-secret` com valor novo gerado localmente (sem imprimir).
3. Deploy de revisão apontando para a nova versão (o serviço fixa `version=2` explicitamente — trocar para a nova versão numerada).
4. Validar `/inbox` com o novo valor; manter a revisão anterior pronta para rollback por alguns minutos.
5. Desabilitar a versão 2 (`gcloud secrets versions disable ... 2`) após confirmação.
