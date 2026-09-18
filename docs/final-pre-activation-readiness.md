# Final Pre-Activation Readiness

Estado: **preparado, não ativado.** Nada neste documento foi executado contra
Preview ou Produção — só código e SQL prontos para quando a ativação real for
autorizada separadamente.

## O que já funciona hoje, sem nenhuma ação humana

- `POST /crm-api/ai/campaigns` (gerar campanha) responde **503
  `AI_DATABASE_NOT_CONFIGURED`** enquanto `AI_DATABASE_URL` não existir —
  nenhuma escrita, nenhuma chamada paga ao provedor de IA.
- `list()`/`getById()`/`approve()`/`schedule()`/`cancel()` continuam
  funcionando exatamente como antes (leem/escrevem no mesmo banco
  compartilhado de hoje) — nada quebra para quem já usa a tela.
- `schedule()` agora exige que o template WhatsApp da oportunidade esteja com
  aprovação **real** confirmada na Meta (`verifyMetaTemplateContract`) —
  copy gerada pela IA nunca é tratada como prova de aprovação de template.
- Timeout explícito (`AI_REQUEST_TIMEOUT_MS`), limite de tokens de saída
  (`AI_MAX_OUTPUT_TOKENS`), limite de gerações simultâneas
  (`AI_MAX_CONCURRENT_GENERATIONS`) e limite por minuto
  (`AI_GENERATION_MAX_PER_MINUTE`) já valem para os dois provedores, com os
  mesmos valores — sem exceção "especial" para nenhum dos dois.
- `createFromOpportunity(opportunityId, idempotencyKey?)` aceita uma key
  opcional: reenviar a MESMA key (retry de uma mesma ação humana) devolve o
  draft já criado, sem chamar a IA de novo. Uma key nova (nova ação humana)
  sempre gera uma chamada nova.
- Erros persistidos em `ai_runs.errorMessage` passam por
  `sanitizeErrorMessage()` — nenhum valor real de segredo configurado no
  ambiente (chaves de IA, `ADMIN_SECRET`, `JOBS_SECRET`, `META_ACCESS_TOKEN`,
  `NUVEMSHOP_ACCESS_TOKEN`, connection strings) pode aparecer nessa coluna,
  mesmo que a exceção original o contivesse.

## O que precisa de uma ação humana explícita para ativar

1. **Provisionar o banco isolado** para `campaign_drafts`/`ai_runs` e aplicar
   o schema nele (`prisma migrate deploy` ou equivalente — não incluído
   aqui).
2. **Rodar** `docs/sql/pending-activation/01-ai-database-least-privilege.sql`
   nesse banco isolado — cria `crm_ai_preview_writer` com `SELECT/INSERT/
   UPDATE` só em `campaign_drafts`/`ai_runs`, connection limit baixo, e
   define a senha do role fora do repositório.
3. **Rodar** `docs/sql/pending-activation/02-campaign-draft-idempotency-key.sql`
   — fecha a lacuna de corrida verdadeira (dois cliques simultâneos com a
   mesma idempotencyKey); o retry sequencial já é protegido sem este índice.
4. **Configurar `AI_DATABASE_URL`** apontando para esse banco, usando a
   credencial do `crm_ai_preview_writer` — a partir daqui,
   `createFromOpportunity()` passa a gravar (e `list()`/`getById()`/etc. a
   ler) nesse banco isolado.
5. **Configurar `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`** (o provedor ativo é
   escolhido por `AI_PROVIDER`) — sem isso, a geração continua bloqueada,
   agora por `AiProviderConfigError` (503 `AI_PROVIDER_NOT_CONFIGURED`) em
   vez de `AI_DATABASE_NOT_CONFIGURED`.
6. **Aprovar de verdade, na Meta,** o template WhatsApp de cada segmento que
   for usar `schedule()` — sem isso, `schedule()` continua bloqueado por
   `CampaignTemplateNotApprovedError` (409 `TEMPLATE_NOT_APPROVED`).
7. Ainda não existe nenhum job de **envio real** de campanha (só o estado
   `SCHEDULED` é alcançável hoje) — `REAL_SEND_ENABLED` não é lido em nenhum
   lugar deste caminho de código porque não há nada ainda para esse flag
   ligar; quando esse job for escrito, ele deve reusar
   `assertTemplateApprovedForSend`-como-padrão (fail-closed) em vez de um
   flag isolado.

## Limitações conhecidas, documentadas de propósito

- **Rate limit e concorrência são em memória, por instância.** Corretos para
  a fase atual do Preview (uma instância). Se/quando escalar para múltiplas
  instâncias simultâneas, isto precisa virar um contador compartilhado
  (Postgres/Redis) — não implementado agora porque não é necessário ainda.
- **Idempotência sem o índice aplicado** protege contra retry sequencial
  (uma requisição de cada vez), não contra dois cliques literalmente
  simultâneos — só o índice único (script 02) fecha essa lacuna.
