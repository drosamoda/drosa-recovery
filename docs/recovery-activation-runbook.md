# D'Rosa Recovery — Runbook final de ativação

Este documento é a sequência canônica para levar o `drosa-recovery` de homologação para operação controlada.

## Regra de ouro

Nenhum envio real deve ser feito durante migration, deploy, reconciliação, homologação de consentimento ou validação de templates.

Estado seguro obrigatório até a etapa **Primeiro envio controlado**:

```text
ENABLE_INTERNAL_CRON=false
AUTOMATION_SEND_ENABLED=false
ABANDONED_CART_ENABLED=false
REMARKETING_ENABLED=false
WHATSAPP_DRY_RUN=true
INBOX_SEND_DRY_RUN=true
AUTOMATION_ALLOWED_TEMPLATES=
ABANDONED_CART_MAX_SENDS_PER_RUN=1
REMARKETING_MAX_SENDS_PER_RUN=1
```

Nunca imprimir tokens, Client Secrets, DATABASE_URL ou secrets internos em logs/relatórios.

---

## 1. Pré-deploy

Confirmar:

- `main` é o commit aprovado.
- CI completo está verde.
- CI inclui root + extensão `whatsapp-consent-checkout`.
- Não existem PRs de recovery pendentes que façam parte da ativação.
- Script NubeSDK #10335 permanece no checkout com a versão validada ativa.
- Gates acima permanecem no estado seguro.

### Migrations

Rodar somente via mecanismo oficial do projeto:

```bash
npm run db:migrate:deploy
```

Depois confirmar que não existem migrations pendentes.

A migration de remarketing adiciona `conversation` ao enum `EntityType` para permitir vincular uma retomada de atendimento à conversa original.

Não fazer `prisma migrate dev` contra produção.

---

## 2. Reconciliação da configuração canônica

Primeiro somente auditoria:

```bash
npm run ops:recovery-config:verify
```

Se houver drift, revisar o relatório antes de alterar o banco.

Quando o drift corresponder somente à configuração canônica esperada:

```bash
npm run ops:recovery-config:apply
npm run ops:recovery-config:verify
```

Critério de aceite:

```text
driftCount=0
```

O reconciliador:

- sincroniza templates canônicos;
- sincroniza regras canônicas;
- mantém fases futuras inativas por padrão;
- desativa o template legado `carrinho_abandonado_drosa_01`;
- coloca somente filas pendentes desse template legado em quarentena;
- preserva históricos já enviados/ambíguos para auditoria.

---

## 3. Deploy sem abrir gates

Deployar o `main` com os gates ainda fechados.

Smoke mínimo:

- `GET /health` => 200;
- `GET /crm` => 200;
- endpoint protegido sem secret => 401;
- nenhum 5xx.

Depois consultar:

```text
GET /jobs/automation-health
```

com `JOBS_SECRET`.

Verificar:

- `databaseReachable=true`;
- Meta e Nuvemshop configurados;
- nenhum `expired_processing_claims`;
- nenhum `legacy_pending_messages`;
- nenhuma fila antiga fora de `AUTOMATION_MAX_MESSAGE_AGE_HOURS`;
- contratos locais e templates ativos consistentes.

`preflightReady=false` pode ser esperado enquanto nenhuma allowlist/envio real foi armado. O relatório deve explicar cada bloqueio.

---

## 4. Homologação E2E do consentimento Nuvemshop

A extensão do checkout deve permanecer opcional e desmarcada por padrão.

### Caso A — GRANTED

1. Abrir checkout controlado.
2. Marcar explicitamente:
   "Quero receber novidades, ofertas e lembretes da D'Rosa Moda pelo WhatsApp."
3. Finalizar pedido de teste.
4. Confirmar que `order.extra` preservou metadata de terceiros e contém:
   - `drosa_whatsapp_marketing_version=v1`
   - `drosa_whatsapp_marketing_store_id=<store real>`
   - `drosa_whatsapp_marketing_source=nuvemshop_checkout_whatsapp_optin`
   - `drosa_whatsapp_marketing_scope=marketing`
   - `drosa_whatsapp_marketing_choice=granted`
5. Confirmar webhook processado.
6. Confirmar `whatsapp_consents`:
   - `consented=true`;
   - `consentedAt != null`;
   - `revokedAt=null`;
   - source e scope exatos.

### Caso B — UNKNOWN

1. Novo checkout controlado.
2. Não tocar na checkbox.
3. Finalizar pedido.
4. Confirmar que nenhum consentimento de marketing é criado/inferido.

### Caso C — REVOKED

1. Marcar a checkbox.
2. Desmarcar explicitamente antes de concluir.
3. Confirmar `choice=revoked`.
4. Confirmar `consented=false` e `revokedAt != null`.

### Suppression

Mesmo com consentimento GRANTED, suppression/opt-out deve prevalecer e impedir marketing.

---

## 5. Templates Meta

Um template só está pronto quando todas as condições forem verdadeiras:

1. existe no contrato local;
2. nome, idioma, categoria e body são exatos;
3. existe no banco local;
4. está aprovado na Meta;
5. a validação runtime `verifyMetaTemplateContract` retorna sucesso;
6. para MARKETING há consentimento comprovado;
7. a ativação local foi explícita quando aplicável.

Templates de recovery:

### Núcleo

- `confirmacao_pedido_drosa`
- `carrinho_abandonado_drosa_v2`

### Fase 2

- `pedido_boleto_drosa_01`
- `boleto_vencendo_drosa_v2`
- `_pix_pendente`
- `pagamento_confirmado_drosa_01`
- `pagamento_recusado_drosa_01`
- `pix_cancelado_drosa_01`

### Remarketing

- `cliente_recente_drosa_v1`
- `cliente_vip_drosa_v1`
- `cliente_inativo_drosa_v1`
- `atendimento_retomada_drosa_v1`

Os templates de remarketing permanecem `active=false` por padrão. Aprovação Meta não ativa o CRM automaticamente.

---

## 6. Preview / homologação sem envio

Continuar com:

```text
AUTOMATION_SEND_ENABLED=false
WHATSAPP_DRY_RUN=true
```

Usar endpoints de preview protegidos:

- `POST /jobs/abandoned-checkouts-preview`;
- `POST /jobs/remarketing-preview`.

Nunca usar `segment=all` como caminho de fila real. O sistema bloqueia isso por construção.

Para remarketing:

- telefone válido;
- suppression/opt-out ausentes;
- cooldown respeitado;
- consentimento obrigatório para MARKETING;
- Meta contract validado;
- prioridade entre segmentos;
- histórico suficiente.

`inactive_customer` permanece bloqueado enquanto a cobertura histórica não for comprovada.

---

## 7. DRY RUN do processador

Antes de qualquer envio real, limitar o escopo:

```text
AUTOMATION_ALLOWED_TEMPLATES=<EXATAMENTE_UM_TEMPLATE>
WHATSAPP_DRY_RUN=true
AUTOMATION_SEND_ENABLED=false
```

Executar uma única rodada de `process-messages`.

Critério:

- `sent=0`;
- Meta não é chamada para envio;
- payload renderizado corresponde exatamente ao candidato;
- consentimento é revalidado;
- template Meta é revalidado;
- pedido/carrinho/conversa ainda está elegível;
- nenhuma duplicidade;
- nenhum suppression;
- nenhum status ambíguo.

---

## 8. Seleção do primeiro candidato real

Antes de armar qualquer gate, registrar:

- template;
- segmento/fluxo;
- entidade;
- telefone mascarado;
- texto final renderizado;
- motivo de elegibilidade;
- consentimento;
- suppression;
- cooldown;
- estado da Meta;
- horário dentro da janela de marketing, quando aplicável.

Escolher exatamente **um** candidato.

Parar aqui e solicitar autorização humana explícita para o primeiro envio real.

---

## 9. Primeiro envio controlado

Somente após autorização explícita.

Armar apenas o necessário para o fluxo escolhido.

Exemplo de carrinho abandonado:

```text
AUTOMATION_ALLOWED_TEMPLATES=carrinho_abandonado_drosa_v2
AUTOMATION_SEND_ENABLED=true
ABANDONED_CART_ENABLED=true
REMARKETING_ENABLED=false
WHATSAPP_DRY_RUN=false
ENABLE_INTERNAL_CRON=false
ABANDONED_CART_MAX_SENDS_PER_RUN=1
REMARKETING_MAX_SENDS_PER_RUN=1
INBOX_SEND_DRY_RUN=true
```

Executar manualmente uma única rodada.

Depois fechar imediatamente:

```text
AUTOMATION_SEND_ENABLED=false
ABANDONED_CART_ENABLED=false
REMARKETING_ENABLED=false
WHATSAPP_DRY_RUN=true
AUTOMATION_ALLOWED_TEMPLATES=
```

Confirmar:

- exatamente um aceite da Meta;
- um único `message_log`;
- `metaMessageId` real;
- mirror da Inbox sem reenvio;
- status posterior via webhook;
- nenhum outro destinatário.

Se houver timeout/aceite incerto, **não reenviar automaticamente**.

---

## 10. Ativação gradual

Somente após o envio controlado validado:

1. ativar um fluxo/template por vez;
2. manter allowlist explícita;
3. manter limite por execução baixo;
4. observar delivery/read/fail/unknown;
5. somente depois considerar cron externo/interno;
6. remarketing deve ser ativado por segmento, nunca `all`.

A janela padrão de MARKETING é:

```text
09:00 <= hora < 20:00
MARKETING_TIME_ZONE=America/Sao_Paulo
```

Fora da janela, mensagens são adiadas, não descartadas.

---

## 11. Inbox manual

Enquanto atendimento real manual não estiver autorizado:

```text
INBOX_SEND_DRY_RUN=true
```

Esse gate precisa ser respeitado também em `NODE_ENV=production` e para texto/imagem.

A janela de atendimento de 24h continua obrigatória.

---

## 12. Estado considerado "completamente pronto para autorização"

```text
CI=PASS
MIGRATIONS=APPLIED
RECOVERY_CONFIG_DRIFT=0
DEPLOYED_MAIN_SHA=<sha aprovado>
PROD_GATES_SAFE=YES
NUBESDK_ACTIVE=YES
CONSENT_GRANTED_E2E=PASS
CONSENT_UNKNOWN_E2E=PASS
CONSENT_REVOKED_E2E=PASS
SUPPRESSION_PRECEDENCE=PASS
META_TARGET_TEMPLATE=APPROVED_AND_EXACT
SEND_SCOPE_READY=YES
DRY_RUN_ONE_CANDIDATE=PASS
REAL_SEND_AUTHORIZED=NO
```

Neste estado o CRM está tecnicamente pronto; o único próximo ato é a autorização humana do primeiro envio real.
