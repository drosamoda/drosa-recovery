# Ingestão contínua do livro-razão de consentimento de e-mail

Data: 2026-09-29 · Status: SPEC (implementação depois de aprovada) · Escopo: só e-mail.

## Problema
O livro-razão (`email_consent_events` + projeção `email_marketing_consents`) só é
alimentado por **backfill manual** (`runBackfillEmailConsent`) e por descadastro
(`CRM_UNSUBSCRIBE`). Pedidos e checkouts novos **não** geram evento. Com o tempo,
clientes que marcaram "aceito receber ofertas" após o último backfill ficam
`NOT_COLLECTED` e nunca entram numa campanha, enquanto o gate de envio (correto,
fail-closed) só libera `CONFIRMED_OPT_IN`. Não é bug de ingestão: é ausência de ingestão.

## Decisão
Duas camadas, ambas **idempotentes** e **append-only**:
1. **Tempo quase real**: ao processar um webhook de pedido/checkout da Nuvemshop, depois de
   responder 200 e dentro do `setImmediate` já existente, extrair o sinal de marketing do
   payload e gravar o evento do livro-razão.
2. **Rede de segurança incremental**: job `POST /jobs/backfill-email-consent-incremental`
   (Scheduler OIDC, 1×/dia) que reprocessa pedidos/checkouts com `updatedAt`/`createdAt`
   maiores que o cursor, com dry-run por padrão. Corrige webhooks perdidos.

## Regras (herdadas do resolvedor atual; nada novo é inventado)
- Fontes mantidas: `NUVEMSHOP_ORDER_PAYLOAD`, `NUVEMSHOP_CHECKOUT_PAYLOAD`. Não criar fonte nova
  nem renomear. `NUBESDK_EXPLICIT` continua sendo a única que levanta revogação.
- Só o sinal `accepts_marketing` (+ timestamp do próprio payload) é lido. Nunca copiar o objeto
  `customer`, nome, telefone, documento ou endereço. O e-mail vira **HMAC (`emailHash`)** em memória
  com `EMAIL_HASH_PEPPER`; o e-mail em claro não é persistido nem logado.
- Chave de idempotência: `(emailHash, source, evidenceRef)` (constraint já existente).
  `evidenceRef` = id opaco do pedido/checkout Nuvemshop. Reprocessar = no-op.
- Após inserir, **recalcular a projeção só daquele `emailHash`** com `resolveEmailConsent`
  (mesma função do backfill). A projeção nunca é escrita diretamente.
- Evento ausente/`false` nunca vira `OPT_IN`. `UNKNOWN` e `NOT_COLLECTED` não enviam.
- Descadastro (`CRM_UNSUBSCRIBE`) e supressão vencem qualquer `OPT_IN` posterior de payload.
- Isto **não** é consentimento jurídico definitivo: enquanto o gate C (aprovação jurídica) estiver
  pendente, a UI e os relatórios dizem "opt-in de checkout (ledger)", nunca "consentimento válido".

## Componentes
| Peça | Mudança |
|---|---|
| `emailConsentIngestService` (novo) | `ingestFromOrderPayload(order)` / `ingestFromCheckoutPayload(checkout)`: valida, gera hash, chama `recordEmailConsentEventByHashInTx` + recomputa a projeção; erros viram categoria fechada, nunca `error.message`. |
| Webhook Nuvemshop | Após persistir pedido/checkout e responder 200, `setImmediate(() => ingest…)`. Falha aqui **nunca** afeta a resposta nem o processamento do pedido. |
| `backfillEmailConsent` | Ganha `since?: Date` (cursor) e devolve `nextCursor`; dry-run continua padrão. |
| Job incremental + Scheduler | Rota nova atrás de `jobsAuth`; Scheduler só por OIDC (nunca `JOBS_SECRET` estático). Registra `AutomationJobRun` (`email_consent_ingest`) quando a telemetria estiver aplicada. |
| Métricas (Campanhas) | `consentOptInCount` já existe; acrescentar "última atualização do ledger" e contagem de eventos das últimas 24 h. |

## Backfill incremental 24/09 → hoje (uma vez, dry-run antes)
1. Dry-run com `since = 2026-09-24`: imprime só agregados (eventos novos por fonte/estado,
   e-mails novos, transições `NOT_COLLECTED → OPT_IN/OPT_OUT`). Sem e-mail, hash ou id.
2. Conferir contra a contagem atual (opt-in do ledger 2186 na última leitura).
3. Só com autorização explícita: `dryRun:false` (grava eventos + recomputa projeção afetada).

## Testes (TDD)
- opt-in / opt-out / ausente / `false` → estados corretos; reprocessar o mesmo `evidenceRef` = 0 escritas novas.
- descadastro anterior + novo opt-in de checkout ⇒ continua bloqueado.
- Payload malformado ou e-mail inválido ⇒ ignorado com categoria fechada; webhook responde 200.
- Nenhum log/saída contém e-mail, hash, nome, telefone ou payload.
- Falha do ledger não muda a resposta do webhook nem o salvamento do pedido.
- Concorrência: dois eventos simultâneos do mesmo hash ⇒ projeção final consistente (unique + recomputação).

## Fora de escopo
Enviar e-mail, alterar gates A–D, mudar `emailSendGate`, DMARC/DNS, consentimento de WhatsApp.

## Riscos e mitigação
- Webhook duplicado/fora de ordem → idempotência por chave única + recomputação determinística.
- Aumento de escrita no banco → 1 insert + 1 upsert por pedido com marketing; pool=1 respeitado (fora do caminho crítico, em `setImmediate`).
- Pepper ausente → ingestão desliga (fail-closed) e registra categoria `pepper_not_configured`.
