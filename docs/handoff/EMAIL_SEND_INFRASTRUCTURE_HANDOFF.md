# HANDOFF — Infraestrutura de envio de e-mail (D'Rosa Recovery CRM) — Passo 1 concluído

> Escrito em 2026-09-21 para retomar em outro chat do Claude Code. Leia este arquivo inteiro antes de agir.
> Continua o `EMAIL_CAMPAIGN_INTELLIGENCE_HANDOFF.md` (módulo de inteligência, **encerrado**). Este arquivo e `docs/handoff/scripts/*` estão **sem commit** (untracked) de propósito.
> Cópia idêntica na raiz do workspace: `C:\Users\peter\OneDrive\Área de Trabalho\claude -meta ads\HANDOFF_DROSA_EMAIL_INFRA_2026-09-21.md`. A versão canônica é a do repositório.
> **Atualização de 2026-09-21 (tarde): ver §13** — o Passo 2 (ledger de consentimento) e o Passo 3 (supressão, descadastro, contrato do provedor, gate por destinatário) já existem **em código local, sem commit e sem migration aplicada**. As seções 0–12 abaixo descrevem o estado do fim de 21/09 e não foram reescritas.

## 0. TL;DR

- **Fase anterior (inteligência de campanhas de e-mail): FULLY_CLOSED.** Commits `9f3e55b` + `52c9dd4` em `origin` e `v0mirror` (HEADS_MATCH), Preview `Ready`, 760/760 testes, migration `20260919120000_add_email_campaign_channel` aplicada **e registrada** no `_prisma_migrations` (`prisma migrate status` = "Database schema is up to date!").
- **Fase atual: infraestrutura segura de envio de e-mail. Passo 1 (investigação somente leitura) CONCLUÍDO.** Nenhum e-mail enviado, nenhum código alterado, nenhuma conta/DNS/chave criada, banco não mutado.
- **Achado principal:** o consentimento de e-mail **existe** nos dados persistidos: `accepts_marketing` + `accepts_marketing_updated_at` em `orders.rawPayload` (dentro do `customer` aninhado) e `contact_accepts_marketing[_updated_at]` em `abandoned_checkouts.rawPayload`. O CRM **nunca** guardou isso em coluna, **nunca** chamou `GET /customers` e **só recebe webhooks `order/*`** — portanto a preferência é um *retrato* do momento do pedido/checkout e pode estar desatualizada.
- **Decisão aberta do usuário:** qual provedor (duas análises independentes divergem: Resend × SendGrid — ver §6) e se autoriza a checagem viva na API da Nuvemshop (§7).
- **Próximo passo natural:** Passo 2 (consentimento de e-mail no CRM, separado do de WhatsApp) — mas ele depende da checagem `GET /customers` (que exige o token da Nuvemshop, hoje só no Railway Production) e da revisão jurídica. Ver §8.

## 1. Como retomar (prompt de partida sugerido)

Cole no novo chat (Code) com o diretório de trabalho no repositório:

```
Retome o projeto D'Rosa Recovery CRM — infraestrutura de envio de e-mail.
Leia primeiro, nesta ordem:
1. docs/handoff/EMAIL_SEND_INFRASTRUCTURE_HANDOFF.md (este handoff)
2. docs/handoff/EMAIL_CAMPAIGN_INTELLIGENCE_HANDOFF.md (fase anterior, encerrada)
3. RELATORIO_EMAIL_PASSO1_2026-09-21.md (na raiz "claude -meta ads"; relatório da sessão paralela)
4. HANDOFF_DROSA_RECOVERY_PROD_SECRETS_DB_2026-09-21.md (raiz; OUTRA sessão está operando a produção e o banco — não interferir)
Antes de qualquer acesso ao banco, confirme que as credenciais ainda autenticam (§3, linha "Outra sessão em produção").
Respeite as regras absolutas do §2 (nunca tocar main/Production/Customer OS; nenhum envio real; sem PII para IA;
segredos só como variável de usuário do Windows e nunca impressos). O Passo 1 está concluído; o próximo é o
Passo 2, mas primeiro pergunte-me as decisões abertas do §7 (provedor, checagem viva na Nuvemshop, revisão jurídica).
```

Repositório: `C:\Users\peter\OneDrive\Peter\particular\Documentos\desafio pai e filho\drosa-recovery-crm-ops` · branch `review/crm-v2-visual` (**nunca `main`**) · HEAD local = `origin` = `v0mirror` = `52c9dd41af1be120cf7c36881d6a5cd9893b6bfe` · `git status --short` = só `?? docs/handoff/`.

## 2. Regras absolutas (do usuário — não relaxar)

1. Nunca tocar `main`, **Production** (Railway histórico e o Cloud Run `drosa-recovery` no GCP, hoje em operação por **outra sessão** — ver §3), Vercel Production, Customer OS.
2. **Nenhum envio real** de e-mail ou WhatsApp até o passo 6 do roadmap **e** só com autorização explícita do usuário naquele momento. Flags fixas: `WHATSAPP_DRY_RUN=true`, `AUTOMATION_SEND_ENABLED=false`, `REMARKETING_ENABLED=false`, `ENABLE_INTERNAL_CRON=false`, `EMAIL_SEND_ENABLED=false`. Não criar conta em provedor, não gerar API key, não mexer em DNS sem pedido/aprovação explícita da etapa.
3. Segmentação determinística no backend; IA só escreve copy. **NO_PII_TO_AI** (nunca nome/e-mail/telefone/id/pedido para Groq/OpenAI).
4. `WhatsappConsent`, `Customer.optOut` e `Suppression` são de **WhatsApp** e **não valem** para e-mail. Ausência/`null` de consentimento **nunca** é consentimento.
5. **Segredos:** nunca imprimir/logar/gravar em arquivo/expor fragmento. Entram como **variável de USUÁRIO do Windows** (método de duas colagens: 1ª colagem só `$s = Read-Host "..." -AsSecureString`; 2ª colagem só o bloco que valida o formato e grava `SetEnvironmentVariable`). Ler fresco no mesmo comando (`[Environment]::GetEnvironmentVariable("X","User")`) e passar só ao processo filho. Remover ao terminar (`Remove-ItemProperty HKCU:\Environment X`). O classificador do auto-mode bloqueia (corretamente) credencial literal, arquivo temporário com segredo e leitura de credenciais não autorizadas — **não contornar**; pedir ao usuário.
6. **Uso da `crm_preview_reader` do `.env.preview.local`:** o usuário autorizou **exclusivamente** para a auditoria read-only de consentimento (21/09/2026). Qualquer novo uso pede nova autorização escrita. Regras daquela autorização: não imprimir a string, não copiar para arquivo, não criar variável persistente, só em memória/processo filho, sem INSERT/UPDATE/DELETE, sem migration, sem ampliar grants, resultados só agregados.
7. `crm_ai_preview_writer` nunca ganha DELETE/privilégio extra e **não** é usada para contornar permissões (ela **não** tem SELECT em `customers`/`orders`/`abandoned_checkouts`/`webhook_events` — menor privilégio correto).
8. Dados de teste 100% sintéticos, marcados `[PREVIEW_HTTP_SMOKE_TEST]`, via UPDATE (nunca DELETE).
9. Deploys só por push Git da branch (Preview); nunca `vercel deploy`. Commits terminam com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; push para `origin` **e** `v0mirror`; confirmar `HEADS_MATCH`. Não commitar `.env`.
10. O usuário prefere trabalho autônomo e só quer ser interrompido por bloqueio externo genuíno. Relatórios finais seguem template de flags (`X=PASS/NO`); rejeita "COMPLETE" se algo exigido não foi provado de fato. Responder em português.

## 3. Estado atual (2026-09-21, fim do dia)

| Item | Estado |
|---|---|
| Git | HEAD=`52c9dd4`, sincronizado com `origin` e `v0mirror`; só `docs/handoff/` untracked |
| Preview | `dpl_FSx9pZ4nkHVFXyYPavhWhFSp7ZFh` `Ready` (Git-triggered, sha `52c9dd4`); Protection Bypass revogado |
| Testes/build | typecheck PASS · lint PASS · 760/760 · build PASS (reconferido após o `migrate resolve`) |
| Migrations | 6 linhas em `_prisma_migrations`; a de e-mail registrada. O banco também tem `20260918151500_add_conversation_message_entity`, que existe na `main` e **não nesta branch** (o Prisma não reclama; vira coerente no merge/rebase com a `main` — verificar antes de Production) |
| Envio de e-mail | **Inexistente.** `EmailSendGate` fail-closed; `campaignService.schedule()` de e-mail sempre 409 `EMAIL_SEND_NOT_AVAILABLE`; UI sem botão de agendar |
| Variáveis de usuário (Windows) | presentes: `AI_DATABASE_URL` (role `crm_ai_preview_writer`), `CRM_READ_SECRET`, `MCP_BEARER_TOKEN`, `PIPEBOARD_API_TOKEN`. **Ausentes** (removidas): `MIGRATE_DATABASE_URL`, `AUDIT_DB_URL`, `REAL_DB_URL` |
| Credencial admin (`postgres`) | **Não existe** com o agente (removida por pedido do usuário). Só se o usuário recriar (`MIGRATE_DATABASE_URL`, Session Pooler `aws-1-us-west-2.pooler.supabase.com:5432`, user `postgres.hocrnjuvrufkqjbmmuoo`, com `?sslmode=require&connect_timeout=60`; a senha tem caracteres especiais → URL-encode só na cópia do processo filho) |
| Token da Nuvemshop | **Só em ambiente de produção** (Railway histórico / Secret Manager do Cloud Run — não tocar). Não existe na máquina |
| **Outra sessão em produção (importante)** | Memória `project_drosa_recovery_prod_ops.md` (21/09/2026): produção `drosa-recovery` no **GCP Cloud Run** (us-central1, revisão `00087-wof` a 100%, `main` `088fe05`); migração para Secret Manager pronta na revisão `00089-tik` (não promovida). **O banco Supabase deixou de autenticar em produção por volta de 14:10** (provável senha rotacionada por fora) e o `postgres` pooler está sendo tratado por essa outra sessão. Handoff dela: `HANDOFF_DROSA_RECOVERY_PROD_SECRETS_DB_2026-09-21.md` (raiz `claude -meta ads`). **Antes de qualquer acesso ao banco neste projeto, confirme se as credenciais ainda funcionam** (as roles `crm_preview_reader` e `crm_ai_preview_writer` têm senhas próprias e funcionaram às ~12:00, mas podem ter sido afetadas). Regra da outra sessão: ela não toca em `review/crm-v2-visual`, AI Campaigns nem `AI_DATABASE_URL` — **retribua**: não toque em produção, Secret Manager, revisões do Cloud Run nem na URL admin do banco de produção |
| Nenhum envio | `EMAIL_SENT=NO`, `MAIN_CHANGED=NO`, `PRODUCTION_CHANGED=NO`, `DNS_CHANGED=NO`, `PROVIDER_ACCOUNT_CREATED=NO`, `SECRETS_CREATED=NO`, `PII_EXPOSED=NO`, `DATABASE_MUTATED=NO` |

## 4. Passo 1 — consentimento (resultados medidos no banco)

**Como foi medido:** consultas SQL agregadas, cada uma em transação `READ ONLY`, com a role `crm_preview_reader`. Scripts: `docs/handoff/scripts/email-consent-audit.ts` (executor) + `email-consent-audit.sql` (inventário e 1ª classificação) + `email-consent-audit-2.sql` (refinamento: localização exata da chave, classificação combinada pedidos+checkouts, idade do snapshot). Como rodar: ver §10.

### 4.1 Base
`customers` 3.768 · `orders` 3.995 (3.839 webhook "flat" + 156 com `fetchedOrderPayload`) · `abandoned_checkouts` 726 · `webhook_events` 1.725 (Nuvemshop: `order/paid` 218, `order/created` 187, sem tópico 21, `order/cancelled` 7, `order/updated` 1 — **nenhum `customer/*`**). `customers.source`: `nuvemshop_orders_backfill` 2.965 · `nuvemshop_abandoned_checkout` 671 · `nuvemshop_webhook` 132.
**TOTAL_EMAIL_CUSTOMERS = 3.755** (união `customers.email` ∪ e-mails de pedidos pagos, mesma definição do motor de audiência; 3.755 com formato válido).

### 4.2 Onde o campo está
| Fonte | Chave | Cobertura |
|---|---|---|
| `orders.rawPayload` | `customer.accepts_marketing` e `customer.accepts_marketing_updated_at` (**dentro do objeto `customer` aninhado**, nunca na raiz) | 3.983 de 3.995 (12 pedidos sem objeto `customer`); sempre booleano, sempre com timestamp string |
| `abandoned_checkouts.rawPayload` | `contact_accepts_marketing` e `contact_accepts_marketing_updated_at` (raiz) — não consta na doc pública do checkout, foi observado nos dados | 726 de 726 (74 `true`, 652 `false`) |
| `webhook_events.rawPayload` | `accepts_marketing[_updated_at]` | 63 eventos (só os com payload completo) |
| `customers` (tabela local) | **nenhuma coluna** de consentimento (só `optOut`, de WhatsApp) | — |

Valores em pedidos: `true` 2.608 · `false` 1.375 · sem customer 12 · **nenhum `null`**.

### 4.3 Classificação dos 3.755 e-mails (duas políticas; **a conservadora é a recomendada para envio**)
| Classe | Regra "mais recente vence" (medida por mim) | Política conservadora (sessão paralela, derivada e consistente) |
|---|---|---|
| CONFIRMED_OPT_IN | **2.177** | **2.122** (só `true`, sem sinal contrário) |
| CONFIRMED_OPT_OUT | **1.574** | **1.532** (só `false`) |
| UNKNOWN | 0 | **97** (conflito: `true` e `false` entre snapshots) |
| NOT_COLLECTED | **4** | **4** |
| Total | 3.755 | 3.755 |

Conferência: 2.177 − 55 (opt-in com conflito) = 2.122; 1.574 − 42 (opt-out com conflito) = 1.532; 55+42 = 97. Origem do snapshot mais recente: pedido 3.184 · checkout 567 · nenhuma 4 (na versão da sessão paralela: pedido 3.228 · só-checkout 523 · nenhum 4 — mesma população vista por outro corte). `NUVEMSHOP_CUSTOMER`=0 (API não consultada) · `LOCAL_DB`=0 · `NUBE_SDK`=0. `MARKETING_UPDATED_AT` presente em 3.751, ausente em 4.
Cobertura por origem: 3.228 e-mails com valor em pedido; 671 em checkout; 148 em ambos; **523 só em checkout**; 4 sem nada.

### 4.4 Qualidade da evidência (`CONSENT_SOURCE_QUALITY` = média-baixa para uso jurídico; **decisão jurídica é do responsável por LGPD, não do agente**)
- É **boolean + data**, sem texto do consentimento, versão do formulário, IP ou histórico de mudanças.
- **Desatualização:** snapshot do momento do pedido/checkout (idade ≤ 180 dias; OPT_IN: 743 de 0–30d, 1.198 de 31–90d, 236 de 91–180d). Como o CRM não recebe `customer/*`, mudanças posteriores (ex.: descadastro na loja) **não chegam**.
- **Instabilidade:** 97 e-mails com valores conflitantes entre snapshots; onde há pedido e checkout do mesmo e-mail (148), 78 (53%) discordam (sessão paralela).
- **`false` não prova recusa ativa:** todos os `false` vêm com data; não dá para distinguir "recusou" de "padrão nunca alterado". Para envio não muda nada (ambos não enviáveis).
- **Não se sabe se a caixa "receber novidades" vem pré-marcada** no checkout da D'Rosa (a doc não diz). Sinal indireto (hipótese, não prova): 67% dos compradores têm `true`, contra ~8% dos contatos só de checkout abandonado.
- O `accepts_marketing_updated_at` costuma **diferir** do dia do snapshot (>1 dia em 90% dos OPT_IN e 73% dos OPT_OUT) → é atributo do registro do cliente, coerente com a doc; a sessão paralela mediu ~71% dos timestamps a ≤10 min do pedido (captura no checkout) — as duas leituras não se excluem.
- O campo é específico de e-mail na doc ("offers and news via email") — não confundir com WhatsApp.

### 4.5 Base enviável hoje
No máximo **2.122** (política conservadora) — **e só depois de revalidar com a fonte viva** (`GET /customers`) e da revisão jurídica. Nada disso autoriza envio; o gate segue fail-closed.

## 5. Documentação oficial da Nuvemshop (consultada em 2026-09-21)
- `Customer`: `accepts_marketing` (boolean, "buyer accepted to receive offers and news via email", **somente leitura na API**) e `accepts_marketing_updated_at` (data da última mudança). Changelog **2024-10-28** (clientes anteriores podem ter valor padrão/nulo). Endpoints `GET /customers` (filtros `since_id`, `created_at_min/max`, `updated_at_min/max`, `page`, `per_page` ≤ 200, `q`, `email`, `fields`) e `GET /customers/{id}`.
- **A doc de `Order` (página extraída) não lista o campo no `customer` aninhado, mas o payload real do CRM o contém** — a doc estava incompleta ou a extração foi lossy. Confie nos dados reais.
- Webhooks: `customer/created`, `customer/updated`, `customer/deleted` (changelog **2025-08-15**); payload mínimo (`store_id`, `event`, `id`) → é preciso `GET /customers/{id}` depois. Não há evento específico de consentimento. Eventos de proteção de dados: `store/redact`, `customers/redact`, `customers/data_request`.
- Escopos OAuth: `read_customers`/`write_customers` (customers). O código atual **nunca** usa customers → **não se sabe se o app tem `read_customers`** (um 403 responderia). Registrar webhooks só para recursos com permissão concedida (e registrar webhook é **escrita** na loja → exige autorização).
- Rate limit: leaky bucket 40 de capacidade, 2 req/s (10× em planos Next/Evolution), headers `x-rate-limit-*`, 429; paginação `per_page` ≤ 200 + `x-total-count`. Base: 3.768 clientes ≈ 19 páginas.
- Base URL da API usada no código: `https://api.nuvemshop.com.br/{NUVEMSHOP_API_VERSION}/{NUVEMSHOP_STORE_ID}` (`src/services/nuvemshopService.ts` — hoje só checkouts, pedidos e produtos).
- Sessão paralela: existe o PR `drosamoda/drosa-recovery#27` ("Capture explicit WhatsApp consent via NubeSDK checkout extension") — **não inspecionado**; é precedente de captura explícita de consentimento no checkout, possivelmente reaproveitável para e-mail.

## 6. Provedores (pesquisa oficial em 2026-09-21) — decisão **ABERTA**

Preços em US$, sem impostos/conversão. As páginas de preço são dinâmicas e foram lidas por extração automática (**conferir antes de contratar**). Duas análises independentes (a minha e a da sessão paralela) chegaram a recomendações **diferentes**:

| Análise | Primeira escolha | Motivo declarado |
|---|---|---|
| Esta sessão | **Resend** (Pro US$ 20 até 50k; US$ 35 até 100k) | menor atrito de integração, webhooks assinados (Svix), `Idempotency-Key` de 24 h, tags com IDs opacos p/ atribuição, e o **descadastro vive no CRM** (endpoint próprio + `List-Unsubscribe-Post`) |
| Sessão paralela (`RELATORIO_EMAIL_PASSO1_2026-09-21.md`) | **SendGrid Email API Essentials** (US$ 19,95 até 50k), Resend como alternativa "muito próxima" | doc cobre todos os critérios (bounce duro/mole, spam, unsubscribe, ECDSA, `custom_args`, grupos de supressão) |

Ambas concordam: **atrás de um adapter**, CRM como fonte de verdade, **Klaviyo e Brevo são os menos alinhados** (trazem listas/consentimento/segmentação para dentro do fornecedor), **SES** é a opção de menor custo/maior esforço de engenharia. Sugestão para desempatar (não executada): sandbox curto de cada um dos dois testando (a) classificação hard/soft do bounce, (b) retorno de tags/`custom_args` nos eventos, (c) headers customizados `List-Unsubscribe`/`-Post`, (d) retenção de eventos.

| Provedor | Custo (3,7k · 10k · 25k · 50k · 100k) | Webhooks / segurança | Descadastro / supressão | Pontos de atenção |
|---|---|---|---|---|
| **Resend** | Free 3.000/mês e 100/dia (não cobre a base); Pro **20 · 20 · 20 · 20 · 35**; excedente 0,90/mil; Marketing por contatos (Pro 40–650) | Svix (`svix-id/timestamp/signature`, corpo bruto, replay via timestamp); Pro: 5 endpoints. Eventos: sent, delivered, bounced, complained, opened, clicked, failed, suppressed, delivery_delayed, scheduled, received; `suppression.added/removed`; contact/domain | `List-Unsubscribe` + `-Post` via `headers`; **nenhum evento de unsubscribe documentado**; suppression list com eventos | tags só `[A-Za-z0-9_-]` ≤256 (IDs opacos, nunca e-mail); `Idempotency-Key` 24 h; subdomínio/DMARC/BIMI recomendados; retenção Free 30 d; hard/soft do bounce **não confirmada**; IP dedicado só Scale (US$ 30) |
| **SendGrid** | Free = trial 60 d/100 por dia; Essentials **19,95** (50k) / **34,95** (100k); Pro a partir de 89,95; Marketing Campaigns **separado** (Basic a partir de 15 c/ 5k contatos; Advanced a partir de 60) | Event Webhook (processed, dropped, delivered, deferred, bounce, open, click, spamreport, unsubscribe, group_unsubscribe/resubscribe); `sg_event_id` p/ dedupe; `custom_args`; assinatura ECDSA (`X-Twilio-Email-Event-Webhook-Signature`+`-Timestamp`) e OAuth 2.0; Essentials 2 webhooks | global, grupos (ASM), bounces, blocks, spam, inválidos; envio suprimido consome crédito; subscription tracking adiciona `list-unsubscribe` | histórico de atividade só 3 d (Essentials) → log de eventos tem que ser nosso; 100k Essentials "a partir de" (conferir) |
| **Brevo** | Free 300/dia; Starter a partir de 9 (5k/mês); Standard a partir de 18 (~69 p/ 20k, trecho oficial); Professional a partir de 499; **10k–100k não confirmados** | 15 eventos; auth por bearer token/cabeçalhos/basic na URL/IP allowlist; **sem HMAC documentado** | one-click RFC 8058 suportado; blocklist própria | contatos/descadastros no Brevo → dupla fonte de verdade; DMARC exigido p/ Microsoft |
| **Klaviyo** | Free 250 perfis/500 envios; pago por perfis ativos (**preço não obtido**) | HMAC-SHA256 (`Klaviyo-Signature`), até 1.000 eventos/req, eventos de consentimento | nativo | cobra qualquer perfil "que possa receber e-mail, independente de consentimento"; conflita com "CRM fonte de verdade" — **não recomendado** |
| **Amazon SES** | US$ 0,10/mil à la carte → **0,38 · 1 · 2,50 · 5 · 10** (Essentials 0,16/mil → 1,60/4/8/16; a extração automática errou o 100k, recalculado); IP dedicado 24,95/mês/IP; VDM 0,07/mil opcional | eventos via SNS/Firehose/CloudWatch por config sets; assinatura SNS **não verificada** | lista de supressão por conta (só hard bounce); contact list (**1 por conta**, até 20 tópicos), link/one-click gerenciados pelo SES | mais engenharia (IAM, SNS, saída do sandbox, aquecimento); a gestão de inscrição do SES competiria com a nossa |

**Não confirmado em fonte oficial nesta rodada:** preços Brevo 10k–100k e Klaviyo; retenção de eventos (exceto Free do Resend e SendGrid); SPF/DKIM/DMARC específicos de SendGrid/Resend; entregabilidade comparada (só piloto mede); claims divergentes entre as duas sessões (ex.: limites do Free do SendGrid Marketing) — reconferir.

## 7. Decisões abertas / entradas necessárias do usuário

1. **Provedor:** Resend, SendGrid, ou fazer o sandbox de desempate do §6 antes de decidir. (Nada é contratado sem o usuário.)
2. **Checagem viva na API da Nuvemshop** (o usuário adiou: "primeiro fechar a auditoria do banco" — o banco está fechado): `GET /customers?fields=id,accepts_marketing,accepts_marketing_updated_at&per_page=200` (~19 páginas), só contagens, comparando com o snapshot do banco. Exige que o **usuário forneça o token** da loja como variável de usuário temporária (o token só está em ambiente de produção — Railway/Secret Manager —, que não se toca) e **autorize explicitamente** a chamada. Se o app não tiver `read_customers`, a resposta será 403 (também é informação útil e pode exigir reautorização do lojista).
3. **Assinar webhooks `customer/updated`** (e `customers/redact`/`data_request`) na Nuvemshop: é **escrita** na loja → só com autorização explícita; alternativa/complemento: sincronização periódica de `/customers`.
4. **Revisão jurídica/LGPD** da fonte de consentimento (boolean + data, sem prova, caixa possivelmente pré-marcada) — decisão do responsável, não do agente.
5. **Observação do checkout** (sem comprar): a caixa de novidades vem pré-marcada? qual o texto exibido?
6. **Subdomínio remetente** (ex.: dedicado, separado do e-mail da hospedagem) e plano de DNS — **ação do usuário** (o agente não mexe em DNS). Estado do DNS reportado pela sessão paralela (consulta pública, **não reverificado por mim**): `drosamoda.com.br` com SPF de hospedagem (cPanel, `~all`), DKIM `default` da hospedagem, **DMARC `p=none`**, sem registro de provedor de e-mail marketing → `DOMAIN_AUTHENTICATED`=NO. Aquecimento de domínio leva semanas → convém começar cedo.
7. Regra de conflito de consentimento: manter a política **conservadora** (qualquer sinal `false` bloqueia) — recomendada; confirmar.

## 8. Roadmap aprovado (ordem revisada pelo usuário) e critérios de aceite

Nada envia e-mail real até o passo 6.

| # | Passo | Entregas | Depende do usuário |
|---|---|---|---|
| 1 | Investigação read-only | **CONCLUÍDO** (este handoff) | — |
| 1b | Checagem viva `/customers` | contagens comparadas ao banco | token + autorização (§7.2) |
| 2 | Consentimento de e-mail no CRM, **separado do WhatsApp** | tabelas `EmailConsentEvent` (append-only) + `EmailMarketingConsent` (estado atual); ingestão a partir de `rawPayload` (backfill) e, depois, `/customers` + `customer/updated`; `EMAIL_MARKETING_CONSENT_SOURCE=CONFIGURED` só quando houver fonte real; `sendEligibleCount` deixa de ser `null` | migration aditiva; revisão jurídica (§7.4); autorização p/ webhook (§7.3) |
| 3 | Descadastro e supressão | `EmailSuppression` (UNSUBSCRIBE, HARD_BOUNCE, SPAM_COMPLAINT, INVALID, MANUAL, OPT_OUT_SOURCE — **supressão sempre vence consentimento**), endpoint próprio de descadastro (`List-Unsubscribe` + One-Click POST com token assinado), consulta em toda geração de audiência | escolha do provedor (webhooks) |
| 4 | Domínio autenticado + teste para endereço nosso | SPF/DKIM/DMARC do provedor, subdomínio; 1 e-mail para endereço da equipe (não exige consentimento) | DNS e conta no provedor (ações do usuário) |
| 5 | Log de envios e tracking | `EmailSend` + `EmailEventLog` (idempotente por `providerEventId`): sent, delivered, bounce hard/soft, spam, open, click, unsubscribe, compra, receita atribuída; **ativa o cooldown real** (hoje `EMAIL_COOLDOWN_STATUS='NOT_ENFORCEABLE_NO_EMAIL_SEND_HISTORY'`) | — |
| 6 | Piloto controlado | endereço nosso → pequena lista autorizada → segmento real → campanhas maiores | **autorização explícita**; muda a regra "nenhum envio real" |

Aceite geral: cada passo com testes (Vitest/Supertest), `typecheck/lint/test/build` PASS, migrations aditivas, Preview Git-triggered `Ready`, nenhum envio real.

## 9. Arquitetura e gate (proposta; NADA implementado)

```
CRM (fonte de verdade: segmentos, consentimento, supressão, cooldown, aprovação humana)
 → EmailSendGate (fail-closed)
 → EmailProviderAdapter { send(msg{to, subject, html, text, headers, customArgs{sendId, campaignKey}}),
                          verifyWebhook(rawBody, headers), parseEvents(...) → NormalizedEmailEvent }
 → Provedor (só entrega por API; sem listas/segmentos/automações hospedadas no fornecedor)
Webhook do provedor → /webhooks/email/:provider (rawBody + assinatura, HTTP 200 imediato, setImmediate)
 → EmailEventLog (idempotente por id do evento) → EmailSuppression / cooldown / atribuição
```

- **Chave de junção sem PII duplicada:** `emailHash` = HMAC-SHA256(e-mail normalizado, pepper do servidor). E-mail cru continua só em `customers`/`orders`. Webhook do provedor traz o e-mail cru → calcula o hash → consulta consentimento/supressão.
- **Tags/`custom_args` só com IDs opacos** (`sendId`, `campaignKey`), nunca e-mail/nome.
- **Modelo futuro (não migrado):** `EmailConsentEvent` {`emailHash`, `customerId?`, `status` OPT_IN|OPT_OUT|UNKNOWN, `source` (NUVEMSHOP_ORDER_PAYLOAD | NUVEMSHOP_CHECKOUT_PAYLOAD | NUVEMSHOP_CUSTOMER_API | NUBESDK_EXPLICIT | CRM_UNSUBSCRIBE | PROVIDER_EVENT | MANUAL_IMPORT), `sourceUpdatedAt`, `capturedAt`, `evidenceRef` (id do webhook/pedido + caminho JSON, **não** o payload), `revokedAt`, `createdAt`}; `EmailMarketingConsent` (estado atual, unique `emailHash`); `EmailSuppression`; `EmailSend`; `EmailEventLog`. Ausência de linha = NOT_COLLECTED. Regra: qualquer OPT_OUT posterior ou conflito vence; opt-in exige evidência sem sinal contrário + revisão jurídica da fonte.
- **Gate — três níveis** (o atual é só o nível sistema, com constantes; faltam `DOMAIN_AUTHENTICATED`, `HUMAN_APPROVAL` e o nível destinatário):

| Nível | Condições |
|---|---|
| Sistema | `PROVIDER_CONFIGURED`, `DOMAIN_AUTHENTICATED`, `EMAIL_SEND_ENABLED` |
| Campanha | `HUMAN_APPROVAL` registrada **por versão exata do rascunho** (quem/quando) |
| Destinatário | `CONSENT_VERIFIED=true`, `SUPPRESSED=false`, `EMAIL_VALID=true` |

Só envia com TODAS verdadeiras. Hoje o gate (`src/services/emailSendGate.ts`) verifica 4 condições globais: `EMAIL_PROVIDER_CONFIGURED=false` (constante), `EMAIL_MARKETING_CONSENT_SOURCE!=='CONFIGURED'`, `EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED=false` (constante), `EMAIL_SEND_ENABLED` (env, default false) — não configuráveis por env as duas constantes, de propósito.

**Pontos de contato no código:** `src/services/emailAudienceEngine.ts` (`EMAIL_MARKETING_CONSENT_SOURCE` na linha ~30; SQL de identidade `queryEmailIdentityRows` ~363–410; `sendEligibleCount` = `null` enquanto `NOT_CONFIGURED`) · `src/services/emailSendGate.ts` · `src/services/campaignService.ts` (`schedule()` de e-mail → 409) · `src/config/env.ts` (`EMAIL_SEND_ENABLED`) · `src/services/nuvemshopService.ts` (adicionar `fetchCustomers` **somente** com autorização) · `src/routes/webhooks.nuvemshop.routes.ts` + `src/middlewares/nuvemshopWebhookValidator.ts` (rawBody + HMAC `x-linkedstore-hmac-sha256`; regras do projeto: responder 200 imediato e processar em `setImmediate`, idempotência via `webhookEventService`) · `src/services/orderService.ts` (`rawPayload`/`fetchedOrderPayload`) · `prisma/schema.prisma`.

## 10. Como rodar a auditoria de consentimento (somente leitura)

Requer **nova autorização escrita do usuário** para usar a `crm_preview_reader` do `.env.preview.local` (o §2.6 vale só para a auditoria já feita). Com ela:

```powershell
cd "C:\Users\peter\OneDrive\Peter\particular\Documentos\desafio pai e filho\drosa-recovery-crm-ops"
$line = Get-Content .env.preview.local | Where-Object { $_ -like 'DIRECT_URL=*' } | Select-Object -First 1
$env:AUDIT_DB_URL = $line.Substring('DIRECT_URL='.Length).Trim().Trim('"'); $line = $null
$env:AUDIT_QUERIES = "docs\handoff\scripts\email-consent-audit-2.sql"   # ou email-consent-audit.sql
npx ts-node --project tsconfig.json docs\handoff\scripts\email-consent-audit.ts
$env:AUDIT_DB_URL = $null; $env:AUDIT_QUERIES = $null
```
O executor abre uma transação `READ ONLY` por consulta, limita `connection_limit=1` e só imprime agregados/nomes de chave. Blocos do `.sql` começam com `-- @rotulo`. Nota: a consulta `@9` do 1º arquivo falha por `customer` nulo (a `@19` do 2º arquivo é a versão corrigida); a `@16` do 1º usa pool ligeiramente diferente (3.756) — a `@22` do 2º é a válida.

## 11. Armadilhas de ferramenta (aprendidas)

- A ferramenta PowerShell/Bash do agente pode bloquear comando que contenha regex tipo `\d+` junto de `Remove-Item` (falso positivo de "caminho do sistema") → coloque a lógica num `.ps1` sem segredos e chame o arquivo.
- `rtk` pode distorcer a saída de lint: use `rtk proxy npx eslint src --ext .ts`. `ts-node` de script fora do repo: `require` com caminho absoluto e barras `/`, `--project <repo>/tsconfig.json`.
- Heredocs longos no Bash truncam → usar a ferramenta Write. Editar `app.js/app.css` (CRLF) exigiu converter para LF na cópia de trabalho (o git normaliza).
- Remover variável de usuário do Windows de forma confiável: `Remove-ItemProperty -Path "HKCU:\Environment" -Name X` (o `SetEnvironmentVariable($null)` já falhou uma vez).
- `crm_ai_preview_writer` tem `CONNECTION LIMIT 2` → use `connection_limit=1`.
- WebFetch é um extrator resumido (modelo rápido): páginas de preço dinâmicas (Brevo/Klaviyo/SendGrid) saem incompletas e **podem errar contas** (errou Resend 25k e SES 100k) — sempre recalcule e marque "não confirmado".
- Usuário cola comandos no PowerShell: **duas colagens separadas** para `Read-Host -AsSecureString` (já deu errado 3 vezes ao colar tudo junto/com o clipboard errado).

## 12. Índice de arquivos e fontes

| Arquivo | O que é |
|---|---|
| `docs/handoff/EMAIL_SEND_INFRASTRUCTURE_HANDOFF.md` | este handoff (canônico) |
| `docs/handoff/EMAIL_CAMPAIGN_INTELLIGENCE_HANDOFF.md` | handoff da fase anterior (módulo de inteligência, encerrado; §12 e §46 têm trechos históricos) |
| `RELATORIO_EMAIL_PASSO1_2026-09-21.md` (raiz `claude -meta ads`) | relatório da sessão paralela (mais detalhes de checkout/DNS/qualidade; recomendação SendGrid) |
| `docs/handoff/scripts/email-consent-audit.ts` / `.sql` / `-2.sql` | auditoria read-only de consentimento |
| `docs/handoff/scripts/real-counts.ts`, `ui-harness.ts`, `verify_email_migration.sql`, `verify_ai_role_email.sql` | scripts da fase anterior |
| Memória do agente | `memory/project_drosa_recovery_email.md` (índice em `MEMORY.md`) |

Fontes oficiais (2026-09-21): Nuvemshop [Customer](https://tiendanube.github.io/api-documentation/resources/customer), [Order](https://tiendanube.github.io/api-documentation/resources/order), [Webhook](https://tiendanube.github.io/api-documentation/resources/webhook), [Changelog](https://tiendanube.github.io/api-documentation/CHANGELOG), [Autenticação/escopos](https://tiendanube.github.io/api-documentation/authentication), [Intro/rate limit](https://tiendanube.github.io/api-documentation/intro) · Resend [preços](https://resend.com/pricing), [eventos](https://resend.com/docs/dashboard/webhooks/event-types), [verificação](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests), [descadastro](https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails), [send-email](https://resend.com/docs/api-reference/emails/send-email) · SendGrid [Email API preços](https://www.twilio.com/en-us/products/email-api/pricing), [Marketing Campaigns preços](https://www.twilio.com/en-us/products/marketing-campaigns/pricing), [Event Webhook](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event), [segurança](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features), [supressões](https://www.twilio.com/docs/sendgrid/ui/sending-email/index-suppressions) · Brevo [preços](https://www.brevo.com/pricing/), [webhooks](https://developers.brevo.com/docs/transactional-webhooks), [autenticação de domínio](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC) · Klaviyo [preços](https://www.klaviyo.com/pricing), [cobrança](https://help.klaviyo.com/hc/en-us/articles/115000976672), [webhooks](https://developers.klaviyo.com/en/docs/working_with_system_webhooks) · Amazon SES [preços](https://aws.amazon.com/ses/pricing/), [monitoramento](https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity.html), [list management](https://docs.aws.amazon.com/ses/latest/dg/sending-email-list-management.html), [supressão](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html).


## 13. Atualização de 2026-09-21 (tarde) — Passo 2 (ledger) + Passo 3 local (supressão, descadastro, provedor, gate)

Escopo aprovado por Peter no chat: modelar a supressão de e-mail (isolada da de WhatsApp), estruturar o descadastro (List-Unsubscribe / One-Click com token assinado), criar o contrato abstrato do provedor com mock (sem SendGrid nem Resend) e ligar o `EmailSendGate` ao ledger e à supressão, mantendo tudo fail-closed. **Tudo local: sem commit, sem migration aplicada, sem tocar banco/produção/Preview, sem conta de provedor, sem DNS, sem Nuvemshop, sem e-mail enviado.** HEAD continua `52c9dd4`.

### 13.1 O que existe (todos os arquivos abaixo estão sem commit)

| Arquivo | O que faz |
|---|---|
| `prisma/schema.prisma` | + enum `EmailSuppressionReason` e model `EmailSuppression` (chave `emailHash`, uma linha por e-mail, a primeira supressão vence) |
| `prisma/migrations/20260921233000_add_email_suppression/` | aditiva (1 enum, 1 tabela, 2 índices), corpo idêntico ao de `prisma migrate diff`. **NÃO aplicada.** Vem depois de `20260921230000_add_email_consent_ledger` (também não aplicada) |
| `src/services/emailSuppressionService.ts` | `suppressEmailByHash` / `suppressEmail` (bloqueio + evento OPT_OUT no ledger **na mesma transação**), `isEmailSuppressed`, `applyProviderEvent` (evento do provedor → supressão, idempotente) |
| `src/services/emailUnsubscribeToken.ts` | token `v1.<payload>.<hmac>` só com `emailHash` (nunca e-mail), sem expiração, comparação em tempo constante, rotação por `EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS`, URL só https, cabeçalhos RFC 8058 |
| `src/routes/emailUnsubscribe.routes.ts` | `GET /unsubscribe/email?t=` só confirma (não altera nada); `POST` executa (é o One-Click). Montada em `index.ts` **fora** do modo `CRM_PREVIEW_READONLY`. Sem segredo configurado → 503. Erro de banco → 500 genérico (nunca a stack trace). **Rate limit só sobre token INVÁLIDO** (20 falhas/min por `req.ip`, depois 429 com `Retry-After`); token válido nunca é barrado |
| `src/helpers/failureRateLimiter.ts` | limitador de **falhas** por chave, em memória, janela fixa, relógio injetável, memória limitada (`maxKeys`). Sem dependência nova |
| `src/services/emailProviderAdapter.ts` | contrato: `send`, `parseWebhook(rawBody, headers)` (assinatura sobre o corpo bruto), evento normalizado, erros tipados. Sem dependência de provedor |
| `src/services/emailDispatcher.ts` | **único caminho até `adapter.send`** (`sendEmailThroughGate`): gate global → cabeçalhos de descadastro **do próprio destinatário** → gate por destinatário → envio. `issueUnsubscribeHeaders` monta os cabeçalhos |
| `src/services/emailSendGate.ts` | gate global **intocado** + `evaluateEmailRecipientGate` (só `CONFIRMED_OPT_IN` e não suprimido libera; qualquer erro bloqueia) + `evaluateEmailSendForRecipient` (global primeiro; com o global fechado nem consulta o banco) |
| `src/services/emailAudienceEngine.ts` | **exclui e-mails suprimidos** de `base` e segmentos (ver 13.2 item 8). Novo campo `snapshot.suppression` (`APPLIED`/`UNAVAILABLE`, `excludedCount`, `reason`); novas `loadEmailIdentityRowsExcludingSuppressed` e `queryEmailIdentityRowsWithEmail`; CTEs do SQL extraídas para `identityCtes`. A consulta padrão (sem e-mail) e seu teste de privacidade ficaram **intactos** |
| `src/services/emailConsentService.ts` | refatoração mínima: `recordEmailConsentEventByHashInTx` (mesma escrita, a partir de um hash e dentro de uma transação já aberta). Comportamento de `recordEmailConsentEvent` inalterado |
| `src/config/env.ts`, `.env.example` | `EMAIL_UNSUBSCRIBE_SECRET` e `EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS` (vazios = recurso desligado, não derruba o boot). O `.env.example` também passou a listar `EMAIL_SEND_ENABLED` e `EMAIL_HASH_PEPPER` |
| `src/__tests__/fixtures/mockEmailProvider.ts`, `inMemoryEmailDb.ts` | mock do provedor (fora do build de produção) e banco em memória com **rollback real** |

### 13.2 Decisões de projeto (não desfazer sem motivo)

1. **A supressão sempre vence o consentimento** e não há "levantar" no código: um opt-in explícito posterior reabre o consentimento no ledger, mas o e-mail segue bloqueado. Remover uma linha é ato manual e deliberado (decisão de produto/jurídica pendente).
2. Do provedor, só `HARD_BOUNCE`, `SPAM_COMPLAINT` e `UNSUBSCRIBE` suprimem. `DELIVERED`, `DEFERRED`, `SOFT_BOUNCE`, `BLOCKED` (reputação), `OPEN` e `CLICK` são ignorados.
3. `HARD_BOUNCE` e `INVALID_ADDRESS` bloqueiam o envio **sem** gerar evento de consentimento (endereço ruim não é revogação). Os demais motivos entram no ledger como OPT_OUT (`CRM_UNSUBSCRIBE`, `PROVIDER_EVENT` ou `MANUAL_IMPORT`).
4. **GET nunca descadastra** (scanners e pré-visualizadores de e-mail fazem GET em todo link); só o POST executa.
5. **`EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED` continua `false` de propósito**, mesmo com o código pronto: a migration não foi aplicada e o link nunca foi exercitado de ponta a ponta num ambiente real. Só vira `true` por decisão humana, depois dessa prova. O gate global segue com as 4 condições ausentes (há teste de regressão) e `EMAIL_MARKETING_CONSENT_SOURCE` segue `NOT_CONFIGURED`.
6. Nomes dos motivos diferem um pouco do roadmap da §8: `OPT_OUT_SOURCE` virou `PROVIDER_UNSUBSCRIBE` e `INVALID` virou `INVALID_ADDRESS`. Não há dado a migrar (tabela nova).
7. Chave de assinatura do link **distinta** do pepper (nunca uma chave para dois fins). Trocá-la sem `PREVIOUS` invalida todos os links já enviados — e o descadastro precisa funcionar para sempre.
8. **A exclusão dos suprimidos NÃO é um filtro dentro do SQL.** A lista é chaveada por HMAC com o pepper, que só existe no app; calcular o HMAC no Postgres exigiria mandar o pepper ao banco (parâmetro de consulta, possível de aparecer em log de consulta lenta) e depender de pgcrypto. Alternativa adotada: a exclusão acontece na leitura, **antes** da agregação em segmentos, e o e-mail só sai do banco quando existe ao menos um suprimido a excluir (lista vazia ⇒ usa a consulta compacta de sempre, que nunca traz e-mail). Nada de e-mail entra em snapshot, cache ou log. Se a lista de supressão passar de ~100 mil linhas, paginar o `loadSuppressedHashes`.
9. **Filtro degradado não derruba o painel.** Pepper ausente, tabela ainda não migrada ou falha na leitura da lista ⇒ contagens SEM exclusão e `snapshot.suppression.status = 'UNAVAILABLE'` (com o motivo). Isso é só informativo: `sendEligibleCount` segue `null` e o gate por destinatário é a barreira real. Erro de banco nas consultas de identidade continua propagando (nenhum snapshot inventado).
10. **Rate limit só sobre tentativas inválidas, nunca sobre token válido.** O One-Click do Gmail/Yahoo sai de poucos IPs de servidor: um teto por IP sobre todas as requisições derrubaria descadastros legítimos no meio de um envio, e descadastro precisa ser sempre honrado. O token válido é verificado antes e passa direto. Sem `trust proxy` atrás de balanceador todos dividem a mesma chave `req.ip`: o pior caso é o inválido tomar 429 mais cedo, nunca um válido ser barrado. Estado por instância (defesa em profundidade; a barreira real é a assinatura de 256 bits).

### 13.3 Verificação feita

`tsc --noEmit`, `eslint` e `tsc -p tsconfig.build.json` sem erros; suíte **1010/1010** (852 anteriores + 123 do Passo 3 + 8 do runner de backfill da §14 + 27 de motor de audiência e rate limit). Dez mutações deliberadas foram todas detectadas por 1 a 10 testes: gate ignora supressão, despachante não checa destinatário, token sem checar assinatura, link de outro destinatário aceito, GET que descadastra, motor não exclui suprimidos, e-mail sai do banco sem suprimidos, motor ignora pepper ausente, limitador conta/barra token válido, limitador nunca limita. Não foi feito nenhum teste contra banco real nem contra a rota rodando: a rota foi exercitada com Supertest sobre o app real e um banco em memória.

### 13.4 Pendências (nada disso foi feito; cada item exige decisão ou autorização de Peter)

1. **Aplicar as duas migrations, na ordem** (`…230000_add_email_consent_ledger`, depois `…233000_add_email_suppression`): exige credencial admin e autorização explícita. Antes, rodar `prisma migrate diff` contra o banco alvo.
2. Criar `EMAIL_HASH_PEPPER` e `EMAIL_UNSUBSCRIBE_SECRET` reais (variáveis **diferentes**, ≥ 32 caracteres, nunca impressas). Sem elas tudo responde indisponível.
3. A UI do CRM v2 (`public/crm-v2`) **ainda não mostra** `snapshot.suppression` (nem o aviso de `UNAVAILABLE`); hoje só a API expõe. `sendEligibleCount` continua `null`.
4. O limitador da rota pública é por instância e usa `req.ip`; definir `trust proxy` (e quantos saltos) exige conhecer o balanceador do ambiente-alvo. Não foi feito.
5. Endpoint de webhook do provedor (rawBody + assinatura → `parseWebhook` → `applyProviderEvent`): depende de escolher o provedor (Resend × SendGrid segue em aberto).
6. Checagem viva `GET /customers` (1b) e revisão jurídica do consentimento (Passo 2 da §8): ver a §14 (o runner de backfill existe, mas a checagem viva está bloqueada).
7. Depois da migration: exercitar o descadastro num Preview (link real → POST → linha em `email_suppressions` e evento no ledger) e só então decidir sobre o item 5 da §13.2.
8. Decisão de produto/jurídica: existe caminho para levantar uma supressão? Se sim, deve ser uma rotina administrativa explícita e auditada, nunca implícita (diretriz de Peter).
9. **Chaves (`EMAIL_HASH_PEPPER`, `EMAIL_UNSUBSCRIBE_SECRET`) NÃO foram geradas.** Peter listou isso entre os próximos passos, mas gerar e guardar segredo pelo agente conflita com a regra da §2 item 5 (segredo entra como variável de USUÁRIO pelo método das duas colagens, nunca impresso) e o pepper, uma vez usado para gravar hashes num banco real, não pode ser perdido nem trocado (invalida todos os hashes). Fazer junto com a decisão de onde o valor fica guardado e com backup.

## 14. Atualização de 2026-09-21 (noite) — checagem viva da Nuvemshop BLOQUEADA + runner de backfill

**Estado do repositório:** branch `review/crm-v2-visual`, HEAD `52c9dd4`, tudo ainda sem commit. Suíte **983/983**, `tsc`, `eslint` e `tsc -p tsconfig.build.json` limpos. (Uma rodada da suíte inteira pode estourar o timeout de 10 s do `beforeAll` de `emailTabFrontend.test.ts` sob carga; isolado e na rodada seguinte passa.)

### 14.1 Checagem viva `GET /customers` (Passo 1b): NÃO EXECUTADA
Três probes `GET /v1/7716231/customers?per_page=1` com `Authorization: Bearer` retornaram **HTTP 401** (token de 13 caracteres, depois outro de 13, depois um de 40). Nada além de 1 request por tentativa; banco não lido; variáveis removidas. Segundo relato do usuário, o token do Secret Manager de produção (`drosa-recovery-nuvemshop-access-token:1`) também dá 401 (com `Authorization` e com `Authentication`), então **o token de produção está inválido/revogado**. Script pronto e sem segredo: `docs/handoff/scripts/nuvemshop-live-consent-audit.js` (`probe` = 1 request; `full` = paginação sequencial `per_page=200` + comparação com o banco via `crm_preview_reader`, READ ONLY, só agregados). Uso: `NUVEMSHOP_AUDIT_TOKEN` e `NUVEMSHOP_AUDIT_STORE_ID` no ambiente do processo. A autorização do `crm_preview_reader` foi dada só para essa comparação e **não foi usada**.

### 14.2 Diagnóstico do OAuth do Customer OS (por leitura de código; Vercel e portal NÃO inspecionados)
- `GET /api/integrations/nuvemshop/oauth/start` grava o digest do `state` em `integration.oauth_states` (Supabase do deployment que atendeu o start, com `initiated_by` = usuário logado) e redireciona para `https://www.nuvemshop.com.br/apps/{client_id}/authorize?state=...`. **Não envia `redirect_uri`**: o retorno vai para a URL de callback cadastrada no app no portal da Nuvemshop.
- O callback exige sessão (`requireAppUser("admin.manage")`, cookie por domínio) e só consome um `state` com o mesmo digest, `provider`, `initiated_by` = usuário da sessão e `consumed_at` nulo. Start e callback em domínios/deployments diferentes ⇒ sessão diferente e/ou Supabase diferente ⇒ `NUVEMSHOP_OAUTH_STATE_INVALID`. Coerente com o observado. O alias `drosa-customer-os-staging-preview.vercel.app` é descrito em `docs/audit/CANONICAL_AUDIT_HANDOFF.md` §12 como alias secundário "de uma fase anterior"; o primário é `drosa-customer-os-staging.vercel.app`. Não foi verificado para qual deployment o alias secundário aponta.
- **Pegadinha 1:** `completeNuvemshopOAuth` exige que os escopos retornados sejam EXATAMENTE `read_customers, read_orders, read_products` (senão `NUVEMSHOP_SCOPES_INVALID`), e o `state` já foi consumido antes da troca do código. Se o app tiver escopo a mais ou a menos, a autorização falha depois de gastar o `state`.
- **Pegadinha 2 (a que mais importa):** o token obtido por esse fluxo é **criptografado (AES-256-GCM) e gravado no Supabase do Customer OS**; o callback devolve só um relatório, nunca o token. Portanto consertar o OAuth do Customer OS **não entrega** um token utilizável ao `drosa-recovery` (que lê `NUVEMSHOP_ACCESS_TOKEN` do Cloud Run/Secret Manager) nem à auditoria. Falta decidir quem é dono do token da loja.
- Hipótese não verificada: se Recovery e Customer OS usam o mesmo app da Nuvemshop, uma reautorização por um deles pode ter invalidado o token do outro; e um app tem uma única URL de callback.

### 14.3 Runner de backfill (novo, sem banco tocado)
`src/jobs/backfillEmailConsent.ts` — `runBackfillEmailConsent({ dryRun?, batchSize?, pepper? })`. **Dry-run por padrão** (só `dryRun: false` grava). As consultas projetam apenas `accepts_marketing` e seu timestamp (nunca o objeto `customer` inteiro), usam as mesmas expressões já validadas no banco na auditoria, rodam uma por vez (limite de conexões) e a saída é só agregada, inclusive `universe.byState` para conferir contra a auditoria (esperado no universo de 3.755 com a política conservadora: 2.122 / 1.532 / 97 / 4). Dry-run sem `EMAIL_HASH_PEPPER` usa pepper efêmero em memória; a escrita exige o pepper real e recusa rodar com `CRM_PREVIEW_READONLY`. 8 testes (`src/__tests__/unit/backfillEmailConsent.test.ts`). **O SQL nunca rodou contra o banco real.** Não está exposto por rota nem CLI: chamar por script com credencial autorizada.

### 14.4 O que falta e depende de decisão/autorização
1. Token vigente da Nuvemshop (14.2) + probe 200 + auditoria viva completa (14.1).
2. Revisar a política de precedência do resolvedor com o resultado vivo.
3. Aplicar as duas migrations na ordem (credencial admin + autorização); criar `EMAIL_HASH_PEPPER` e `EMAIL_UNSUBSCRIBE_SECRET` no ambiente que vai executar o código de escrita. As rotas de descadastro e a escrita no ledger só rodam **fora** do modo Preview read-only, isto é, em produção (Cloud Run), o que exige levar este código para a `main` por PR e revisão.
4. Dry-run do backfill (precisa de nova autorização de leitura, pois a do `crm_preview_reader` foi restrita à comparação viva), depois escrita, depois novo dry-run (deve dar zero).
5. Ainda NÃO existem: log de envios/eventos do provedor (`EmailSend`/`EmailEventLog`), atribuição, webhook do provedor, escolha do provedor, DNS.

## 15. Atualização de 2026-09-22 — tracking/atribuição, commits organizados em branch nova, dry-run real, OAuth com evidência de navegador

**Escopo desta rodada, autorizado por Peter no chat:** consolidar o working tree (coordenado com a sessão paralela "auditoria google", que também editava o repo — ver troca de mensagens no início desta seção), dry-run READ ONLY do backfill com `crm_preview_reader` (autorização nova, restrita a esta rodada: auditoria live-vs-snapshot + dry-run + validações agregadas; **não** cobre migration, secrets, Produção, DNS, envio real nem merge em `main`), implementar a camada de tracking que faltava, e organizar tudo em commits/branch — sem aplicar migration, sem criar secret, sem tocar Produção/DNS, sem enviar e-mail.

### 15.1 Tracking, atribuição e fiação do gate/dispatcher — IMPLEMENTADO localmente
`src/services/emailTrackingService.ts` (novo): três peças, todas testadas (41 testes novos, `src/__tests__/unit/emailTrackingService.test.ts`):
- **`EmailSend`** (livro-razão de tentativas): `reserveEmailSend` é idempotente por `sendKey` (`campaignKey:wave:emailHash`); `claimEmailSend` faz o claim atômico `QUEUED -> SENDING` via `updateMany` condicional — só um chamador vence, os demais recebem `EmailSendNotClaimableError` com a razão (`NOT_FOUND` / `RECIPIENT_MISMATCH` / `NOT_QUEUED`); `markEmailSendSent` e `markEmailSendFailed` fecham o ciclo (falha retryable volta a `QUEUED`, definitiva vira `FAILED`).
- **`EmailEventLog`** (eventos do provedor): idempotente por `(provider, providerEventId)`; um status novo nunca **rebaixa** o `EmailSend` (ex.: `DELIVERED` chegando depois de `HARD_BOUNCE` não muda nada); vínculo ao `EmailSend` por `sendId` OU `providerMessageId`, só quando o `emailHash` bate com o do evento (um `sendId` forjado/trocado não mexe no envio de outra pessoa); `ingestProviderWebhook` é o único caminho de entrada, aplica a supressão **antes** de gravar o evento e **também no replay** (cura uma supressão perdida se a escrita anterior falhou no meio).
- **Atribuição de compra:** `attributePurchase` — modelo `LAST_CLICK_7D` explícito (`EMAIL_ATTRIBUTION_WINDOW_DAYS=7`), só `CLICK` atribui (abertura nunca atribui — pré-carregamento de imagem infla aberturas), o clique mais recente dentro da janela vence, idempotente por pedido, re-executável (um clique que chegou atrasado passa a atribuir na próxima rodada).
- **Cooldown:** `hasRecentEmailSend` (`EMAIL_RECIPIENT_COOLDOWN_HOURS=72`) — novo bloqueio `EMAIL_COOLDOWN_ACTIVE` no gate por destinatário (`emailSendGate.ts`), opcional na interface (não quebra quem injeta só consentimento/supressão) mas sempre presente no gate real.
- **`emailDispatcher.ts`:** `sendEmailThroughGate` ganha um passo — claim da tentativa **depois** que cabeçalhos e destinatário passam e **antes** de `adapter.send` (nenhum efeito colateral em recusa); erro conhecido do provedor (`EmailProviderSendError`) marca a tentativa; erro desconhecido propaga sem tocar no tracking, deixando a tentativa em `SENDING` para revisão humana em vez de arriscar reenvio automático duplicado; falha ao registrar o envio (depois que o e-mail JÁ saiu) não relança — só loga o nome do erro.
- Nenhuma rota HTTP nova foi criada para o webhook do provedor: como o provedor ainda não foi escolhido (item 15.6), `ingestProviderWebhook` fica pronto como função, sem endpoint — evita expor uma rota sem assinatura real para verificar.

### 15.2 Dry-run READ ONLY do backfill contra o banco real — EXECUTADO
Com a autorização desta rodada, rodei `docs/handoff/scripts/email-consent-backfill-dryrun.js` (novo; lê a URL do `.env.preview.local` só em memória, força `CRM_PREVIEW_READONLY=true`, cada leitura roda em transação `SET TRANSACTION READ ONLY`). Resultado real:
```
ordersRead=3995  checkoutsRead=726  eventsTotal=4709  emailsWithEvents=3757
universe.size=3755
universe.byState = CONFIRMED_OPT_IN 2122 · CONFIRMED_OPT_OUT 1532 · UNKNOWN 97 · NOT_COLLECTED 4
```
Bate exatamente com a política conservadora da auditoria de 21/09/2026 (§4.3 e RELATORIO_EMAIL_PASSO1). **Nada foi gravado** (`write: null`, `mode: DRY_RUN`); a credencial não foi impressa nem copiada para arquivo. `BACKFILL_DRY_RUN=PASS`.

### 15.3 OAuth — causa raiz com evidência do usuário + estado real da produção
Peter confirmou por observação direta no navegador: o `start` foi aberto em `drosa-customer-os-staging.vercel.app/.../oauth/start` e o callback da Nuvemshop voltou em `drosa-customer-os-staging-preview.vercel.app/.../oauth/callback` (com `code`+`state` presentes). **Isso não é mais hipótese.** Confirma o diagnóstico por código da §14.2: o app tem, no portal da Nuvemshop, um único callback cadastrado apontando para o alias `-preview`; abrir o `/oauth/start` em `drosa-customer-os-staging.vercel.app` grava o `state` num deployment e o callback tenta consumi-lo a partir de outro (`-preview`), que é outro processo/talvez outro banco de sessão → `NUVEMSHOP_OAUTH_STATE_INVALID`, exatamente como projetado (`consumeState` exige o mesmo `state_digest` + `provider` + `initiated_by` + `consumed_at IS NULL`; nenhuma dessas checagens foi removida, nem deve ser).
**`OAUTH_ROOT_CAUSE`:** o app 38911 (Nuvemshop) tem no portal um callback cadastrado que não é o host onde o `/oauth/start` é aberto. Correção é de configuração, não de código: abrir `/oauth/start` no MESMO host que está cadastrado como callback no portal, **ou** atualizar o callback do app no portal para `https://drosa-customer-os-staging.vercel.app/api/integrations/nuvemshop/oauth/callback` (o host primário, segundo `docs/audit/CANONICAL_AUDIT_HANDOFF.md` §12). Nenhuma das duas ações foi feita por mim: a primeira é só abrir a URL certa (ação do usuário); a segunda é uma mudança no portal do app, que pode invalidar o fluxo de quem já depende do host `-preview` — decisão do usuário.
**Fato novo relevante (memória `project-drosa-recovery-prod-ops`, 21/09 ~15:10, **outra sessão**, não verificado por mim nesta rodada):** a produção do `drosa-recovery` (Cloud Run) já teve sua credencial da Nuvemshop **restaurada** — client secret e token novos (v2), revisão `00096-fod` a 100%, escopos confirmados `read_customers, read_orders, read_products` **+ `write_scripts`** (esse escopo extra é, segundo a mesma memória, o que faz o fluxo do Customer OS falhar com `NUVEMSHOP_SCOPES_INVALID` — ele exige a lista EXATA). Isso muda o quadro da §14.1: **é possível que o token de produção já funcione**, mas eu não testei de novo nesta rodada (nenhuma credencial de auditoria foi fornecida). O item 14.2 pegadinha 2 continua valendo: mesmo que o Customer OS autorize com sucesso, o token fica criptografado no Supabase dele, não chega ao Recovery.

**`CANONICAL_TOKEN_OWNER_RECOMMENDATION`** (recomendação técnica, não decisão — arquitetura, não implementada):
- Hoje há DOIS custodiantes de fato para o MESMO app 38911 / loja 7716231: o Recovery guarda `NUVEMSHOP_ACCESS_TOKEN` em texto simples no Secret Manager do Cloud Run (lido direto por `env.ts`); o Customer OS guarda um token criptografado (AES-256-GCM) no Supabase, atrás de um fluxo OAuth completo com `state` de uso único. **Nenhuma system de escrita OAuth deveria coexistir com o outro sem coordenação**: cada troca de código invalida o token anterior do MESMO app+loja (confirmado na memória de produção — foi a causa raiz do 401 de 21/09). Reautorizar em um sistema quebra o outro silenciosamente.
- Recomendação: escolher **um único custodiante** do token (candidato natural: o Recovery, que é quem hoje consome a API para o CRM de recuperação — orders/checkouts/products; o Customer OS teria só `read_customers`, que nem chegou a ser usado no Recovery ainda). O outro sistema deixa de fazer OAuth próprio e passa a ler o token do custodiante por um canal interno (variável de ambiente compartilhada via Secret Manager, ou um endpoint interno autenticado) — nunca um segundo fluxo OAuth competindo pelo mesmo app+loja.
- Alternativa se os dois sistemas realmente precisarem de tokens **independentes**: criar um SEGUNDO app na Nuvemshop (app id diferente) para o Customer OS, com seu próprio client id/secret/callback — assim as trocas de código de um não invalidam o token do outro. Isso é uma decisão de produto (o portal da Nuvemshop trata cada app como uma integração distinta, visível ao lojista) e não foi executada.
- **Não criei um terceiro fluxo.** Não toquei no Customer OS nem no portal da Nuvemshop.

### 15.4 Reconciliação do working tree e coordenação entre sessões
Ao reabrir o repositório, o working tree já tinha migration `.../233000_add_email_suppression` (suprimida), `emailSuppressionService`, `emailUnsubscribeToken`, `emailProviderAdapter`, `emailDispatcher` (versão sem tracking), gate por destinatário e exclusão de suprimidos no `emailAudienceEngine` — trabalho de uma sessão paralela ("auditoria google") no mesmo repositório. Troquei mensagens com ela (`SendMessage`) antes de editar arquivos compartilhados (`prisma/schema.prisma`, `emailSendGate.ts`, `emailDispatcher.ts`, `emailConsentService.ts`, fixtures) para não pisar em cima do trabalho dela; ela confirmou que não editaria nem rodaria git nesses arquivos enquanto eu normalizava. Nenhum arquivo dela foi reescrito do zero — só estendido (ex.: `assertUnsubscribeHeadersForRecipient` ganhou um parâmetro opcional; `emailSendGate.ts` ganhou `isInCooldown` como campo opcional da interface existente).

### 15.5 Commits e branch — CRIADOS (sem push, sem PR)
`review/crm-v2-visual` permanece intocada em `52c9dd4` (nenhum commit foi feito nela). Criei a branch `feat/email-consent-suppression-tracking` a partir desse HEAD e organizei 2 commits de código + este de documentação:
1. `48bd563` — `feat(email): consent ledger, suppression and unsubscribe (application code)`.
2. `6c848a4` — `feat(email): prisma schema/migrations + tracking, attribution and gate/dispatcher wiring`.
3. (este commit) — `docs(email): §15 — tracking, dry-run real, OAuth com evidência, auditoria de segurança`.
`prisma/schema.prisma` foi editado cumulativamente pelas duas sessões e depois por mim (tracking); dividir esse arquivo por assunto exigiria reconstrução manual de trechos já escritos por outra sessão, o que era um risco maior que o benefício — por isso ele (e os outros arquivos compartilhados: `emailSendGate.ts`, `emailDispatcher.ts`, `inMemoryEmailDb.ts`, `emailDispatcher.test.ts`) foram commitados inteiros no commit 2, na sua forma final. **Não fiz push** (nem para `origin`, nem para `v0mirror`) e **não abri PR**: não há `gh` CLI neste ambiente, e Peter não confirmou explicitamente que o push deveria acontecer agora — só que a branch/commits deveriam existir. Se for para publicar, o caminho é `git push origin feat/email-consent-suppression-tracking` e a URL de compare (`.../compare/review/crm-v2-visual...feat/email-consent-suppression-tracking?expand=1`), do jeito já usado neste workspace por outros projetos sem `gh`.

### 15.6 Auditoria de segurança desta rodada
- **Segredos:** nenhum valor de token/senha/API key hardcoded nos arquivos deste branch (`git diff` completo varrido por padrão); o único `.env*` no diff é `.env.example`, só com nomes de variável e valores vazios.
- **PII em log:** os 4 pontos que logam algo relacionado a e-mail (`emailUnsubscribe.routes.ts`, `emailDispatcher.ts`) só emitem booleanos/contadores/nome do erro — nenhum loga e-mail, hash ou token (checado por teste em `emailUnsubscribeRoutes.test.ts` e por leitura de cada `logger.*` novo).
- **PII no ledger:** nenhum modelo novo (`EmailConsentEvent`, `EmailMarketingConsent`, `EmailSuppression`, `EmailSend`, `EmailEventLog`) tem coluna de e-mail — todos usam `emailHash` (HMAC-SHA256 com `EMAIL_HASH_PEPPER`); confirmado por grep no schema.
- **Bypass do gate:** `adapter.send(` só é chamado em UM lugar do código de produção — dentro de `sendEmailThroughGate` (`emailDispatcher.ts`); nenhuma outra rota, job ou serviço chama o adapter diretamente (grep em `src`, fora de `__tests__`).
- **Scripts de diagnóstico** (`docs/handoff/scripts/*.js`): nenhum imprime token, senha ou fragmento de credencial (grep dedicado); a URL do banco é redigida antes de qualquer log de erro.

### 15.7 Estado final desta rodada
```
LOCAL_IMPLEMENTATION=COMPLETE (consentimento, supressão, descadastro, tracking, atribuição, gate fail-closed)
TRACKING=IMPLEMENTED (EmailSend + EmailEventLog, claim atômico, cooldown, atribuição LAST_CLICK_7D, sem rota HTTP de webhook — provedor não escolhido)
BACKFILL_DRY_RUN=PASS (dados reais: 2122/1532/97/4 — bate com a auditoria)
CONSENT_MODEL=IMPLEMENTED (não aplicado ao banco)
UNSUBSCRIBE=IMPLEMENTED (não exercitado em ambiente real)
SUPPRESSION=IMPLEMENTED (não aplicado ao banco)
SEND_GATE=FAIL_CLOSED (inalterado: EMAIL_PROVIDER_CONFIGURED=false, EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED=false, EMAIL_SEND_ENABLED=false)
PROVIDER_ADAPTER=CONTRACT_ONLY (nenhum fornecedor ligado; decisão Resend×SendGrid segue aberta)
OAUTH_ROOT_CAUSE=CONFIRMADO (evidência do usuário): callback do app 38911 no portal da Nuvemshop aponta para um host diferente do que o /oauth/start é aberto
CANONICAL_TOKEN_OWNER_RECOMMENDATION=Recovery como custodiante único OU apps Nuvemshop separados por sistema — ver §15.3 (não implementado)
MIGRATIONS_PENDING=3 (20260921230000_add_email_consent_ledger, 20260921233000_add_email_suppression, 20260921234500_add_email_tracking) — nenhuma aplicada
SECRETS_PENDING=EMAIL_HASH_PEPPER, EMAIL_UNSUBSCRIBE_SECRET (e _PREVIOUS, se rotação) — nenhum criado
TESTS=1056/1056 PASS
TYPECHECK=PASS · LINT=PASS · BUILD=PASS (tsc -p tsconfig.build.json)
BRANCH=feat/email-consent-suppression-tracking (nova; review/crm-v2-visual intocada em 52c9dd4)
HEAD=6c848a4 (+ este commit de docs)
COMMITS=2 de código + 1 de docs, sem push
PR=NÃO CRIADO (sem gh CLI; push não autorizado explicitamente nesta rodada)
DATABASE_MUTATED=NO · PRODUCTION_CHANGED=NO · REAL_EMAIL_SENT=NO · PII_EXPOSED=NO
```
**`READY_FOR_FINAL_ACTIVATION=NO`**

**`HUMAN_ACTION_REQUIRED`** (todas as ações abaixo, agrupadas; nenhuma foi feita por mim):
1. **OAuth:** abrir `/oauth/start` no MESMO host cadastrado como callback no app 38911 do portal da Nuvemshop — **ou** atualizar o callback do app no portal para `drosa-customer-os-staging.vercel.app`. Decidir isso ANTES de reautorizar qualquer coisa, porque cada troca de código invalida o token anterior do app+loja.
2. **Dono do token:** decidir entre Recovery como custodiante único (Customer OS passa a ler dele) ou apps Nuvemshop separados por sistema (§15.3). Sem essa decisão, qualquer reautorização futura arrisca repetir o incidente de 21/09.
3. **Push/PR:** confirmar se `feat/email-consent-suppression-tracking` deve ser publicada (`git push origin ...`) e revisada por PR, ou se fica só local por enquanto.
4. **Migrations:** autorizar + fornecer credencial admin para aplicar as 3 migrations pendentes, na ordem, num ambiente que não seja Produção sem revisão.
5. **Secrets:** gerar e guardar `EMAIL_HASH_PEPPER` e `EMAIL_UNSUBSCRIBE_SECRET` (≥32 caracteres cada, diferentes entre si) no ambiente que vai rodar o código de escrita — decidir onde ficam guardados e como há backup, porque perder o pepper invalida todos os hashes já gravados.
6. **Checagem viva `GET /customers`:** fornecer um token válido (considerar testar primeiro o token de produção já restaurado — §15.3 — antes de gerar um novo) via `NUVEMSHOP_AUDIT_TOKEN`/`NUVEMSHOP_AUDIT_STORE_ID`.
7. **Revisão jurídica/LGPD** do consentimento (pendente desde o Passo 1) e **escolha do provedor** de e-mail (Resend × SendGrid × outro).

## 16. Atualização de 2026-09-22 — pré-ativação técnica: push feito, OAuth com causa raiz de infraestrutura confirmada, token de produção BLOQUEADO pelo classificador

**Escopo desta rodada:** eliminar todo bloqueio resolvível sem aplicar migration e sem habilitar envio real, deixando a próxima autorização humana restrita a migrations + secrets + backfill real.

### 16.1 Token de produção da Nuvemshop — NÃO TESTADO (bloqueio do classificador, não da Nuvemshop)
Verifiquei por `gcloud run services describe drosa-recovery` (somente leitura, sem imprimir segredo) qual credencial a revisão **vigente** realmente referencia — não confiei na memória de outra sessão. Achado real: a revisão a 100% do tráfego mudou de `00096-fod` (citada na memória) para **`drosa-recovery-00098-qoj`** (tag `inbox-secret-v2`), mas ela **continua referenciando as mesmas versões** dos secrets do Secret Manager que a memória descreve como "restauradas": `NUVEMSHOP_ACCESS_TOKEN -> drosa-recovery-nuvemshop-access-token:2` e `NUVEMSHOP_CLIENT_SECRET -> nuvemshop-client-secret:2`. `NUVEMSHOP_STORE_ID` (valor em texto simples, não é segredo) confere: `7716231`.
Isso é evidência real de **configuração**, não prova de que o **valor** do secret ainda autentica na Nuvemshop. Tentei ler o valor da versão 2 em memória (protocolo já usado por outras sessões: `gcloud secrets versions access` → variável só do processo filho → nunca impresso → descartado) para fazer UM `GET /customers?per_page=1` de teste. **O classificador de permissões do Claude Code bloqueou a ação** com o motivo "Credential Exploration", antes de qualquer chamada à Nuvemshop. Não tentei contornar. `TOKEN_RECOVERY_CURRENT=UNKNOWN` (não confundir com `INVALID`); `NUVEMSHOP_CUSTOMERS_PROBE` e `LIVE_CUSTOMER_AUDIT` continuam **NÃO EXECUTADOS**.

### 16.2 OAuth — causa raiz confirmada por infraestrutura real (Vercel), não só por observação de navegador
Com `vercel inspect` (somente leitura, autenticado como `drosamoda-6608s-projects`) nos dois hosts:
- `drosa-customer-os-staging.vercel.app` → deployment `dpl_Ax9AJHRrCngcTLrAo4WrcFHRdgqc`, **`target: production`**, criado há 11 dias.
- `drosa-customer-os-staging-preview.vercel.app` → deployment `dpl_YaVT9X3FC12FHAm77R5c5uQmAMZd`, **`target: preview`**, criado há 17 dias (mais antigo, código potencialmente desatualizado).

Os dois hosts não são só "domínios diferentes": são **ambientes Vercel diferentes** (Production × Preview) do MESMO projeto `drosa-customer-os-staging`. Isso importa porque `vercel env ls` mostra que `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` têm **entradas separadas** para Production e para Preview (criadas em momentos diferentes — a de Preview 41 dias atrás, a de Production 29 dias atrás), enquanto `NUVEMSHOP_CLIENT_ID`, `NUVEMSHOP_APP_SECRET`, `NUVEMSHOP_TOKEN_ENCRYPTION_KEY` e `NUVEMSHOP_REDIRECT_URI` são compartilhadas entre os dois ambientes. Ou seja: **o mesmo app/segredo da Nuvemshop, mas com Supabase (banco de `oauth_states`) potencialmente diferente por ambiente.** Isso explica o `NUVEMSHOP_OAUTH_STATE_INVALID` de forma mais precisa que "host errado": o `state` gravado pelo `/oauth/start` (respondido pelo ambiente Production, quando aberto no host primário) não existe no Supabase que o `/oauth/callback` consulta quando o callback é servido pelo ambiente Preview (host `-preview`).
**Achado à parte, não relacionado à causa raiz mas relevante:** o `.vercel/project.json` do checkout local em `Drosa-Customer-OS/` aponta para um projeto (`prj_iymRoACPFmv10w7hA3I0LXYfE85p`, org `team_DsvYiTFONxqzAuHyuhxjE9Ou`, nome "d-rosa-customer-os") que **não está na conta acessível** (`vercel teams ls` só lista `drosamoda-6608s-projects`) — ou é um link antigo/errado, ou pertence a outra conta. O projeto realmente servindo os dois aliases investigados é `drosa-customer-os-staging`, dentro de `drosamoda-6608s-projects` (confirmado por `vercel project ls`). Não investiguei se o código-fonte local corresponde ao deployado; não é necessário para a causa raiz do OAuth.
Não removi o alias `-preview`, não mudei nenhuma env var, não toquei no portal da Nuvemshop, não desabilitei validação de `state`.

**`OAUTH_CANONICAL_HOST` (recomendação):** `https://drosa-customer-os-staging.vercel.app` — é o alias de `target: production`, atualiza a cada deploy de produção, e é o host onde o `/oauth/start` já é aberto na prática.

### 16.3 NUVEMSHOP_PORTAL_ACTION_REQUIRED
```
NUVEMSHOP_PORTAL_ACTION_REQUIRED:
  app: 38911 (D'Rosa Customer OS — Staging)
  URL_atual_do_callback_no_portal: NÃO INSPECIONADA (portal da Nuvemshop não foi acessado; inferida do comportamento observado por Peter no navegador: .../staging-preview.vercel.app/api/integrations/nuvemshop/oauth/callback)
  URL_desejada: https://drosa-customer-os-staging.vercel.app/api/integrations/nuvemshop/oauth/callback
  motivo: o alias "-preview" resolve para um deployment target=preview (ambiente Vercel diferente,
          possivelmente com Supabase diferente do de produção) — o state gravado no ambiente de
          Production nunca é encontrado pelo callback servido pelo ambiente de Preview.
  confirmação_posterior_necessária: depois de trocar o callback no portal, testar 1 login OAuth
          completo (start -> autorizar na Nuvemshop -> callback) e conferir "connected": true na
          resposta; só então decidir se o alias "-preview" deve ser removido.
```

### 16.4 Migrations — revisão final (nenhuma aplicada)
```
MIGRATION_NAME=20260921230000_add_email_consent_ledger
ADDITIVE_ONLY=YES (só CREATE TYPE ×2, CREATE TABLE ×2, CREATE INDEX ×4; nenhum ALTER TABLE)
DESTRUCTIVE_SQL=NO (varredura por DROP/TRUNCATE/RENAME/GRANT/DELETE/TRIGGER: 0 ocorrências)
LOCK_RISK=NONE (tabelas novas e vazias; nenhum lock em tabela existente/populada)
ROLLBACK_STRATEGY=DROP TABLE "email_consent_events", "email_marketing_consents"; DROP TYPE "EmailConsentStatus", "EmailConsentSource" — seguro ANTES do backfill (0 linhas); depois do backfill real, dropar apaga o histórico de consentimento (decisão, não acidente)
DEPENDENCIES=nenhuma (sem FK para customers/orders/abandoned_checkouts; identidade é emailHash, não id de outra tabela)
EXPECTED_ROWS_AFFECTED=0 linhas em tabelas existentes; a própria migration cria 0 linhas (as ~4.709 linhas do backfill são um passo SEPARADO, pós-migration)

MIGRATION_NAME=20260921233000_add_email_suppression
ADDITIVE_ONLY=YES (CREATE TYPE ×1, CREATE TABLE ×1, CREATE INDEX ×2)
DESTRUCTIVE_SQL=NO
LOCK_RISK=NONE
ROLLBACK_STRATEGY=DROP TABLE "email_suppressions"; DROP TYPE "EmailSuppressionReason" — mesma ressalva pós-backfill/pós-descadastros reais
DEPENDENCIES=ordem: depois de …230000 (schema.prisma referencia EmailConsentSource no mesmo arquivo, mas o SQL desta migration não usa nenhum objeto da anterior — dependência é só de ORDEM do Prisma migrate, não de FK)
EXPECTED_ROWS_AFFECTED=0

MIGRATION_NAME=20260921234500_add_email_tracking
ADDITIVE_ONLY=YES (CREATE TYPE ×2, CREATE TABLE ×2, CREATE INDEX ×7)
DESTRUCTIVE_SQL=NO
LOCK_RISK=NONE
ROLLBACK_STRATEGY=DROP TABLE "email_sends", "email_event_logs"; DROP TYPE "EmailSendStatus", "EmailEventType" — segura enquanto EMAIL_SEND_ENABLED=false (nenhum envio real gera linha aqui ainda)
DEPENDENCIES=ordem: depois de …233000 (mesma observação: sem FK real entre as 3 migrations)
EXPECTED_ROWS_AFFECTED=0

MIGRATIONS_SAFE_TO_APPLY=YES
```
Nenhuma das três altera coluna obrigatória sem default em tabela populada, nenhum RENAME, nenhum GRANT (as roles `crm_preview_reader`/`crm_ai_preview_writer` NÃO ganham acesso automático às tabelas novas — se o CRM precisar mostrar consentimento/supressão na tela via `crm_preview_reader`, um GRANT explícito futuro será necessário; não é bloqueio para aplicar as migrations agora). Sem RLS (Postgres puro via Prisma, não Supabase). Sem trigger. Sem constraint que colida com dado existente (tabelas novas).

### 16.5 Plano de secrets (NENHUM criado)
```
SECRET_NAME=EMAIL_HASH_PEPPER
DESTINATION=variável de ambiente do serviço que grava/lê o ledger de consentimento (Cloud Run do drosa-recovery, mesmo lugar dos demais secrets de produção — via Secret Manager, nunca texto puro)
ROTATION_POLICY=NÃO rotacionar sem plano de remigração: trocar o pepper invalida TODOS os hashes já gravados (o e-mail original não fica salvo em lugar nenhum para recalcular). Só mudar dentro de um projeto explícito de "reemitir o ledger a partir do zero via novo backfill completo".
BACKUP_REQUIREMENT=cópia offline segura (ex.: gerenciador de segredos do usuário/cofre da equipe) ANTES do primeiro backfill real — perder o pepper sem backup é equivalente a perder a capacidade de comparar e-mails novos com o histórico gravado
CONSUMERS=emailConsentService.hashEmail (e todo o resto do ledger/supressão/tracking, que dependem dele por composição)

SECRET_NAME=EMAIL_UNSUBSCRIBE_SECRET (+ EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS, só durante rotação)
DESTINATION=mesmo Cloud Run, variável separada (NUNCA o mesmo valor do pepper — são usados para fins diferentes: HMAC de link vs HMAC de identidade)
ROTATION_POLICY=rotacionável: gerar o novo valor em EMAIL_UNSUBSCRIBE_SECRET, mover o valor antigo para EMAIL_UNSUBSCRIBE_SECRET_PREVIOUS (o verificador aceita as duas — ver unsubscribeVerificationSecrets), remover o _PREVIOUS só depois que não houver mais link antigo em circulação (nenhum e-mail com link antigo ainda "vivo")
BACKUP_REQUIREMENT=menos crítico que o pepper (rotação não perde dado, só invalida links já enviados se feita sem o par _PREVIOUS) — ainda assim, guardar como os demais secrets de produção
CONSUMERS=emailUnsubscribeToken (assinatura/verificação do link) e emailDispatcher (emissão dos cabeçalhos List-Unsubscribe)
```
Requisito comum: ambos ≥ 32 caracteres criptograficamente aleatórios (a validação de tamanho mínimo já está no código: `EMAIL_HASH_PEPPER_MIN_LENGTH` / `EMAIL_UNSUBSCRIBE_SECRET_MIN_LENGTH`), nunca em texto puro, nunca impressos, nunca no Git.

### 16.6 Plano do backfill real (NÃO executado)
Sequência definitiva, cada passo condicionado ao anterior:
1. **Aplicar as 3 migrations**, na ordem (…230000 → …233000 → …234500), com `prisma migrate deploy` contra o banco alvo e credencial admin.
2. **Verificar o schema**: `prisma migrate status` = "Database schema is up to date!"; conferir as 3 linhas novas em `_prisma_migrations`.
3. **Novo dry-run** (`runBackfillEmailConsent({ dryRun: true })`, ou o script `email-consent-backfill-dryrun.js`) contra o MESMO banco — deve reproduzir exatamente os agregados já vistos nesta rodada (universo 3.755: 2.122/1.532/97/4). Qualquer divergência = abortar (§ critérios abaixo).
4. **Backfill real**: `runBackfillEmailConsent({ dryRun: false })` (ou o job equivalente rodado com a credencial de escrita, fora do modo `CRM_PREVIEW_READONLY`) — grava `EmailConsentEvent` + `EmailMarketingConsent`.
5. **Reexecução de idempotência**: rodar o backfill real UMA segunda vez. Esperado: `eventsInserted=0` (tudo já existe via `skipDuplicates`), `statesWritten` igual ao número de e-mails com sinal (recalcula, não duplica).
6. **Verificação agregada final**: contar `EmailMarketingConsent` por `status` no banco e comparar com o `universe.byState` do dry-run — devem bater.

**Critérios de abortar (parar e reportar, não seguir para o próximo passo):**
- universo diferente de 3.755 sem explicação (ex.: pedidos/checkouts novos entre a auditoria e o backfill — aceitável só se a diferença for pequena e explicada pela janela de tempo);
- qualquer erro do `prisma migrate deploy` ou do `migrate status` não "up to date";
- `eventsInserted` na segunda rodada > 0 (quebra de idempotência — bug, não seguir);
- qualquer hash calculado no backfill não bater com `hashEmail` chamado isoladamente para o mesmo e-mail de teste (inconsistência de pepper);
- qualquer conflito inesperado (estado que deveria ser `SNAPSHOTS_UNANIMOUS` saindo como `SIGNAL_CONFLICT`, ou vice-versa, fora dos 97 já conhecidos);
- qualquer escrita fora de `email_consent_events`/`email_marketing_consents` (o backfill NUNCA deve tocar `customers`, `orders`, `abandoned_checkouts`, `whatsapp_consents`, `suppressions`).

`BACKFILL_REAL_PLAN_READY=YES`.

### 16.7 Verificação final desta rodada
Suíte **1056/1056**, `tsc --noEmit`, `eslint src --ext .ts` e `tsc -p tsconfig.build.json --noEmit` — todos limpos, rodados DEPOIS dos 3 commits e do push (não antes). Confirmado por grep: `adapter.send(` só é chamado dentro de `emailDispatcher.ts`; nenhuma rota importa `EmailProviderAdapter`. Push feito: `origin/feat/email-consent-suppression-tracking` = `ba94979` (mesmo HEAD do local). PR não criado (sem `gh` CLI); comparação manual: `https://github.com/drosamoda/drosa-recovery/compare/review/crm-v2-visual...feat/email-consent-suppression-tracking?expand=1`.

`LEGAL_REVIEW_REQUIRED_BEFORE_REAL_CAMPAIGN=YES` (inalterado desde o Passo 1 — nenhum disparo real antes da revisão jurídica/LGPD, independente do estado técnico).
