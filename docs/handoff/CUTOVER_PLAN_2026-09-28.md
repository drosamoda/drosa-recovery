# CUTOVER_PLAN — Central React (preparado em 28/09/2026, NÃO executado)

Pré-requisito: Fase I aprovada pelo dono + itens "Antes do cutover" abaixo resolvidos.

## Antes do cutover (bloqueadores de J)
1. **Senha definitiva**: substituir o usuário temporário `preview-temp@drosamoda.test` por usuário(s) reais em `CENTRAL_AUTH_USERS` (hash bcrypt gerado pelo dono; nova versão do secret) + `CENTRAL_ADMIN_EMAILS`.
2. **Operador do `/inbox`** já usando o `INBOX_ADMIN_SECRET` v3 (v2 desabilitada em 28/09).
3. **Métricas com débito** fora de qualquer KPI executivo ou com rótulo "provisória": dia UTC das views `bi_*`, consentimento atual usado para períodos passados, `purchased_after_contact` (≠ conversão).
4. **Decidir o modo de dados do Central em produção** (ver "Arquitetura pós-cutover").
5. Revisão humana da `PREVIEW_REGRESSION_MATRIX` (resultado em `PHASE_I_PREVIEW_REPORT_2026-09-28.md`) e do visual no preview com login próprio.

## Arquitetura pós-cutover (decisão)
O Central React é servido pelo **próprio `drosa-recovery`** em `/crm-next` (depois `/crm-v2`), lendo `/crm-api` **localmente** (sem proxy — o proxy upstream existe só para o preview isolado). BI em produção: `BI_DATABASE_URL` = `drosa-central-bi-db-url` (role `drosa_central_bi_reader`, só `bi_*`), mantendo o banco operacional fora do caminho do BI.

Env a adicionar no `drosa-recovery` no cutover: `CENTRAL_SESSION_ENABLED=true`, `CENTRAL_TRUSTED_PROXY_HOPS=1`, `CENTRAL_AUTH_USERS` (secret), `CENTRAL_ADMIN_EMAILS`, `CENTRAL_SESSION_SECRET` (secret), `METABASE_SITE_URL`, `METABASE_SECRET_KEY` (secret), `BI_DATABASE_URL` (secret). Conceder à SA do `drosa-recovery` accessor **por secret** nesses 4.

## Sequência
1. **Freeze** (D-1): congelar `main` e `feat/central-react`; nenhum deploy paralelo (há revisões de outras frentes — ex. `drosa-recovery-consent-sync-v1` com imagem não promovida: decidir antes se entra ou não).
2. **Merge**: PR `feat/central-react → main` com CI verde (typecheck/lint/tests/build back+front, `gcp-build`).
3. **Build/deploy sem tráfego**: `gcloud run deploy drosa-recovery --source . --no-traffic --tag central-cutover` com as env/secrets acima. Conferir que o template herdado é o da revisão servindo (`gcloud run services describe` × revisão com tráfego).
4. **Smoke na tag** `central-cutover---…`: `/health`; `/crm`, `/crm-v2`, `/crm-next` 200; login sessão + legado; `/crm-api/*` GET; `/crm-api/bi/*`; embeds 6 módulos; `/inbox` com v3; webhooks Nuvemshop/Meta (enviar 1 evento de teste assinado ou observar tráfego real na tag não é possível — validar só `/webhooks/*` responde 401/400 a payload inválido); `/jobs` 401 sem segredo.
5. **Tráfego**: `gcloud run services update-traffic drosa-recovery --to-revisions <nova>=100` (a URL/domínio oficial não muda — só a revisão).
6. **Observação (2 h ativas + 24 h passivas)**: erros 5xx, latência, webhooks processados (bi_webhook_daily_summary), fila de mensagens, logins falhos/429.
7. **Troca de rota**: após 24 h estáveis, `/crm-v2` passa a servir o React (redirect `/crm-v2 → /crm-next` ou troca do handler). `/crm` antigo: manter servido e sem link por 2 semanas, depois remover.
8. **Legado de auth**: `x-crm-read-secret` continua aceito por 2 semanas; depois `CRM_READ_SECRET` só para integrações (ou rotacionar e remover do navegador).

## Rollback
- Até o passo 5: nada a desfazer (revisão sem tráfego).
- Após o passo 5: `gcloud run services update-traffic drosa-recovery --to-revisions drosa-recovery-inbox-rot-v3=100` (revisão atual em 28/09, já com INBOX v3). Não usar revisões que referenciam `drosa-recovery-inbox-admin-secret:2` (desabilitada) — falhariam ao iniciar; se precisar delas, `gcloud secrets versions enable 2` antes (reabre o valor comprometido — último recurso).
- Sessão com problema: `CENTRAL_SESSION_ENABLED=false` numa nova revisão → volta ao segredo legado sem outra mudança.
- BI com problema: remover `BI_DATABASE_URL` → BI volta a ler pelo DB do serviço em transação read-only.

## BI Vercel (`drosa-recovery-bi-dashboard`)
1. Manter no ar durante a observação (é o rollback analítico).
2. Após 2 semanas: desativar o projeto; **remover `RECOVERY_JOBS_SECRET` do Vercel** (cópia do segredo de jobs de produção fora do GCP) e, em seguida, **rotacionar `JOBS_SECRET`** do `drosa-recovery`, já que a cópia existiu em outro provedor.
3. Remover `DATABASE_URL` do Vercel e revogar/trocar a senha do `drosa_bi_reader` (ou dropar o role se nada mais usar; Metabase usa seu próprio datasource — verificar antes).

## Preview isolado
`drosa-central-preview` continua até o cutover. Depois: `gcloud run services delete drosa-central-preview`, remover o role `drosa_central_bi_reader` **somente se** o BI de produção não o estiver usando (no plano acima ele passa a ser o reader oficial), apagar `drosa-central-preview-login` e a SA `drosa-central-preview`.
