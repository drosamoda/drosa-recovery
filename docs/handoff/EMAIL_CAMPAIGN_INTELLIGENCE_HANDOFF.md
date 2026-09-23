# HANDOFF — Módulo de Inteligência de Campanhas de E-mail (D'Rosa Recovery CRM)

> Escrito em 2026-09-21 para retomar em outro chat do Claude Code. Leia este arquivo inteiro antes de agir.
> Este arquivo e `docs/handoff/scripts/*` estão **sem commit** (untracked) de propósito — commite quando fizer sentido.

## 0. TL;DR — CONCLUÍDO em 2026-09-21

**O módulo está entregue e validado no Preview real.** Este documento passa a ser histórico + referência.

- Commits pushados para `origin` **e** `v0mirror`: `9f3e55b` (backend) e `52c9dd4` (UI). `HEADS_MATCH=YES` em `52c9dd4`.
- Preview Git-triggered: `dpl_FSx9pZ4nkHVFXyYPavhWhFSp7ZFh` (`Ready`, `source: git`, sha `52c9dd4`), URL `https://drosa-recovery-lndxgq52w-drosamoda-6608s-projects.vercel.app` (alias estável da branch em §1).
- Migration `20260919120000_add_email_campaign_channel` **aplicada manualmente pelo usuário no SQL Editor do Supabase** (sem credencial admin com o agente) e verificada só com a role de IA. **FECHADO em 2026-09-21:** `prisma migrate resolve --applied 20260919120000_add_email_campaign_channel` executado com a Session Pooler admin (variável temporária já removida). `_prisma_migrations` tem 1 linha para a migration; `prisma migrate status` = "Database schema is up to date!". Observação: o banco compartilhado também tem `20260918151500_add_conversation_message_entity` (existe na `main`, ausente nesta branch) — ao mergear/rebasear com a `main`, ela virá junto; não é conflito de schema.
- Protection Bypass criado pelo `vercel curl` foi **revogado** (`protectionBypass: {}`; requisição direta = 302). `MIGRATE_DATABASE_URL` removida do Windows.
- Contagens reais (banco do Preview, 3.755 clientes com e-mail — a base é pequena, não 50 mil): ALL=3.755 · ONE_TIME=2.539 · REPEAT=379 · VIP=88 · 0–30d=1.007 · 31–60d=680 · 61–90d=844 · 91–180d=272 · 181–365d=0 · 365+=0 · NO_PURCHASE=837 · HIGH_VALUE_NON_VIP=570 · CARRINHO_RECENTE=32 · sem data confiável=115. 19/19 invariantes OK (buckets 2.803 + 115 sem data = 2.918 compradores; 2.539+379+837 = 3.755).
- Smoke HTTP real (Groq `openai/gpt-oss-120b`): 201 em ~4,4 s; 3 estratégias A/B/C com assunto/preheader/headline/corpo/CTA; 1 estratégia bloqueada por compliance; idempotência (mesma key → mesmo draft em 0,5 s), concorrência (2 simultâneas → mesmo draft), 4 negativos (400/422/422/400) sem criar draft; **1 `ai_run` por draft**; snapshot sem PII; drafts marcados `[PREVIEW_HTTP_SMOKE_TEST]`.
- **Não exercitado via HTTP no Preview:** aprovar/agendar draft de e-mail (exige `ADMIN_SECRET`, que o Preview read-only não tem). Coberto por testes unit/integração (`EMAIL_SEND_NOT_AVAILABLE` 409, gate fail-closed, UI sem botão de agendar).
- Próximos passos de produto (fora desta rodada): fonte de consentimento de e-mail, provedor de e-mail + descadastro/supressão + histórico de envio (habilitam cooldown real e `sendEligibleCount`), dados de categoria/novidade/ranking para destravar as 14 campanhas `NEEDS_DATA`.

> As seções abaixo (§1–§9) foram escritas antes da execução; o checklist do §5 está **cumprido** (com a diferença: migration aplicada manualmente em vez de `prisma migrate deploy`; o teste do engine contra o banco real foi feito pelo próprio Preview, o que validou o SQL — HTTP 200 em ~1,7 s).

## 1. Repo, branch e infraestrutura

| Item | Valor |
|---|---|
| Repo local | `C:\Users\peter\OneDrive\Peter\particular\Documentos\desafio pai e filho\drosa-recovery-crm-ops` |
| GitHub | `drosamoda/drosa-recovery` (remote `origin`); espelho `peterjunio16-code/drosa-recovery-v0` (remote `v0mirror`) |
| Branch de trabalho | `review/crm-v2-visual` (**nunca `main`**) |
| Stack | Node + TypeScript strict + Express + Prisma + PostgreSQL (Supabase `hocrnjuvrufkqjbmmuoo`, db `postgres`) |
| Produção real | Railway `drosa-recovery-production.up.railway.app` — **NÃO TOCAR** |
| Vercel | projeto `drosamoda-6608s-projects/drosa-recovery` (`prj_Ja5IWbDU3mplzZ3ueoGkupGIlNqN`, team `team_Eh9cFb9Q9JX5ZGSxSB7AAqJy`); só hospeda **Previews** (Production da Vercel é vazio/dormente — **NÃO TOCAR**) |
| Preview atual (código antigo, `c32e8f3`) | `https://drosa-recovery-hk00wnben-drosamoda-6608s-projects.vercel.app` (deploy Git-triggered, `Ready`); alias estável da branch: `https://drosa-recovery-git-review-crm-v-07a2b6-drosamoda-6608s-projects.vercel.app` |
| Proteção do Preview | Vercel Authentication ligada. Bypass criado antes foi **revogado** (`protectionBypass: {}`) |
| Provider de IA ativo no Preview | `AI_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-120b` (OpenAI/Anthropic disponíveis p/ troca manual, sem fallback automático) |
| Skills ativas do projeto | backend-api-typescript, prisma-postgres-architecture, webhooks-idempotency, whatsapp-cloud-api, testing-vitest-supertest, production-security, openapi-docs (as globais de segurança do CLAUDE.md valem) |

### Env vars do Vercel **escopadas Preview + branch `review/crm-v2-visual`** (13, todas `Encrypted`)
`AI_DATABASE_URL`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `AI_PROVIDER`, `GROQ_MODEL`, `GROQ_BASE_URL`, `OPENAI_MODEL`,
`WHATSAPP_DRY_RUN=true`, `AUTOMATION_SEND_ENABLED=false`, `REMARKETING_ENABLED=false`, `ENABLE_INTERNAL_CRON=false`,
`AI_REQUEST_TIMEOUT_MS=120000`, `CRM_READ_SECRET` (override branch-specific; existe também uma global antiga de Preview — **nunca tocar/ler a global**).
Não existe (e não foi criada) nenhuma env de e-mail no Vercel. `EMAIL_SEND_ENABLED` default `false` no código.

### Banco / roles
- `DATABASE_URL`/`DIRECT_URL` do Preview = role **`crm_preview_reader`** (somente leitura). Valores só existem cifrados no Vercel (não recuperáveis localmente).
- `AI_DATABASE_URL` = role **`crm_ai_preview_writer`** (SELECT/INSERT/UPDATE **só** em `campaign_drafts` e `ai_runs`, sem DELETE). Presente como variável de usuário do Windows (len 133).
- Migrations já aplicadas antes desta rodada: até `20260915173122_add_ai_campaign_intelligence`.
- **Pendente:** `20260919120000_add_email_campaign_channel` (ver §5).

## 2. Regras absolutas (do usuário — não relaxar)

1. Nunca tocar `main`, Railway Production, Vercel Production, Customer OS.
2. **Nenhum envio real** de e-mail ou WhatsApp. Flags fixas: `WHATSAPP_DRY_RUN=true`, `AUTOMATION_SEND_ENABLED=false`, `REMARKETING_ENABLED=false`, `ENABLE_INTERNAL_CRON=false`, `EMAIL_SEND_ENABLED=false`. Não escolher/integrar provedor de e-mail.
3. **Segmentação determinística no backend; a IA só escreve copy** depois que o backend decide público/campanha.
4. **NO_PII_TO_AI**: nunca enviar nome/e-mail/telefone/id/pedido para Groq/OpenAI; só agregados.
5. Consentimento de e-mail **não existe** → `EMAIL_MARKETING_CONSENT_SOURCE=NOT_CONFIGURED`, `sendEligibleCount=null`. `WhatsappConsent`/`Customer.optOut` (origem WhatsApp) **não** valem para e-mail.
6. Segredos: nunca imprimir/logar/gravar em arquivo versionado/expor fragmentos. Padrão do usuário: segredo entra como **variável de USUÁRIO do Windows**; ler fresco no MESMO comando (`[Environment]::GetEnvironmentVariable("X","User")`), nunca digitar o valor num comando. O classificador do auto-mode bloqueia (corretamente) valor literal de credencial, `vercel env rm` e arquivo temporário com segredo — não contornar; pedir ao usuário.
7. `crm_ai_preview_writer` **nunca** ganha DELETE nem privilégio extra “por conveniência”. Sem fallback de `AI_DATABASE_URL` para `DATABASE_URL`. Sem fallback automático entre providers.
8. Dados de teste 100% sintéticos, marcados `[PREVIEW_HTTP_SMOKE_TEST]` (via UPDATE; nunca DELETE). Oportunidades **não são persistidas** (calculadas de agregados, sem PII).
9. Commits só na branch; mensagem termina com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; push para `origin` **e** `v0mirror`; confirmar `HEADS_MATCH`. Não commitar `.env`.
10. O usuário quer autonomia: só parar por bloqueio externo genuíno.

## 3. O que foi implementado (mapa de arquivos)

### Banco
- `prisma/schema.prisma`: enum `CampaignChannel {WHATSAPP, EMAIL}`; `CampaignDraft.channel @default(WHATSAPP)` + `@@index([channel])`; `OpportunityType` +13 valores `EMAIL_*`.
- `prisma/migrations/20260919120000_add_email_campaign_channel/migration.sql` — **puramente aditiva**; conferida contra `prisma migrate diff` oficial (idêntica statement a statement). Linhas antigas viram `WHATSAPP` pelo DEFAULT. Não toca customers/orders/Customer OS.

### Backend (novos)
- `src/services/emailAudienceEngine.ts` — engine determinístico. 1 query SQL agregada (sem LIMIT, sem `rawPayload`, sem e-mail no SELECT final) devolve **uma linha por identidade** (e-mail normalizado) → classificação pura em TS. 17 segmentos (11 oficiais + `HIGH_VALUE_NON_VIP`, `RECENT_CART_ABANDONER`, `UNDATED_BUYERS` + 3 `NEEDS_DATA`: `CATEGORY_AFFINITY`, `ENGAGED_EMAIL_NO_PURCHASE`, `BROWSE_NO_PURCHASE`). Cache 60 s (desligado em `NODE_ENV=test`).
- `src/services/emailCampaignLibrary.ts` — biblioteca oficial de **33 campanhas** versionada (`email-campaign-library-v1`), 3 direções A/B/C cada, requisitos hard/soft, capacidades reais (`EMAIL_DATA_CAPABILITIES`). 14 campanhas `NEEDS_DATA` hoje (19 prontas) (novidade/ranking/reposição/categoria/produto complementar/navegação/curadoria com produtos).
- `src/services/emailCampaignRecommendationService.ts` — cruza audiência × biblioteca × requisitos × prioridade × cooldown; devolve `recommendations` (todos os pares) e **`plan`** (1 entrada por campanha = melhor público; `alternativeTo` quando 2 campanhas da mesma trilha disputam o mesmo público).
- `src/services/emailOpportunityService.ts` — oportunidades `channel:'email'` (ids `opp_email_<segmento>_<AAAA-MM-DD>`).
- `src/services/emailSendGate.ts` — gate de envio **fail-closed por construção** (provedor/consentimento/descadastro são constantes `false`, não env). `campaignService.schedule()` de draft de e-mail sempre lança `EmailSendNotAvailableError` → 409 `EMAIL_SEND_NOT_AVAILABLE`.
- `src/routes/emailIntelligence.routes.ts` — **somente GET**, atrás do `crmAuth`: `GET /crm-api/email/audiences`, `/campaign-library`, `/recommendations`.
- `src/config/env.ts`: `EMAIL_SEND_ENABLED` (default false).

### Backend (alterados)
- `src/services/aiOpportunityEngine.ts`: `Opportunity = WhatsappOpportunity | EmailOpportunity`; `channel` (opcional = whatsapp p/ compat); `getOpportunityById` roteia `opp_email_*`.
- `src/services/ai/*`: mesmo pipeline generalizado. `aiProvider.ts` (schemas Zod de e-mail: `subject/preheader/headline/body/cta`; `Strategy` = união; `strategyText()`), `campaignPromptContract.ts` (`EMAIL_SYSTEM_PROMPT`, `EMAIL_PROMPT_VERSION=email-campaign-strategies-v1`, JSON Schema p/ Anthropic), `openAiProvider/groqProvider/anthropicProvider` (escolhem schema/prompt pelo canal), `complianceService` (auditor lê todos os campos de e-mail; claims exclusivas de e-mail: urgência falsa/spam/prova social/benefício; **correção: o nome da marca "D'Rosa" era bloqueado como cor "rosa"**), `strategyDistanceService`, `strategyQualityRubric` (critérios de e-mail: assunto, preheader, adequação), `strategyPlaybook` (`resolveDirectionDefinitions` genérico), `campaignService` (channel + `campaignKey` + validação fail-closed **antes** de qualquer escrita + snapshot com `segmentKey/segmentName/campaignKey`).
- `src/routes/aiCampaigns.routes.ts`: `GET /opportunities?channel=whatsapp|email|all` (padrão whatsapp inalterado); `POST /campaigns` aceita `campaignKey` opcional (`^[A-Z0-9_]{3,60}$`); 422 `EMAIL_CAMPAIGN_*`, 409 `EMAIL_SEND_NOT_AVAILABLE`. **`idempotencyKey` continua obrigatória.**

### UI (`public/crm-v2/app.js` + `app.css`)
Nova aba **E-mail** em Campanhas & IA (Oportunidades · E-mail · Campanhas · Automações · Aprendizados): (1) Visão da base (11 cards), (2) Segmentos, (3) O que fazer agora (plan, botão "Gerar com IA"), (4) Biblioteca (filtros, status `PRONTA`/`NEEDS_DATA`/`SEND_ELIGIBILITY_UNVERIFIED`). Detalhe da campanha de e-mail (canal, segmento, tamanho, A/B/C com assunto/preheader/headline/corpo/CTA/qualidade/Product Truth/Compliance); agendamento de e-mail desabilitado; aprovação humana obrigatória. Idempotency key por **oportunidade+campanha**. Nota: os arquivos estavam CRLF e foram convertidos p/ LF na cópia de trabalho (git normaliza; diff limpo).

### Testes novos (~220)
`emailAudienceEngine`, `emailCampaignLibrary`, `emailCampaignRecommendationService` (+plano), `emailAiContract` (3 providers), `emailComplianceAndQuality`, `campaignServiceEmail` (pipeline/PII/idempotência/P2002/fail-closed/gate/“zero SDK de e-mail”), `integration/emailIntelligenceRoutes`, `integration/emailTabFrontend` (executa o `app.js` real contra o JSON real das rotas), extensão de `appJsIdempotency`. Isolamento global de testes (`src/__tests__/setup.ts`) preservado — nenhum teste acessa Supabase/Groq/OpenAI reais.

## 4. Decisões de design (e por quê) — importantes para não “corrigir” sem querer

- **Identidade** = e-mail normalizado (lower+trim); `Order.customerEmail` com fallback ao e-mail do `Customer` ligado. Cliente/pedido sem e-mail fica fora do universo e aparece só em `base`.
- **Compra válida** = `paymentStatus='paid'` e status ∉ {cancelled, canceled, refunded}. **Data = `sourceCreatedAt` SEM fallback para `createdAt`** (mesmo padrão do remarketing). Sem data → `UNDATED_BUYERS` (fora dos buckets, fail-closed). Data no futuro = anomalia → UNDATED. Buckets por dias inteiros: 0–30, 31–60, 61–90, 91–180, 181–365, 365+ (mutuamente exclusivos; `recencyCheck.overlapFree`).
- **VIP** = limites configurados `VIP_MIN_ORDERS` (3) **e** `VIP_MIN_SPEND` (500). `HIGH_VALUE_NON_VIP` = gasto ≥ limite mas pedidos < limite.
- **Prioridade/conflitos** (trilhas, 1 por cliente): carrinho(2) > pós-compra(3) > segunda compra(4) > recorrente(5) > VIP(6) > reativação(7) > geral(8). Constantes: `EMAIL_LIFECYCLE_WINDOW_DAYS=60` (ciclo de vida só até 60 d; depois é reativação) e `EMAIL_CART_WINDOW_DAYS=7`. Consequência **intencional**: `WINBACK_31_60` sempre fica "coberta por prioridade" (SUPERSEDED) — quem está em 31–60 d já pertence a segunda compra/recorrente/VIP. `exclusiveAudienceCount` = alcance depois das trilhas de maior prioridade; campanhas gerais só avisam.
- **Cooldown**: `NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY` (não há log de envio de e-mail).
- **Opt-out de WhatsApp**: aparece só como `WHATSAPP_OPT_OUT_REVIEW` (revisão humana), nunca reduz audiência nem vira opt-out de e-mail.
- **Sem categoria de produto em lugar nenhum** (confirmado em `docs/evidence-enrichment-report.md`) → segmentos/campanhas de categoria = `NEEDS_DATA`. Para e-mail, `candidateProducts` é sempre `[]` e as direções chegam degradadas com o aviso obrigatório (honesto; a IA não inventa produto).
- Migration com `channel` como coluna (pedido do usuário); `segmentKey/campaignKey` ficam dentro de `audienceSnapshot` (JSON) para manter a migration mínima.

## 5. O QUE FALTA — checklist na ordem

### A. Migration (bloqueio externo — o usuário precisa criar `MIGRATE_DATABASE_URL`)
1. Verificar presença (sem imprimir): `[Environment]::GetEnvironmentVariable("MIGRATE_DATABASE_URL","User")`.
   Formato usado antes: Session pooler `aws-1-us-west-2.pooler.supabase.com:5432`, usuário `postgres.hocrnjuvrufkqjbmmuoo`, com `?sslmode=require&connect_timeout=60` (sem isso dava P1001). O usuário copia a string pelo botão "Copy" do Supabase (nunca digitada à mão). O host **Direct** (`db.<ref>.supabase.co`) é só IPv6 e não alcança daqui.
2. Aplicar (PowerShell, no repo, credencial só no processo filho):
   ```powershell
   $env:DATABASE_URL = [Environment]::GetEnvironmentVariable("MIGRATE_DATABASE_URL","User"); $env:DIRECT_URL = $env:DATABASE_URL
   npx prisma migrate deploy      # esperado: aplica só 20260919120000_add_email_campaign_channel
   npx prisma migrate status      # esperado: "Database schema is up to date!"
   npx prisma db execute --file docs/handoff/scripts/verify_email_migration.sql --schema prisma/schema.prisma   # silêncio/sucesso = OK
   ```
3. **Grant do novo enum para a role de IA** — verificar (não assumir): rodar `verify_ai_role_email.sql` **como a role de IA**:
   ```powershell
   $env:DATABASE_URL = [Environment]::GetEnvironmentVariable("AI_DATABASE_URL","User"); $env:DIRECT_URL = $env:DATABASE_URL
   npx prisma db execute --file docs/handoff/scripts/verify_ai_role_email.sql --schema prisma/schema.prisma
   ```
   Só se falhar em "USAGE em CampaignChannel": aplicar (com a credencial admin, mesma janela) `GRANT USAGE ON TYPE "CampaignChannel" TO crm_ai_preview_writer;` e documentar em `docs/sql/pending-activation/`. Por padrão o Postgres dá USAGE a PUBLIC em tipos, então provavelmente não será necessário. **Não ampliar mais nada.**
4. Pedir ao usuário para **remover** `MIGRATE_DATABASE_URL` depois do uso (mesmo protocolo de antes).

### B. Validar o engine contra o Postgres REAL — antes de qualquer push
O SQL do engine (`queryEmailIdentityRows`/`queryEmailBaseQuality`: regex POSIX de e-mail, `::timestamptz AT TIME ZONE 'UTC'`, comparação com enum `AbandonedCheckoutStatus`, joins) **só rodou contra mocks** — nunca contra um Postgres de verdade. Rodar (somente leitura, sem PII na saída; usa a credencial admin só para SELECT, na mesma janela):
```powershell
cd "<repo>"
$env:REAL_DB_URL = [Environment]::GetEnvironmentVariable("MIGRATE_DATABASE_URL","User")
npx ts-node --project tsconfig.json docs/handoff/scripts/real-counts.ts
```
O script imprime base/segmentos/recência, checa invariantes (ONE+REPEAT+NO_PURCHASE=ALL; buckets+undated=compradores; trilhas somam a audiência; VIP⊆REPEAT) e uma verificação **independente** dos buckets em SQL (formulação diferente). Se falhar/estourar tempo, **corrigir o engine** (ex.: performance sob `connection_limit=2` do Preview; se a agregação for lenta, considerar materializar/limitar joins) antes de seguir. Registrar as contagens reais para o relatório final.

### C. Push e Preview (Git-triggered — NUNCA `vercel deploy`)
1. `git push origin review/crm-v2-visual` e `git push v0mirror review/crm-v2-visual`; confirmar `LOCAL_HEAD == ORIGIN_HEAD == V0MIRROR_HEAD` (`HEADS_MATCH=YES`).
2. Esperar o deployment criado pela integração GitHub ficar `Ready` (`vercel ls`; `vercel inspect <url>` deve mostrar `source: git` via API `/v13/deployments/<id>`).
   **Lição crítica:** deploy por `vercel deploy` (upload CLI) **não resolve** override de env branch-specific quando existe valor global de mesmo nome (3 tentativas falharam com 401 em `CRM_READ_SECRET`); deploy disparado por push Git resolve corretamente.
3. Testar via `vercel curl` (usa a sessão CLI já autenticada; **cria automaticamente um Protection Bypass persistente no projeto** na 1ª vez — o usuário já autorizou usar e **revogar ao final**):
   ```bash
   export MSYS_NO_PATHCONV=1   # Git Bash converte "/health" em C:/Program Files/Git/health
   vercel curl /health --deployment <URL> -y
   SECRET=$(powershell -Command "[Environment]::GetEnvironmentVariable('CRM_READ_SECRET','User')")
   vercel curl /crm-api/email/audiences --deployment <URL> -y -- --header "x-crm-read-secret: $SECRET"
   ```
   (nunca `-v`/imprimir o header). Validar: `/health`, `/health/deep` (`readOnly:true`), `email/audiences`, `email/campaign-library` (≥30), `email/recommendations`, `ai/opportunities?channel=email`.
4. **Geração de e-mail real via HTTP** (Groq): `POST /crm-api/ai/campaigns` com `{opportunityId, idempotencyKey, campaignKey}` — usar oportunidade **agregada** (ex.: `opp_email_lapsed_61_90d_<hoje>` + `WINBACK_61_90`; id do dia vem de `recommendations.plan[].opportunityId`), `idempotencyKey` sintética `PREVIEW-HTTP-SMOKE-TEST-<uuid>`. Validar: 3 estratégias A/B/C com assunto/preheader/headline/corpo/CTA, `channel=EMAIL`, `ai_runs.provider=groq`, `promptVersion=email-campaign-strategies-v1`; sem `idempotencyKey` → 400; mesma key → mesmo draft e **1** `ai_run`; 2 requisições simultâneas com key nova → mesmo draft, 1 `ai_run`; campanha `NEEDS_DATA` (ex.: `NEW_ARRIVALS`) → 422 `EMAIL_CAMPAIGN_NEEDS_DATA` sem draft; `POST .../schedule` (com `x-admin-secret`) de draft de e-mail aprovado → 409 (não testar aprovar em produção real de dado; usar só o que o smoke exige).
   Checar no banco (via `AI_DATABASE_URL`, script ts-node com `require` absoluto + `--project tsconfig.json`) 1 `ai_run` por draft; depois marcar os drafts com `[PREVIEW_HTTP_SMOKE_TEST]` no `opportunityTitle` (UPDATE; **nunca DELETE**).
5. Verificar a UI no Preview (aba E-mail) — pode-se abrir o Preview real no navegador embutido só se autenticar; alternativa: o harness local (§7). Registrar `PREVIEW_EMAIL_UI`.
6. **Revogar o Protection Bypass ao final** (API real: `PATCH /v1/projects/{id}/protection-bypass` com `{"revoke":{"secret":"<token>","regenerate":false}}`; ler o token da API para uma variável de shell — nunca digitar o literal, o classificador bloqueia) e confirmar `302` em requisição sem `vercel curl`.

### D. Fechamento
- Reexecutar `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; usar `rtk proxy <cmd>` para saída crua (o wrapper `rtk` já mostrou resultado de lint enganoso: 512 "no-var-requires" em arquivos `.js` de `dist/` — falso; `rtk proxy npx eslint src --ext .ts` é a verdade).
- Relatório final no template do usuário (§8) com contagens reais.

## 6. Pegadinhas / lições (economizam horas)

- **CRLF**: `public/crm-v2/app.js|css` originais eram CRLF (`core.autocrlf=true`); ferramentas de edição por string falham com CRLF. Já estão LF na cópia de trabalho; git normaliza.
- **Heredoc/`node -e` longos** truncam ou corrompem escapes na ferramenta Bash: para arquivos grandes use a ferramenta Write/Edit.
- **`rtk`** reescreve comandos; use `rtk proxy` para saída crua. `rg` não está no PATH (aviso inofensivo).
- Scripts ts-node fora do repo: usar `require('C:/.../node_modules/...')` com **barras normais**, `--project <repo>/tsconfig.json`, `require` (não `import`, hoisting quebra a ordem de env). Scripts dentro de `docs/handoff/scripts/` já usam caminhos absolutos do repo.
- Windows: variável de usuário nova **não** aparece no processo já aberto; ler fresco via `[Environment]::GetEnvironmentVariable(...)` no mesmo comando.
- `vercel env add` por pipe do PowerShell funciona (remove o `\n` final); `vercel env rm` e literal de credencial são bloqueados pelo classificador → pedir ao usuário.
- Auditor de compliance bloqueia palavras como "exclusivo", "oferta", "premium" também em `creativeBrief` (mesmo em negação: "sem oferta") — falso-positivo conhecido/antigo, não é bug novo.
- Front-end: testes de contrato (`crmV2Frontend.test.ts`) proíbem `localStorage`, `JSON.stringify` fora de `apiPost*` e `fetch` de escrita fora de `apiPost/apiPostAdmin`; `appJsIdempotency.test.ts` executa o trecho entre `const pendingCampaignIdempotencyKeys` e `// ── ÁREA: CAMPANHAS & IA · ABA CAMPANHAS` (não colocar código com efeito colateral nesse trecho).
- `crmPreviewReadonly`: em Preview read-only só `POST /crm-api/ai/campaigns*` escreve; as rotas `/crm-api/email/*` são GET e funcionam.
- Preview tem `connection_limit=2` (forçado em `src/config/prisma.ts`); o engine consulta sequencialmente de propósito.

## 7. Como ver a UI localmente (sem banco)
Entrada `drosa-crm-ui-harness` em `C:\Users\peter\OneDrive\Área de Trabalho\claude -meta ads\.claude\launch.json` (porta 3457) roda `docs/handoff/scripts/ui-harness.ts`: Express **real** em modo Preview read-only com serviços de banco trocados por ~48 mil identidades sintéticas processadas pelo engine real. Abrir `http://localhost:3457/crm-v2`, no console do navegador: `sessionStorage.setItem('crmV2Secret','harness-secret'); state.secret='harness-secret'; state.section='automations'; state.tab='email'; render()`. Já verificado visualmente em desktop 1360 e mobile 375 (sem overflow horizontal).

## 8. Template do relatório final (preencher no fim)
```
FINAL_STATUS=COMPLETE
EMAIL_CAMPAIGN_INTELLIGENCE=COMPLETE | EMAIL_AUDIENCE_ENGINE=PASS | EMAIL_CAMPAIGN_LIBRARY=PASS | EMAIL_RECOMMENDATION_ENGINE=PASS | EMAIL_AI_GENERATION=PASS
SEGMENTS_IMPLEMENTED=17 (11 oficiais + 3 dados-suportados/diagnóstico + 3 NEEDS_DATA)   CAMPAIGNS_IMPLEMENTED=33
REAL_COUNTS= ALL_EMAIL_CUSTOMERS / ONE_TIME_BUYERS / REPEAT_BUYERS / VIP_CUSTOMERS / RECENT_BUYERS_0_30D / LAPSED_31_60D / LAPSED_61_90D / LAPSED_91_180D / LAPSED_181_365D / DORMANT_365D_PLUS / NO_PURCHASE_CUSTOMERS = <pendente: §5.B>
EMAIL_CONSENT_SOURCE=NOT_CONFIGURED   EMAIL_SEND_ELIGIBILITY=NOT_READY   EMAIL_SEND_ENABLED=false   REAL_EMAIL_SENT=NO   NO_PII_TO_AI=PASS
TYPECHECK/LINT/TESTS(760+ )/BUILD = PASS (reconfirmar)   PREVIEW_STATUS / PREVIEW_EMAIL_UI = <pendente>
LOCAL_HEAD / ORIGIN_HEAD / V0MIRROR_HEAD / HEADS_MATCH = <pendente: hoje local=52c9dd4, origin=mirror=c32e8f3>
MAIN_CHANGED=NO  RAILWAY_PRODUCTION_CHANGED=NO  VERCEL_PRODUCTION_CHANGED=NO  CUSTOMER_OS_TOUCHED=NO
```
Smoke HTTP a reportar: `EMAIL_AUDIENCE_ENGINE, EMAIL_LIBRARY, EMAIL_RECOMMENDATIONS, EMAIL_AI_GENERATION, EMAIL_THREE_STRATEGIES, EMAIL_SUBJECT, EMAIL_PREHEADER, EMAIL_BODY, EMAIL_CTA, NO_PII_TO_AI, IDEMPOTENCY, NO_REAL_EMAIL_SENT, NO_REAL_WHATSAPP_SENT`, + `BYPASS_SECRET_REVOKED=YES`, `SECRETS_EXPOSED=NO`.

## 9. Riscos / decisões a confirmar com o usuário quando útil
- Janelas `EMAIL_LIFECYCLE_WINDOW_DAYS=60` e `EMAIL_CART_WINDOW_DAYS=7` são política (constantes nomeadas), não dado — ajustar se o negócio quiser.
- Pedidos pagos **sem `sourceCreatedAt`** podem ser numerosos; o real-counts mostra quantos (`paidOrdersWithoutDate`). Se forem muitos, decidir com o usuário se vale um backfill de data de origem.
- Com muitos milhares de identidades a query agrega tudo por request (cache 60 s). Se a latência no Preview (`connection_limit=2`) for ruim, materializar/pré-agregar.
- Persistência do histórico de migrations: se o usuário preferir aplicar o SQL manualmente no Supabase, será preciso `prisma migrate resolve --applied 20260919120000_add_email_campaign_channel` (também exige credencial admin).
