# Ingestão contínua do livro-razão de consentimento de e-mail

Data: 2026-09-29 (rev. 2026-09-30) · Status: SPEC (implementação depois de aprovada) · Escopo: só e-mail.

## Problema
O livro-razão (`email_consent_events` + projeção `email_marketing_consents`) só é alimentado por
**backfill manual** (`runBackfillEmailConsent`) e por descadastro (`CRM_UNSUBSCRIBE`). Pedidos e
checkouts novos **não** geram evento. Quem marcou "aceito receber ofertas" depois do último backfill
fica `NOT_COLLECTED` e nunca entra numa campanha, enquanto o gate de envio (correto, fail-closed) só
libera `CONFIRMED_OPT_IN`. Não é bug de ingestão: é ausência de ingestão.

## Decisão (revisada): durável, sem trabalho em memória pós-resposta
Revisão do rascunho anterior: **não** ingerir no `setImmediate` do webhook. Em Cloud Run a instância
pode ser encerrada/suspensa depois da resposta HTTP e o evento se perderia. O ledger não pode depender disso.

O `WebhookEvent` já é persistido **antes** do 200 (fonte durável). A ingestão passa a ficar no mesmo
lugar de durabilidade do próprio pedido/checkout:

1. **Ingestão transacional junto com a persistência do pedido/checkout.** Dentro da transação que já
   grava o pedido (`orderService`, `prisma.$transaction`) e a que grava o checkout, inserir o
   `EmailConsentEvent` e recomputar a projeção daquele `emailHash`. Pedido persistido ⇔ evento no
   ledger: mesma durabilidade, sem fila nova, sem chamada externa, custo = 1 hash em memória + 1 insert
   (`createMany skipDuplicates` = `ON CONFLICT DO NOTHING`, que não aborta a transação) + 1 upsert.
   Ausência de pepper ou payload sem sinal ⇒ não faz nada (fail-closed) e nunca falha o pedido.
2. **Reconciliação incremental durável (rede de segurança).** Job `POST /jobs/backfill-email-consent-incremental`
   (Scheduler OIDC, 1×/dia) que lê **do banco** (pedidos e checkouts já persistidos, por cursor de
   `updatedAt`) e cobre qualquer lacuna: deploys sem o passo 1, falhas isoladas, eventos antigos. Como lê
   estado persistido, um processo morto não perde nada. Dry-run por padrão.
3. Se o próprio processamento assíncrono do pedido se perder (`webhook_events.processed = false`), isso já é
   o problema existente de replay de webhook; ao reprocessar, o passo 1 roda junto. O passo 2 não depende disso.

## Semântica do consentimento (sem promessa jurídica)
- `customer.accepts_marketing` da Nuvemshop é **evidência observada** da Nuvemshop, registrada com
  `source`, `evidenceRef`, `sourceUpdatedAt` e `capturedAt`. Não é "consentimento jurídico definitivo".
  O gate jurídico C continua humano; UI e relatórios dizem "opt-in de checkout (ledger)".
- Fontes mantidas: `NUVEMSHOP_ORDER_PAYLOAD`, `NUVEMSHOP_CHECKOUT_PAYLOAD`. Nenhuma fonte nova. Só
  `NUBESDK_EXPLICIT` levanta revogação.
- Só `accepts_marketing` (+ timestamp do payload) é lido; nunca o objeto `customer`, nome, telefone,
  documento ou endereço. E-mail vira **HMAC (`emailHash`)** em memória com `EMAIL_HASH_PEPPER`; nunca
  persistido nem logado em claro.
- Idempotência: `(emailHash, source, evidenceRef)` (constraint existente); `evidenceRef` = id opaco do
  pedido/checkout. Reprocessar = no-op. A projeção é recalculada com `resolveEmailConsent`, nunca escrita direto.
- Ausente/`false` nunca vira `OPT_IN`. `UNKNOWN`/`NOT_COLLECTED` não enviam. Descadastro e supressão
  vencem qualquer `OPT_IN` posterior de payload.

## Backfill incremental 24/09/2026 → atual (uma vez)
1. **Dry-run primeiro**, sem escrita, só agregados (sem e-mail, hash ou id):
   `ordersSeen`, `checkoutsSeen`, `wouldCreateOptIn`, `wouldCreateOptOut`, `wouldCreateUnknown`,
   `duplicates`, `conflicts` (mesmo hash com sinais contraditórios), mais transições
   `NOT_COLLECTED → OPT_IN/OPT_OUT`.
2. Conferir contra a contagem atual do ledger (opt-in 2186 na última leitura).
3. Só com autorização explícita: `dryRun:false`. Nenhuma escrita automática.

## Componentes
| Peça | Mudança |
|---|---|
| `emailConsentIngestService` (novo) | `buildConsentEventFromOrder/Checkout(payload)` puro + `recordInTx(tx, event)`; erros viram categoria fechada, nunca `error.message`. |
| `orderService` / persistência de checkout | Chamam `recordInTx` dentro da transação existente; falta de pepper ou sinal ⇒ no-op. |
| `backfillEmailConsent` | Ganha `since?: Date` e devolve `nextCursor` + os agregados acima; dry-run padrão. |
| Job incremental + Scheduler | Rota atrás de `jobsAuth`; Scheduler só por OIDC (nunca `JOBS_SECRET` estático); `AutomationJobRun` (`email_consent_ingest`) quando a telemetria estiver aplicada. |
| Métricas (Campanhas) | `consentOptInCount` já existe; acrescentar "última atualização do ledger" e eventos das últimas 24 h. |

## Testes (TDD)
- opt-in / opt-out / ausente / `false` → estados corretos; reprocessar o mesmo `evidenceRef` = 0 escritas novas.
- Falha do passo de ledger não impede persistir o pedido; pedido revertido ⇒ nenhum evento órfão (mesma transação).
- Descadastro anterior + novo opt-in de checkout ⇒ continua bloqueado.
- Payload malformado/e-mail inválido ⇒ ignorado com categoria fechada.
- Nenhum log/saída contém e-mail, hash, nome, telefone ou payload.
- Concorrência: dois eventos do mesmo hash ⇒ projeção final consistente.
- Job incremental: cursor avança só após sucesso; dry-run não escreve.

## Fora de escopo
Enviar e-mail, alterar gates A–D, mudar `emailSendGate`, DMARC/DNS, consentimento de WhatsApp.

## Riscos
- Transação do pedido fica um pouco mais longa: 1 hash + 1 insert + 1 upsert, sem rede; pool=1 respeitado.
- Pepper ausente → ingestão desliga (fail-closed) com categoria `pepper_not_configured`.
