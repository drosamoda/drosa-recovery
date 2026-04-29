# D'Rosa Recovery

Sistema de automações WhatsApp para a D'Rosa Moda, integrado à Nuvemshop via **WhatsApp Cloud API oficial da Meta**.

**MVP ativo:**
- Confirmação automática de pedido criado
- Recuperação automática de carrinho abandonado

**Preparado para Fase 2 (inativo):** Pix pendente, boleto, pagamento confirmado/recusado, QR Code cancelado.

---

## Sumário

1. [Instalação](#instalação)
2. [Configuração do .env](#configuração-do-env)
3. [Banco de dados](#banco-de-dados)
4. [Rodando localmente](#rodando-localmente)
5. [Configurar webhook na Nuvemshop](#configurar-webhook-na-nuvemshop)
6. [Configurar webhook da Meta](#configurar-webhook-da-meta)
7. [Configurar templates no WhatsApp Manager](#configurar-templates-no-whatsapp-manager)
8. [Testando os fluxos](#testando-os-fluxos)
9. [Jobs manuais](#jobs-manuais)
10. [Consultar logs e auditoria](#consultar-logs-e-auditoria)
11. [Swagger / OpenAPI](#swagger--openapi)
12. [Testes automatizados](#testes-automatizados)
13. [Sentry (opcional)](#sentry-opcional)
14. [Segredos em produção](#segredos-em-produção)
15. [O que está ativo no MVP](#o-que-está-ativo-no-mvp)
16. [O que está preparado para Fase 2](#o-que-está-preparado-para-fase-2)

---

## Instalação

```bash
git clone <repo>
cd drosa-recovery
npm install
```

---

## Configuração do .env

```bash
cp .env.example .env
```

Preencha as variáveis obrigatórias:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/drosa_recovery` |
| `NUVEMSHOP_STORE_ID` | ID numérico da loja na Nuvemshop |
| `NUVEMSHOP_ACCESS_TOKEN` | Token de acesso da API Nuvemshop |
| `META_ACCESS_TOKEN` | Token permanente da WhatsApp Cloud API |
| `META_PHONE_NUMBER_ID` | ID do número de telefone no Meta Business |
| `META_VERIFY_TOKEN` | Token criado por você para verificação do webhook |
| `META_APP_SECRET` | App Secret do app Meta (para validar assinatura) |
| `ADMIN_SECRET` | Secret para rotas `/admin` (`x-admin-secret`) |
| `JOBS_SECRET` | Secret para rotas `/jobs` (`x-jobs-secret`) |
| `WEBHOOK_SECRET` | Secret HMAC configurado na Nuvemshop |

> **Nunca versione o arquivo `.env`.** Ele já está no `.gitignore`.

---

## Banco de dados

```bash
# 1. Gerar o Prisma Client
npm run db:generate

# 2. Criar tabelas (desenvolvimento)
npm run db:migrate

# 3. Inserir templates, regras e dados de teste
npm run db:seed

# 4. (Produção) rodar migrations sem prompt interativo
npm run db:migrate:deploy
```

---

## Rodando localmente

```bash
npm run dev
```

Servidor sobe em `http://localhost:3000`.

```bash
# Checar se está no ar
curl http://localhost:3000/health

# Health check completo (banco + env)
curl http://localhost:3000/health/deep
```

---

## Configurar webhook na Nuvemshop

1. No painel da Nuvemshop: **Configurações → Apps → Webhooks**
2. Adicionar endpoint:
   ```
   https://SEU_DOMINIO/webhooks/nuvemshop/orders
   ```
3. Evento: **Pedido criado** (`orders/created`)
4. Copie o **Webhook Secret** gerado e cole em `WEBHOOK_SECRET` no `.env`

O sistema valida o header `x-linkedstore-hmac-sha256` com HMAC-SHA256 usando `rawBody`.

---

## Configurar webhook da Meta

### 1. Verificação (GET)

No Meta Business Suite → WhatsApp → Configuração → Webhooks:
- URL: `https://SEU_DOMINIO/webhooks/meta`
- Verify Token: o valor que você colocou em `META_VERIFY_TOKEN`

O sistema responde automaticamente com o `hub.challenge`.

### 2. Assinatura (POST)

Configure `META_APP_SECRET` com o App Secret do seu app Meta.  
O sistema valida `x-hub-signature-256` com HMAC-SHA256.

### 3. Eventos a assinar

- `messages` (status de entrega e mensagens recebidas para opt-out)

---

## Configurar templates no WhatsApp Manager

### Template 1 — Confirmação de pedido

- **Nome:** `confirmacao_pedido_drosa`
- **Categoria:** Utilitária
- **Idioma:** Português (BR)
- **Corpo:**
  ```
  Oi, {{1}}! 😊
  Sou a Dani da D'Rosa Moda.
  
  Recebemos o seu pedido *{{2}}* com sucesso.
  
  Agora estamos aguardando a confirmação do pagamento para separar suas peças com todo carinho.
  ```
- **Variáveis:** `{{1}}` = nome do cliente, `{{2}}` = número do pedido

### Template 2 — Carrinho abandonado

- **Nome:** `carrinho_abandonado_drosa_01`
- **Categoria:** Marketing
- **Idioma:** Português (BR)
- **Corpo:**
  ```
  Oi, {{1}}! 😊
  Sou a Dani da D'Rosa Moda.
  
  Vi que você iniciou um pedido no nosso site, mas não conseguiu finalizar.
  Para facilitar, você pode continuar exatamente de onde parou pelo link abaixo:
  
  Se ficou alguma dúvida ou precisar de ajuda para concluir, estou por aqui 💕
  ```
- **Botão:** URL dinâmica com base `https://www.drosamoda.com.br/checkout/`
- **Variáveis:** `{{1}}` = nome do cliente, botão = sufixo da URL

---

## Testando os fluxos

### Confirmação de pedido

```bash
BODY='{"id":99991,"number":1001,"status":"open","payment_status":"pending","contact_name":"Maria Silva","contact_phone":"31998021418","contact_email":"maria@teste.com","total":"199.90"}'
SECRET="seu_webhook_secret"
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -X POST http://localhost:3000/webhooks/nuvemshop/orders \
  -H "Content-Type: application/json" \
  -H "x-linkedstore-hmac-sha256: $SIG" \
  -H "x-linkedstore-topic: orders/created" \
  -d "$BODY"
# → {"received":true}

# Processar a mensagem agendada
curl -X POST http://localhost:3000/jobs/process-messages \
  -H "x-jobs-secret: SEU_JOBS_SECRET"
```

### Carrinho abandonado

```bash
# Sincronizar carrinhos da Nuvemshop
curl -X POST http://localhost:3000/jobs/sync-abandoned-checkouts \
  -H "x-jobs-secret: SEU_JOBS_SECRET"

# Processar mensagens agendadas (após o delay de 30 min)
curl -X POST http://localhost:3000/jobs/process-messages \
  -H "x-jobs-secret: SEU_JOBS_SECRET"
```

### Opt-out manual

```bash
curl -X POST http://localhost:3000/customers/opt-out \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: SEU_ADMIN_SECRET" \
  -d '{"phone":"31998021418"}'
# → {"success":true,"normalizedPhone":"5531998021418"}
```

---

## Jobs manuais

| Job | Endpoint | Frequência sugerida |
|---|---|---|
| Sync carrinhos | `POST /jobs/sync-abandoned-checkouts` | A cada 15 min |
| Processar mensagens | `POST /jobs/process-messages` | A cada 1 min |

Configure via cron externo (PM2, Railway cron, GitHub Actions scheduled, etc.).

---

## Consultar logs e auditoria

```bash
# Mensagens enviadas
curl "http://localhost:3000/admin/message-logs?status=sent" \
  -H "x-admin-secret: SEU_ADMIN_SECRET"

# Mensagens com falha
curl "http://localhost:3000/admin/message-logs?status=failed" \
  -H "x-admin-secret: SEU_ADMIN_SECRET"

# Webhooks não processados da Nuvemshop
curl "http://localhost:3000/admin/webhook-events?provider=nuvemshop&processed=false" \
  -H "x-admin-secret: SEU_ADMIN_SECRET"

# Filtrar por período
curl "http://localhost:3000/admin/message-logs?date_from=2025-01-01&date_to=2025-12-31" \
  -H "x-admin-secret: SEU_ADMIN_SECRET"
```

---

## Swagger / OpenAPI

```
http://localhost:3000/docs
```

Documentação interativa com todos os endpoints, headers obrigatórios, exemplos de payload e respostas.

---

## Testes automatizados

```bash
# Todos os testes
npm test

# Apenas unitários (sem I/O)
npm run test:unit

# Apenas integração (com mocks)
npm run test:integration

# Typecheck TypeScript
npm run typecheck

# Lint
npm run lint
```

### Cobertura dos testes

**Unitários:**
- `normalizePhoneBrazil` — 8 casos
- `extractUrlSuffix` — 4 casos
- `buildOrderConfirmationVars` / `buildAbandonedCartVars`
- `generateIdempotencyKey`
- Backoff exponencial — 4 casos
- Classificação de erros Meta — 11 casos

**Integração:**
- Webhook Nuvemshop: HMAC válido/inválido, 200 imediato, salvamento de evento
- Webhook Meta: challenge GET, assinatura POST, opt-out por palavra-chave
- Opt-out manual: fluxo completo com validações
- processMessages: 401, campos do resumo, retry temporário, erro permanente

---

## Sentry (opcional)

O Sentry é **totalmente opcional**. Se `SENTRY_DSN` estiver vazio, o sistema roda normalmente.

Para ativar:

```env
SENTRY_DSN=https://sua_chave@sentry.io/projeto
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

**Dados sanitizados automaticamente:** tokens, secrets, headers de autenticação nunca são enviados ao Sentry.

---

## Segredos em produção

> Nunca versione credenciais reais. O arquivo `.env` está no `.gitignore`.

### Opções por plataforma

| Plataforma | Como configurar |
|---|---|
| **VPS / PM2** | `pm2 start ecosystem.config.js` com `env_production` block |
| **Render** | Dashboard → Environment → Environment Variables |
| **Railway** | Dashboard → Variables |
| **Fly.io** | `fly secrets set META_ACCESS_TOKEN=xxx` |
| **Docker** | `docker run --env-file .env.prod` ou Docker Secrets |
| **AWS** | AWS Secrets Manager + `aws secretsmanager get-secret-value` |
| **GCP** | Google Secret Manager |

**Regras absolutas:**
- Nunca printar tokens no console
- Nunca commitar `.env` real
- Usar segredos da plataforma, não variáveis de CI expostas em logs

---

## O que está ativo no MVP

| Automação | Status |
|---|---|
| Confirmação de pedido criado | ✅ Ativo |
| Recuperação de carrinho abandonado (30 min) | ✅ Ativo |

---

## O que está preparado para Fase 2

Todos cadastrados no banco com `active=false`. Para ativar, use:

```bash
# Ativar template
curl -X PATCH http://localhost:3000/admin/whatsapp-templates/ID \
  -H "x-admin-secret: SEU_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"active":true}'

# Ativar regra
curl -X PATCH http://localhost:3000/admin/automation-rules/ID \
  -H "x-admin-secret: SEU_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"active":true}'
```

| Automação | Template | Regra |
|---|---|---|
| Pix pendente | `pix_pendente_drosa_01` | `rule_order_created_pix` |
| Boleto pendente | `pedido_boleto_drosa_01` | `rule_order_created_boleto` |
| Boleto vencendo | `boleto_vencendo_drosa_01` | `rule_boleto_expiring` |
| Pagamento confirmado | `pagamento_confirmado_drosa_01` | `rule_payment_confirmed` |
| Pagamento recusado | `pagamento_recusado_drosa_01` | `rule_payment_rejected` |
| QR Code cancelado | `pix_cancelado_drosa_01` | `rule_pix_cancelled` |

> Mercado Pago e Nuvem Pago **não foram implementados** e não estão planejados para esta versão.
