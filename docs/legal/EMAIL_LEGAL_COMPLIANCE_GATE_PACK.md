# EMAIL LEGAL & COMPLIANCE GATE PACK — D'ROSA

Pacote **factual** (2026-09-30, `main` ≥ `bfe2407`) para o jurídico/dono decidir os gates. **Não é parecer jurídico**,
não concede aprovação e não conclui base legal. Cada fato abaixo vem do código, do schema ou de leitura de
configuração/DNS; nada foi alterado.

## 1. O que é coletado (ledger de consentimento)
Tabelas `email_consent_events` (append-only) e `email_marketing_consents` (projeção derivada, recalculável).
Cada evento guarda: `emailHash` (HMAC-SHA256 do e-mail normalizado com pepper de servidor), `source`,
`evidenceRef` (id opaco do pedido/checkout, sem e-mail/nome/telefone), `sourceUpdatedAt`, `capturedAt`,
`status` (OPT_IN/OPT_OUT/UNKNOWN) e `customerId` opcional. **O e-mail em claro não é gravado no ledger.**
`accepts_marketing` da Nuvemshop é registrado como **evidência observada** (valor booleano e a data do próprio
payload); o sistema não o trata como consentimento jurídico definitivo.

## 2. Fontes de evidência
`NUVEMSHOP_ORDER_PAYLOAD`, `NUVEMSHOP_CHECKOUT_PAYLOAD`, `NUVEMSHOP_CUSTOMER_API` (previsto na regra, hoje sem job
de carga em `main`), `NUBESDK_EXPLICIT`, `CRM_UNSUBSCRIBE`, `PROVIDER_EVENT`, `MANUAL_IMPORT`.
Pedido/checkout são retratos do momento da compra; só "string `true`", número ou ausência **não** viram sinal.
Ingestão contínua (#86) existe em código, **desligada** (`EMAIL_CONSENT_CONTINUOUS_INGESTION_ENABLED=false`).
Carga histórica: backfill manual anterior (ledger com OPT_IN confirmado em 2186 e-mails na leitura de 29/09).
Evidência observada ≠ conclusão jurídica.

## 3. Lógica de audiência
- Elegível para envio: **somente** `CONFIRMED_OPT_IN` **e** não suprimido **e** sem envio nos últimos 72 h (cooldown).
- Bloqueiam: `OPT_OUT`, `UNKNOWN`, sem registro (`NOT_COLLECTED`), e-mail inválido, suprimido, cooldown, falha de verificação.
- Conflito: snapshots contraditórios (um OPT_IN e um OPT_OUT) → `UNKNOWN/SIGNAL_CONFLICT` (não envia).
  Revogação explícita (descadastro, evento do provedor) vale até um novo opt-in explícito **posterior**.
- Telas: `withValidEmailCount` = base válida bruta; `consentOptInCount` = opt-in no ledger e não suprimido;
  `sendEligibleCount` = `null` (o envio é decidido por destinatário, no gate).

## 4. Quem receberia / quem fica de fora
Receberia: e-mail com OPT_IN confirmado no ledger, revalidado ao vivo na Nuvemshop imediatamente antes do envio,
não suprimido, fora do cooldown, em segmento de um rascunho agendado e aprovado. Fica de fora: todos os demais
casos da seção 3. Opt-out e supressão **prevalecem** sobre qualquer OPT_IN de payload.

## 5. Descadastro
Link assinado (HMAC, chave distinta do pepper) em cada mensagem, cabeçalhos `List-Unsubscribe` e One-Click
(`POST`), página de confirmação em `/unsubscribe/email`. O descadastro grava, na mesma transação, a supressão
definitiva e um evento `OPT_OUT` (`CRM_UNSUBSCRIBE`); é idempotente e sempre atendido (mesmo sob limite de tentativas).
Não existe no código ação para "levantar" supressão. Bounce definitivo suprime o endereço; reclamação de spam
suprime e revoga o consentimento. Rodapé visível com link de descadastro e de privacidade.

## 6. Segurança da campanha
Cap por campanha via reserva atômica (`pg_advisory_xact_lock`, conta e cria na mesma seção crítica); reserva única
por campanha/onda/pessoa; falha do provedor também consome o cap; limites atuais: lote 20, total 20, 1 rascunho
por execução. Gate global fail-closed (7 condições) + gate por destinatário. **Estado atual:** `EMAIL_SEND_ENABLED=false`,
`EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false`, `EMAIL_LEGAL_REVIEW_APPROVED=false`, `EMAIL_TRANSFER_MECHANISM_APPROVED=false`.
**Nenhum envio está autorizado.**

## 7. Retenção e auditoria
Comprovado: ledger append-only, projeção recalculável, supressão definitiva, registros de envio/eventos do provedor
com ids opacos e hash. **Não há política de retenção/expurgo definida no código ou schema** (nenhum job de exclusão
para ledger, supressão, envios ou eventos). → **LEGAL DECISION REQUIRED.**

## 8. Questões para decisão
| QUESTION | CURRENT TECHNICAL FACT | LEGAL DECISION NEEDED |
|---|---|---|
| Base jurídica do marketing por e-mail | O sistema só envia a quem tem OPT_IN no ledger; não registra a base legal | Escolher e documentar a base |
| `accepts_marketing` da Nuvemshop basta como evidência? | É armazenado como evidência observada, com data do payload | Aceitar, ou exigir prova adicional (texto/forma da coleta) |
| Consentimento explícito: necessidade e forma | Não há captura própria de e-mail; vem da loja | Definir se exige captura explícita e como |
| Política de retenção | Nenhuma definida (seção 7) | Prazos e expurgo |
| Conteúdo obrigatório de descadastro | Link + One-Click + rodapé de privacidade | Confirmar texto e canais exigidos |
| Identificação do remetente | `no-reply@mail.drosamoda.com.br`, "D'Rosa Moda" | Confirmar identificação e canal de resposta (`contato@`) |
| Conflitos / UNKNOWN | Tratados como "não enviar" | Confirmar a regra conservadora |
| Dados anteriores a 24/09 | Backfill histórico existe; ingestão contínua desligada | Permitir uso dos consentimentos anteriores? |
| Reengajamento após opt-out | Supressão definitiva, sem reversão em código | Se algum reengajamento é permitido e como |
| Transferência internacional (Resend, EUA) | Página pública declara bloqueio até mecanismo aprovado | Mecanismo (LGPD/ANPD) e aprovação |

## 9. Deliverability (separado do jurídico)
Provedor Resend; remetente `no-reply@mail.drosamoda.com.br`. DNS lido agora: DKIM `resend._domainkey.mail` presente;
SPF `v=spf1 include:amazonses.com ~all` em `send.mail.drosamoda.com.br`; DMARC no domínio raiz
`p=none; pct=100; rua=contato@` (monitoramento, sem política de rejeição); sem registro DMARC próprio em `mail.`
(herda o do domínio raiz). Não verificado aqui: MX de retorno e alinhamento efetivo nas mensagens reais.
Tratamento de bounce/complaint: implementado (supressão). Endurecimento de DMARC é decisão externa (DNS), não feita.

TECHNICALLY READY: **YES** (código e gates; envio permanece fechado por configuração)
LEGAL APPROVAL: **NOT GRANTED**
DELIVERABILITY READY: **UNKNOWN** (autenticação presente; DMARC em `p=none`, alinhamento real não medido)
BLOCKERS: aprovação jurídica (`EMAIL_LEGAL_REVIEW_APPROVED`); mecanismo de transferência internacional
(`EMAIL_TRANSFER_MECHANISM_APPROVED`); política de retenção; decisão sobre `accepts_marketing` como evidência.
DO NOT ENABLE EMAIL SENDING UNTIL: as decisões acima estiverem registradas por quem responde juridicamente, o
backfill incremental em dry-run for revisado, o cap tiver prova em Postgres real e um canário de até 50 for autorizado.
