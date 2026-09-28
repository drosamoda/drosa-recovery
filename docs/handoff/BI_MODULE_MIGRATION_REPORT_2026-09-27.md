# Fase F — BI & Inteligência como módulo da Central (27/09/2026)

> **Status normalizado em 28/09 (Fase H):** AUTH_IMPLEMENTATION=PASS · AUTH_PRODUCTION_READINESS=FAIL · PREVIEW_CODE_READINESS=PASS · PREVIEW_ENV_READINESS=FAIL · PROD_SECRET_EXPOSURE_INCIDENT=YES · PROD_DB_WRITE_GUARD=FAIL. Ver `PHASE_H_PRODUCTION_CHANGE_PACKAGE_2026-09-28.md`.


Fonte canônica: `drosamoda/drosa-recovery-bi-dashboard` @ `2eed563` (**BI_REPO_ACCESS=PASS**). O app Vercel **não** foi portado; só as consultas às views e o mecanismo de signed embed.

## Arquitetura
- Backend (aditivo, só GET, atrás do mesmo `crmAuth`): `/crm-api/bi/data/:dataset`, `/crm-api/bi/embed/:module`, `/crm-api/bi/metabase-status`.
- `biReadService`: SQL do `lib/queries.ts` do BI, só com casts de tipo; allowlist de 9 datasets; `days` limitado a 1–90; sempre em `SET TRANSACTION READ ONLY` (escrita rejeitada pelo Postgres — provado em produção). Datasource: `BI_DATABASE_URL` (role `drosa_bi_reader`) se configurada; senão `DATABASE_URL` do serviço em transação read-only.
- `metabaseEmbed`: JWT HS256 via `node:crypto` (sem nova dependência). Browser só envia o **módulo**; IDs em allowlist server-side: recovery=6, messages=3, consents=5, orders=7, integrations=8, executive=`METABASE_EXECUTIVE_DASHBOARD_ID`. Token expira em 10 min, renovado a cada 9. Chave nunca sai do servidor.
- Frontend `/bi`: Visão Executiva, Recovery, Mensagens, Consentimentos, Pedidos, Integrações; período 7/30/90; Metabase frio/indisponível/não configurado → aviso neutro, indicadores nativos continuam.

## Views (12, produção, lidas via `pg_views` em transação read-only)
Todas existem; nenhuma criada/alterada. Smoke real dos 9 datasets com o código compilado: OK (~1,2 s cada).

## Semântica aplicada (diferenças deliberadas do app BI)
- Entregues/Lidas sobre **Disparadas** (o BI usava o total, que inclui skipped/fila).
- `sent` = "Aguardando entrega"; nenhum "Enviadas".
- Carrinho em dois grupos realmente subordinados: Avaliados → Com telefone → Com consentimento marketing → Elegíveis (estado atual) | Disparados → Entregues → Lidos.
- Consentimento transacional × marketing lado a lado sobre o total de pedidos.

## DATA_QUALITY_WARNING
1. `bi_abandoned_cart_funnel_daily.purchased_after_contact` = `count(*) FILTER (WHERE convertedOrderId IS NOT NULL)` — sem condição de contato nem de tempo. Exibido como "Carrinhos com pedido vinculado".
2. Views agrupam com `("createdAt" AT TIME ZONE 'America/Sao_Paulo')::date` sobre `timestamp` sem fuso → dia UTC, não dia SP. Evidência real: "último dia 2026-09-28" às ~20h de 27/09 (Brasília). Correção exige alterar view (banco) — fora desta rodada.
3. `elegíveis` das views são calculados com consentimento/supressão **de hoje**, não do momento do disparo.

## Segredos / migração
- `METABASE_SECRET_KEY` (IDs dos dashboards agora fixos e verificados na allowlist) e URL do `drosa_bi_reader`: não existem no GCP (vivem no Vercel do BI). **METABASE_SECRET_MIGRATION=YES** — nada copiado. Até migrar: embed = 503 `METABASE_NOT_CONFIGURED` (aviso neutro) e dados via transação read-only.
- Metabase (`drosa-bi-metabase`) respondeu `/api/health` 200 em 0,4–0,6 s.

## Smoke real
Backend desta branch local, **inerte** (`CRM_PREVIEW_READONLY=true`: cron desligado, `/jobs`/`/webhooks`/admin desmontados, escrita HTTP 404, flags de envio false, tokens falsos) contra o banco de produção via pooler; só GET. Observação: o pooler ignora `options=-c default_transaction_read_only=on` — a garantia de read-only no nível da conexão **não** vale; o BI usa `SET TRANSACTION READ ONLY` explícito, que vale.
6 abas carregadas sem erro; 375/768/1024/1440 sem overflow.

## Testes
Backend: 8 (`biRoutes.test.ts`). Frontend: 6 (`biMetrics.test.ts`) + 8 (`BiPage.test.tsx`).
