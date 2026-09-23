# Final Pre-Activation Readiness

Estado: **preparado, não ativado.** Nada neste documento foi executado contra
Preview ou Produção — só código e SQL prontos para quando a ativação real for
autorizada separadamente.

## O que já funciona hoje, sem nenhuma ação humana

- Toda operação de IA — `list()`, `getById()`, `getLearningSummary()`,
  `createFromOpportunity()`, `selectStrategy()`, `approve()`, `schedule()`,
  `cancel()` — responde **503 `AI_DATABASE_NOT_CONFIGURED`** enquanto
  `AI_DATABASE_URL` não existir. `getAiPrisma()` (`src/config/aiPrisma.ts`)
  nunca cai de volta para o banco compartilhado (`DATABASE_URL`), nem para
  leitura — campaign_drafts/ai_runs só existem, do ponto de vista deste
  código, dentro do banco isolado por `AI_DATABASE_URL`.
- `GET /crm-api/ai/opportunities` continua funcionando sem `AI_DATABASE_URL`
  — usa só o banco primário read-only (`aiOpportunityEngine`/
  `remarketingService`), nunca toca `campaign_drafts`/`ai_runs`.
- `schedule()` exige que o template WhatsApp da oportunidade esteja com
  aprovação **real** confirmada na Meta (`verifyMetaTemplateContract`) —
  copy gerada pela IA nunca é tratada como prova de aprovação de template.
- Timeout explícito (`AI_REQUEST_TIMEOUT_MS`), limite de tokens de saída
  (`AI_MAX_OUTPUT_TOKENS`), limite de gerações simultâneas
  (`AI_MAX_CONCURRENT_GENERATIONS`) e limite por minuto
  (`AI_GENERATION_MAX_PER_MINUTE`) já valem para os dois provedores, com os
  mesmos valores — sem exceção "especial" para nenhum dos dois.
- `POST /crm-api/ai/campaigns` exige `idempotencyKey` no corpo (400
  `IDEMPOTENCY_KEY_REQUIRED` se ausente/formato inválido) — gerada no
  frontend por clique humano (`crypto.randomUUID()`, só em memória, nunca
  `localStorage`/`sessionStorage`; ver `public/crm-v2/app.js`). Reenviar a
  MESMA key (retry sequencial) devolve o draft já criado, sem chamar a IA de
  novo. Duas requisições concorrentes com a MESMA key (corrida real) são
  resolvidas pela constraint `UNIQUE` de `CampaignDraft.idempotencyKey`: a
  que perder a corrida do `create()` recebe `P2002` do Postgres, busca o
  draft vencedor e o devolve — nunca chama o provedor uma segunda vez.
- Erros persistidos em `ai_runs.errorMessage` nunca guardam a mensagem de
  exceção (mesmo redigida) — só uma categoria fechada (`AI_TIMEOUT`,
  `AI_RATE_LIMIT`, `AI_PROVIDER_ERROR`, `AI_SCHEMA_ERROR`, `AI_CONFIG_ERROR`,
  `AI_UNKNOWN_ERROR`). Nunca corpo de requisição, prompt bruto, resposta
  bruta, stack trace ou segredo.

## Mesmo Supabase, role separado (não um segundo banco físico)

`AI_DATABASE_URL` aponta para o **mesmo** Supabase/Postgres já usado hoje pelo
Preview — não é uma instância nova a provisionar. A diferença é só a
credencial:

- `DATABASE_URL` → role `crm_preview_reader`, read-only, já em uso hoje.
- `AI_DATABASE_URL` → role `crm_ai_preview_writer`, `SELECT/INSERT/UPDATE`
  apenas em `campaign_drafts`/`ai_runs`, sem `DELETE`, sem acesso a nenhuma
  outra tabela (ver `docs/sql/pending-activation/01-ai-database-least-privilege.sql`).

## O que precisa de uma ação humana explícita para ativar

1. **Aplicar a migration inicial**
   (`prisma/migrations/20260915173122_add_ai_campaign_intelligence` — já
   inclui a coluna `idempotencyKey` e seu índice único) neste MESMO Supabase,
   via `prisma migrate deploy` ou equivalente — não incluído aqui.
2. **Rodar** `docs/sql/pending-activation/01-ai-database-least-privilege.sql`
   — cria `crm_ai_preview_writer` com `SELECT/INSERT/UPDATE` só em
   `campaign_drafts`/`ai_runs`, connection limit baixo, e define a senha do
   role fora do repositório. Nunca toca `crm_preview_reader`.
3. **Configurar `AI_DATABASE_URL`** com a credencial do
   `crm_ai_preview_writer` — a partir daqui, toda operação de IA passa a
   gravar/ler nesse role dedicado, no mesmo Supabase.
4. **Configurar `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`** (o provedor ativo é
   escolhido por `AI_PROVIDER`) — sem isso, a geração continua bloqueada,
   agora por `AiProviderConfigError` (503 `AI_PROVIDER_NOT_CONFIGURED`) em
   vez de `AI_DATABASE_NOT_CONFIGURED`.
5. **Aprovar de verdade, na Meta,** o template WhatsApp de cada segmento que
   for usar `schedule()` — sem isso, `schedule()` continua bloqueado por
   `CampaignTemplateNotApprovedError` (409 `TEMPLATE_NOT_APPROVED`).
6. Ainda não existe nenhum job de **envio real** de campanha (só o estado
   `SCHEDULED` é alcançável hoje) — `REAL_SEND_ENABLED` não é lido em nenhum
   lugar deste caminho de código porque não há nada ainda para esse flag
   ligar; quando esse job for escrito, ele deve reusar
   `assertTemplateApprovedForSend`-como-padrão (fail-closed) em vez de um
   flag isolado.

## Limitações conhecidas, documentadas de propósito

- **Rate limit e concorrência de geração são em memória, por instância.**
  Corretas para a fase atual do Preview (uma instância). Se/quando escalar
  para múltiplas instâncias simultâneas, isto precisa virar um contador
  compartilhado (Postgres/Redis) — não implementado agora porque não é
  necessário ainda. A idempotência de `campaign_drafts` (seção acima) já não
  tem essa limitação — é garantida pelo `UNIQUE` do Postgres, não por memória
  de processo.
