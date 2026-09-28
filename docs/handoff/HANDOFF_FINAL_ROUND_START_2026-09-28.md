# HANDOFF — Rodada final (I.5 → J → preparar K) — ponto de partida

**Para o próximo chat: leia este arquivo e depois `HANDOFF_CENTRAL_REACT_2026-09-28.md`.** Nada da rodada final foi executado ainda — só a baseline do freeze abaixo.

## Autorização vigente do dono (28/09/2026)
Executar **I.5 → J** e só **preparar K**. Regras obrigatórias:
1. **Login no preview**: o dono loga manualmente no browser pane em `https://drosa-central-preview-1082403977536.us-central1.run.app/crm-next/` com a credencial temporária (`drosa-central-preview-login`). O agente NÃO digita, revela, captura nem imprime a senha; usa a sessão aberta para a regressão hosted (375/768/1024/1440, console/network, BI/Metabase, refresh/logout). Sem sessão → pedir login e parar só essa subetapa.
2. **Senha definitiva**: o dono digita. O agente prepara um script que o dono roda no próprio terminal (prompt interativo `Read-Host -AsSecureString`), gera bcrypt sem exibir, grava nova versão em `drosa-central-auth-users` (só o usuário definitivo, sem o temporário) e nunca imprime senha/hash. Depois validar login novo. Sem senha definitiva → `CUTOVER_READY=NO` e parar antes da J.
3. **Freeze verificável**: registrar MAIN_HEAD, FEATURE_HEAD, LIVE_REVISION, LIVE_IMAGE_DIGEST; reler imediatamente antes do merge/deploy e de novo antes da troca de tráfego. Mudou algo inesperado → `FREEZE_DRIFT=YES`, abortar e reconciliar.
4. **Fase K**: não aposentar nada. Só marcar `LEGACY_CRM=FROZEN`, `LEGACY_BI=FROZEN`, `PREVIEW_SERVICE=ACTIVE_FOR_OBSERVATION` e produzir `POST_CUTOVER_CLEANUP_PLAN`. Não deletar `/crm`, BI Vercel, preview, secrets necessários, revisões de rollback nem SAs.
Produção final = `drosa-recovery` (Express + `/crm-api` same-origin + React). `drosa-central-preview` NÃO vira backend operacional.

## Baseline do freeze (registrada em 28/09, antes de qualquer ação)
```
MAIN_HEAD          = a0674ca1cb750f4c04d28c1f18f3e43984081a64   (origin/main)
FEATURE_HEAD       = ce5bd80509e9f6f9b31e1c764340ef2340286b7b   (origin/feat/central-react = local)
main não contidos em feat: 2 commits (inclui ce3a032 "docs: add human LGPD approval record")
LIVE_REVISION      = drosa-recovery-inbox-rot-v3 = 100%
LATEST_CREATED     = drosa-recovery-inbox-rot-v3
LIVE_IMAGE_DIGEST  = sha256:0f9e3797c81a2d1632152cc10b45a336d5ac628cafbd3dadf40140a70bb45fca
Custom domain      = nenhum domain mapping no serviço (URL oficial = https://drosa-recovery-lkuoxpyjlq-uc.a.run.app)
```
Qualquer divergência disto ao retomar = drift a investigar antes de agir.

## Plano de execução (ordem recomendada — antecipar tudo que não depende do dono, e fazer UMA única parada para os dois passos manuais)
### I.5 (sem mudança de produção, exceto onde indicado)
1. **Consent-sync**: comparar `drosa-recovery-consent-sync-v1` (imagem diferente da live, env idêntico, 0% tráfego) — digest, commit de origem (labels/imagem no Artifact Registry `cloud-run-source-deploy/drosa-recovery`), diff contra `main`. Classificar `ALREADY_IN_MAIN | MUST_MERGE_BEFORE_FREEZE | OBSOLETE_DISCARD`. Não promover.
2. **Rollback limpo**: `drosa-recovery-inbox-rot-v3` já é limpa (imagem de produção conhecida + INBOX v3, sem secret comprometido). Após o corte ela vira o rollback; garantir tag (`inbox-v3` já existe) e smoke pela tag. Nunca usar revisões que referenciam `drosa-recovery-inbox-admin-secret:2` (desabilitada).
3. **Action Center** no Dashboard React ("PRECISA DE ATENÇÃO", 3–5 itens): somente fatos já expostos pela API (`/crm-api/health`: `recoveryEngine.failed/unknown/pending/oldestPending`, `latestEvidence.error/hmacValid/processed` de Meta/Nuvemshop, `runtime.cron`), sem thresholds novos; cada item com problema/severidade/contexto/link (Mensagens filtro Falhou, Saúde, Saúde›Webhooks). O v2 mostra "Mensagens com falha aguardando revisão 282" — paridade.
4. **Auditoria semântica Metabase** (dashboards 2,3,5,6,7,8): ler read-only no app DB do Metabase (`report_dashboardcard` → `report_card`: nome, display, `dataset_query`), montar matriz `DASHBOARD | CARD | KPI | FONTE | FÓRMULA | STATUS(KEEP/FIX/HIDE) | MOTIVO`. Proibido: "Enviadas" ambígua, entrega sobre total com skipped, consentimento sequencial, `purchased_after_contact` como conversão/receita, percentuais impossíveis. Preferir resolver sem editar o Metabase: a Central só embute dashboards 100% KEEP (flag por alias no allowlist); os demais ficam só com os KPIs nativos. Alvo: `INVALID_EXECUTIVE_KPIS_VISIBLE=0`.
5. **Inbox**: confirmar `INBOX_SECRET_ROTATION=PASS`, `OLD_SECRET_DISABLED=PASS`, `/inbox auth=PASS` (v3 aceita/v2 401); registrar `PREEXISTING_INBOX_CONVERSATIONS_BUG=YES` (GET /inbox/conversations 500 antes e depois).
6. **Arquitetura one-service**: revisão final do `drosa-recovery` sem `CRM_UPSTREAM_URL` (API same-origin), com `CENTRAL_SESSION_ENABLED=true`, `CENTRAL_TRUSTED_PROXY_HOPS=1`, `CENTRAL_ADMIN_EMAILS=<email do dono>`, secrets `CENTRAL_SESSION_SECRET=drosa-central-session-secret:1`, `CENTRAL_AUTH_USERS=drosa-central-auth-users:<versão definitiva>`, `METABASE_SITE_URL`, `METABASE_SECRET_KEY=drosa-metabase-embed-key:1`, `BI_DATABASE_URL=drosa-central-bi-db-url:1`. Verificar que a SA do serviço (`1082403977536-compute@developer.gserviceaccount.com`) acessa esses secrets (se não, conceder accessor por secret).
7. **Rota canônica** (sugestão ainda não implementada): flag `CENTRAL_REACT_CANONICAL=true` → `/crm` e `/crm-v2` redirecionam 302 para `/crm-next/`; legados congelados em `/crm-legacy` e `/crm-v2-legacy`. Flag off = comportamento antigo (rollback sem deploy de imagem).
8. **Gates**: frontend (tsc/eslint/vitest/build) + backend (tsc/eslint/`vitest run`/tsc build) + secret scan + preview API regression + hosted UI + auditoria Metabase + smoke do rollback.
9. **PARADA ÚNICA com o dono**: (a) login no preview no browser pane → regressão hosted; (b) dono roda o script da senha definitiva → validar login. Se ok: `CUTOVER_READY=YES`.
### J
Freeze re-check → `git merge origin/main` em `feat/central-react` (2 commits, revisar LGPD/consentimento/e-mail/secrets/cron/webhook) → gates → merge em `main` sem force push (branch pode ser protegida: verificar; se exigir PR, criar) → freeze re-check → `gcloud run deploy drosa-recovery --source . --no-traffic --tag central-cutover` com env/secrets do item 6 (confirmar que o template-base é a revisão live) → smoke completo pela tag (inclui `/inbox` auth v3, `/jobs` 401, `/webhooks` responde a payload inválido, cron desligado no boot como hoje, BI/Metabase, login/logout) → freeze re-check → `update-traffic --to-revisions <nova>=100` → smoke pós-corte + observação curta (5xx, auth, crm-api, Metabase, webhooks processados, fila). Rollback: `update-traffic --to-revisions drosa-recovery-inbox-rot-v3=100`.
### K (só preparar)
`POST_CUTOVER_CLEANUP_PLAN` + marcar frozen. Nada removido.

## Saída esperada da rodada
Bloco `FINAL_CUTOVER_ROUND` (formato definido pelo dono na autorização). Se `CUTOVER_COMPLETE=YES`, parar.

## Lembretes críticos
- Nunca imprimir secrets/hashes; nunca digitar credenciais em host não-local; `rm` com variável é bloqueado (usar caminho literal); PowerShell: variáveis case-insensitive e `H` = `Get-History`; RTK reescreve grep/npm (usar binários diretos); processos: registrar PID e encerrar só por PID.
- Supabase: pooler 6543 + `pgbouncer=true` localmente; `options=` é ignorado pelo pooler.
- Backlog que NÃO bloqueia: 249 erros webhook Nuvemshop, BI UTC, consentimento histórico, purchased_after_contact, ai/opportunities ~5,6 s, rate limit por instância, `/inbox/conversations` 500.
