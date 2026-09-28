# D'Rosa Central — Maturidade Operacional + Campaign Studio

**Data:** 2026-09-28  
**Status:** Design aprovado em conversa; aguardando revisão do documento antes do plano de implementação  
**Baseline de código:** `main@b12f69784e317c5d6c66f98fb34edb6370cf66c2`  
**Repositório:** `drosamoda/drosa-recovery`

## 1. Objetivo

Evoluir a D'Rosa Central de um conjunto consolidado de CRM, Recovery, WhatsApp, e-mail, BI e IA para uma plataforma operacional e comercial madura, mantendo a arquitetura atual como base.

A próxima etapa tem dois objetivos inseparáveis:

1. **Confiabilidade operacional:** envio transacional e automações precisam rodar de forma previsível, observável e recuperável.
2. **Campaign Studio:** a Central deve detectar oportunidades e produzir campanhas completas de e-mail e WhatsApp, incluindo textos, imagens, variações, preview, validação, aprovação humana e resultados.

O sistema não deve permitir que IA determine elegibilidade, invente produto, invente consentimento ou envie campanha sem os gates existentes.

---

## 2. Estado atual relevante

A base arquitetural atual é mantida:

- um serviço principal `drosa-recovery` com Express;
- React/Vite em `/crm-next`;
- `/crm-api/*` same-origin;
- Prisma + Supabase;
- WhatsApp Cloud API / Meta;
- Nuvemshop;
- Resend;
- BI nativo sobre views `bi_*`;
- Metabase como camada analítica aprofundada;
- sessão da Central por cookie HttpOnly;
- gates fail-closed de envio.

O P0 de `/inbox/conversations` já foi corrigido no código e validado em produção em revisão própria. A Visual 2.0 já foi mesclada ao `main`; seu rollout operacional é separado deste design.

### 2.1 Incidente operacional a encerrar

A auditoria de envio identificou:

- `ENABLE_INTERNAL_CRON=false`;
- ausência dos Scheduler jobs essenciais de `process-messages`, `sync-abandoned-checkouts` e `sync-boleto-expiring`;
- fila transacional acumulada;
- remarketing agendado, porém sem elegíveis por falta de consentimento de marketing comprovado;
- `JOBS_SECRET` exposto em transcript durante inspeção operacional.

O design assume que o segredo exposto será rotacionado e que a automação transacional será reativada de forma controlada, sem enviar cegamente toda a fila histórica.

---

## 3. Princípios arquiteturais

### 3.1 Monólito modular, não microserviços

Manter o `drosa-recovery` como serviço principal. A complexidade atual pede fronteiras internas melhores, não novos serviços.

### 3.2 Fail-closed

Toda capacidade irreversível nasce desligada.

Exemplos:

- envio WhatsApp;
- envio de e-mail;
- execução automática de campanhas;
- novas ações administrativas;
- novos providers de geração de imagem.

### 3.3 IA cria; regras decidem; humano aprova

Fluxo obrigatório:

```text
IA / Campaign Studio
        ↓
Product Truth
        ↓
Eligibility Engine
        ↓
Compliance
        ↓
Human Approval
        ↓
Dispatcher
```

A IA nunca decide sozinha quem pode receber uma campanha.

### 3.4 Fonte canônica por verdade

Cada decisão deve ter uma fonte canônica:

- produto: Nuvemshop / Product Truth;
- elegibilidade WhatsApp: remarketing/consent/suppression/cooldown;
- elegibilidade e-mail: consent ledger + live consent + suppression;
- BI: views aprovadas;
- template WhatsApp: biblioteca Meta aprovada;
- status de campanha: CampaignDraft.

### 3.5 Sem dados inventados

Nenhuma UI, gráfico, copy ou recomendação pode afirmar preço, estoque, produto, conversão, consentimento, disponibilidade ou resultado sem fonte comprovada.

---

## 4. Arquitetura-alvo

```text
D'ROSA CENTRAL
│
├── Command Center
├── Cliente 360
├── WhatsApp / Inbox
├── Recovery
│
├── Campaign Studio
│   ├── Oportunidades
│   ├── Audiência
│   ├── Product Truth
│   ├── Creative Brief
│   ├── Copy Generator
│   ├── Image Generator
│   ├── Creative Variants
│   ├── Preview
│   ├── Compliance
│   ├── Aprovação
│   ├── Agendamento
│   └── Resultados
│
├── Email
├── Saúde
└── BI
```

O Campaign Studio reaproveita os componentes já existentes em vez de criar um sistema paralelo.

---

## 5. Trilha A — confiabilidade operacional

### 5.1 Rotação do JOBS_SECRET

O segredo exposto deve ser considerado comprometido.

Rotação exige:

1. criar nova versão;
2. atualizar revisão do Cloud Run;
3. atualizar todos os Scheduler jobs;
4. validar autenticação dos jobs;
5. desabilitar a versão comprometida;
6. registrar rollback sem reabilitar o segredo antigo.

Nenhum valor secreto deve aparecer em stdout, logs ou transcript.

### 5.2 Scheduler transacional

Cadência inicial recomendada, já coerente com a configuração existente:

| Job | Cadência |
|---|---:|
| `process-messages` | 1 minuto |
| `sync-abandoned-checkouts` | 15 minutos |
| `sync-boleto-expiring` | 60 minutos |

O primeiro acionamento não deve simplesmente processar toda a fila histórica.

Antes da ativação contínua, auditar a fila por:

- idade;
- template;
- origem;
- estado;
- elegibilidade atual;
- consentimento aplicável;
- pedido já concluído/cancelado;
- expiração.

O `processMessages` continua sendo o ponto canônico de revalidação antes do envio.

### 5.3 Observabilidade de jobs

A Central deve conseguir responder:

- último run;
- duração;
- encontrados;
- elegíveis;
- enviados;
- skipped;
- deferred;
- failed;
- retries;
- erro mais recente.

Não criar uma segunda engine de jobs; apenas expor o estado da engine existente.

### 5.4 Pool e banco

O P0 de Inbox foi resolvido, mas permanece o débito de concorrência.

Antes de alterar `connection_limit`, medir:

```text
Cloud Run max instances
× conexões por instância
≤ orçamento seguro do pool/Supabase
```

Candidatos a investigação por `EXPLAIN ANALYZE`:

- `orders.customerPhone`;
- `chat_messages(conversationId, createdAt)`;
- `chat_messages(conversationId, direction, createdAt)`.

Índices só entram após evidência.

---

## 6. Trilha B — Consent Truth para WhatsApp

O remarketing atual encontra candidatos, mas corretamente bloqueia envio quando o consentimento de marketing não está comprovado.

Isso não é uma falha do Scheduler.

### 6.1 Objetivo

Construir uma visão operacional de cobertura:

```text
Total com telefone
Consentimento transacional
Consentimento marketing
Revogados
Suprimidos
Cooldown
Elegíveis por segmento
Cobertura de marketing
```

Todos os números devem vir de dados reais.

### 6.2 Regra

Consentimento transacional e marketing permanecem escopos paralelos.

Nunca transformar:

```text
transacional → marketing
```

em um funil implícito.

### 6.3 Aquisição de consentimento

A solução para baixa elegibilidade é aumentar consentimento por pontos legítimos de captura e reconciliação, não remover o gate.

O projeto `feat/nuvemshop-current-consent-sync` não deve ser mesclado automaticamente; ele permanece sujeito a revisão própria de LGPD e desenho de fonte canônica.

---

## 7. Trilha C — Campaign Studio

## 7.1 Fluxo principal

```text
Oportunidade real
      ↓
Audiência real
      ↓
Produto / Product Truth
      ↓
Creative Brief
      ↓
Geração de variantes
      ↓
Copy + imagem
      ↓
Compliance + Fidelity
      ↓
Preview
      ↓
Edição humana
      ↓
Aprovação humana
      ↓
Agendamento
      ↓
Dispatcher
      ↓
Resultados
      ↓
Aprendizado
```

### 7.2 Oportunidade

A oportunidade deve informar:

- canal;
- tipo;
- audiência encontrada;
- audiência elegível;
- bloqueados;
- principais bloqueios;
- timing recomendado;
- nível de confiança;
- evidência usada;
- produto recomendado somente quando suportado.

A existência de candidatos não implica autorização de envio.

### 7.3 Creative Brief

O brief deve ser estruturado e persistível.

Campos conceituais:

- objetivo;
- canal;
- segmento;
- hipótese comercial;
- produto/variante;
- fatos permitidos;
- claims proibidos;
- tom;
- CTA;
- restrições de canal;
- evidências;
- data de geração;
- versão do prompt.

---

## 8. Geração de texto para e-mail

Cada campanha de e-mail deve poder gerar um Creative Bundle:

```text
5 assuntos
3 preheaders
headline
subheadline opcional
copy principal
blocos de benefício
CTA
alt text de imagem
versão curta
versões A/B/C
```

### 8.1 Regras

- sem afirmações não comprovadas;
- sem preço/estoque inventado;
- sem urgência falsa;
- sem extrapolar Product Truth;
- unsubscribe e transparência permanecem obrigatórios;
- o texto principal deve viver no HTML, não queimado na imagem.

### 8.2 Preview

Preview responsivo com pelo menos:

- desktop;
- mobile;
- assunto;
- preheader;
- hero;
- copy;
- CTA;
- footer/unsubscribe.

---

## 9. Geração de imagens

### 9.1 Objetivo

Gerar assets comerciais para campanha sem alterar a verdade visual do produto.

### 9.2 Provider abstraction

Criar contrato conceitual:

```ts
interface CreativeImageProvider {
  generate(input): Promise<CreativeAsset>
  edit(input): Promise<CreativeAsset>
}
```

O Campaign Studio não deve depender de um provider específico.

### 9.3 Product Fidelity Gate

Cada asset precisa ser ligado a:

- productId;
- variantId quando aplicável;
- cor;
- imagens de referência;
- fatos do Product Truth;
- creative brief;
- provider;
- versão do prompt;
- timestamp;
- status de fidelidade.

Estados:

```text
PENDING
PASS
REJECTED_PRODUCT_MISMATCH
REJECTED_UNSUPPORTED_CLAIM
REJECTED_OTHER
```

Aprovação humana continua necessária mesmo após Fidelity PASS.

### 9.4 Imagem e texto

Por padrão, a imagem não deve conter a copy principal.

Texto promocional, preço e CTA permanecem no HTML/UI sempre que possível.

---

## 10. WhatsApp no Campaign Studio

### 10.1 Templates já aprovados

Fluxo:

```text
campanha
→ template Meta aprovado
→ variáveis
→ preview renderizado
→ eligibility
→ compliance
→ aprovação
→ schedule
```

### 10.2 Nova copy

Fluxo:

```text
IA propõe copy
→ humano edita
→ WAITING_META_APPROVAL
→ Meta aprova
→ template entra na biblioteca
→ campanha pode usar
```

Nunca tentar enviar texto de marketing arbitrário fora do contrato do template aprovado.

### 10.3 Segmentos

Manter suporte conceitual aos segmentos já existentes:

- abandoned_cart;
- pix_pending;
- boleto_pending;
- recent_customer;
- inactive_customer / winback;
- vip_customer;
- engaged_no_purchase;
- repeat_purchase.

A UI deve sempre separar:

```text
found
eligible
blocked
block reasons
```

---

## 11. Modelo de dados

### 11.1 Reaproveitar CampaignDraft

Continuar usando `CampaignDraft` como raiz de estado.

No primeiro ciclo, manter brief/copy/strategies em JSON estruturado quando isso reduzir migration desnecessária.

### 11.2 Nova entidade recomendada: CampaignCreativeAsset

Imagens possuem ciclo de vida independente e devem ser normalizadas.

Campos conceituais:

```text
id
campaignDraftId
variantIndex
assetType
provider
storageUrl
productId
variantId
productEvidence
promptVersion
generationMetadata
fidelityStatus
approvedBy
approvedAt
createdAt
updatedAt
```

Não armazenar secrets ou payloads sensíveis do provider.

### 11.3 Creative Variant

No MVP, cada variante pode permanecer dentro do JSON estruturado do draft:

```text
subject
preheader
headline
body
cta
altText
hypothesis
compliance
assetIds[]
```

Normalizar em tabela própria somente quando volume/consulta justificar.

---

## 12. Estados da campanha

Fluxo recomendado:

```text
DRAFT
→ GENERATING
→ READY_FOR_REVIEW
→ SELECTED
→ COMPLIANCE_REVIEW
→ APPROVED
→ SCHEDULED
→ RUNNING
→ COMPLETED

saídas:
CANCELLED
BLOCKED
FAILED
```

Para WhatsApp com template novo:

```text
WAITING_META_APPROVAL
```

Nenhum estado pode pular `APPROVED` por ação automática da IA.

---

## 13. Autorização e RBAC

A Central hoje possui `admin` e `read`, mas o middleware de leitura apenas verifica sessão válida.

Antes de ações reais do Campaign Studio:

- rotas de geração podem ser permitidas a admin;
- approve/schedule/cancel/send exigem admin;
- role deve ser reavaliado em sessão ou invalidado de forma coerente quando a lista de admins mudar;
- todas as ações administrativas devem gerar auditoria.

Ações irreversíveis não devem depender apenas do antigo `x-crm-read-secret`.

---

## 14. Auditoria

Registrar, sem PII desnecessária:

- quem criou;
- quem regenerou;
- quem selecionou;
- quem aprovou;
- quem agendou;
- mudança de estado;
- provider usado;
- versão de prompt;
- asset selecionado;
- bloqueio de compliance;
- resultado operacional.

Não registrar secrets, tokens ou payloads completos de terceiros.

---

## 15. Segurança e observabilidade

### 15.1 Redaction única

Unificar política de redaction para logger e Sentry.

Cobrir pelo menos:

- authorization;
- cookies;
- set-cookie;
- x-admin-secret;
- x-jobs-secret;
- x-inbox-admin-secret;
- x-crm-read-secret;
- database URLs;
- provider keys;
- upstream secrets;
- telefones/e-mails quando não necessários.

### 15.2 Health model

Separar:

```text
/health
/health/ready
/health/integrations
```

Conceitos:

- liveness;
- DB/config readiness;
- Meta;
- Nuvemshop;
- Email;
- BI;
- Metabase;
- job freshness;
- webhook freshness.

Não transformar liveness em uma chamada lenta a todos os terceiros.

### 15.3 Security headers

Avaliar e implantar, com compatibilidade do embed:

- CSP;
- X-Content-Type-Options;
- Referrer-Policy;
- HSTS;
- Permissions-Policy;
- frame policy apropriada.

---

## 16. CI/CD

O CI oficial precisa ser fonte canônica.

### Backend

- typecheck;
- lint;
- unit;
- integration;
- production build.

### Frontend

- typecheck;
- lint;
- tests;
- build.

### Nuvemshop extension

- typecheck;
- tests;
- build.

### Prisma

- generate;
- validate;
- sanity de migrations.

### Segurança

- secret scan.

### Build de produção

O gate precisa executar caminho equivalente ao `gcp-build`, não apenas `tsc`.

---

## 17. Deploy e rollout

Mudanças operacionais e comerciais devem continuar separadas.

### 17.1 Scheduler/JOBS_SECRET

Deploy independente.

### 17.2 Campaign Studio

Primeiro preview.

Depois:

```text
PR
→ CI
→ nova imagem do main
→ revisão 0%
→ smoke
→ canary
→ observação
→ promoção
```

Rollback deve permanecer explícito.

### 17.3 Assets

Imagens geradas precisam de storage persistente apropriado; não depender do filesystem efêmero do Cloud Run.

O provider e o storage são decisões de implementação, não são fixados por este design.

---

## 18. Resultados e aprendizado

### Email

Quando confiáveis:

- queued;
- sent;
- delivered;
- bounced;
- complained;
- unsubscribed;
- opened/clicked somente se tracking estiver configurado e aceito;
- conversão somente se houver vínculo factual.

### WhatsApp

- accepted;
- delivered;
- read;
- failed;
- replied.

O sistema pode aprender correlações, mas não declarar causalidade sem desenho experimental apropriado.

---

## 19. UX do Campaign Studio

Tela principal:

```text
Oportunidades
├── Email
└── WhatsApp

Selecionar oportunidade
        ↓
Audience & blockers
        ↓
Produto / evidência
        ↓
Creative Studio
   ├── Variante A
   ├── Variante B
   └── Variante C
        ↓
Preview
        ↓
Compliance
        ↓
Aprovar
```

Ações:

- regenerar texto;
- regenerar imagem;
- editar;
- comparar;
- selecionar;
- aprovar;
- cancelar.

Nenhum botão de envio deve aparecer habilitado quando o canal não estiver operacionalmente elegível.

---

## 20. Não objetivos deste ciclo

Não fazem parte desta arquitetura imediata:

- microserviços;
- reescrita do backend;
- substituir Prisma;
- substituir Nuvemshop;
- substituir Meta;
- reconstruir o Visual 2.0;
- permitir IA autônoma enviar campanhas;
- ignorar consentimento para aumentar audiência;
- criar um novo CRM separado;
- criar um novo BI separado.

---

## 21. Dívidas explícitas

Permanecem rastreadas:

- `INBOX_CONCURRENCY_PERFORMANCE_DEBT`;
- `WEBHOOK_NUVEMSHOP_ERRORS`;
- `BI_TIMEZONE_DEBT`;
- `HISTORICAL_CONSENT_DEBT`;
- `PURCHASED_AFTER_CONTACT_DEBT`;
- `AI_OPPORTUNITIES_PERFORMANCE_DEBT`;
- `DISTRIBUTED_RATE_LIMIT_DEBT`;
- `METABASE_CARD_FIXES`;
- testes intermitentes sob carga;
- cleanup pós-cutover;
- PR antigo de consent sync sujeito a decisão separada.

---

## 22. Critérios de aceitação arquitetural

A implementação futura só será considerada completa quando:

### Operação

- Scheduler transacional executa de forma previsível;
- `JOBS_SECRET` comprometido está revogado;
- fila não cresce indefinidamente;
- jobs e webhooks têm freshness observável;
- nenhuma regressão de 5xx/pool é introduzida.

### Remarketing

- candidatos, elegíveis e bloqueios são visíveis;
- consentimento nunca é inferido;
- cobertura de consentimento é mensurável;
- envio com consentimento ausente continua bloqueado.

### Campaign Studio

- cria pelo menos três variantes reais;
- gera copy de e-mail;
- gera assets de imagem por provider abstraction;
- Product Truth e Fidelity Gate funcionam;
- preview de e-mail funciona;
- WhatsApp só usa template aprovado;
- aprovação humana é obrigatória;
- audit trail existe.

### Segurança

- admin é exigido para ações de escrita sensíveis;
- secrets não aparecem em logs;
- redaction é comum a logger/Sentry;
- rollback está documentado.

### Engenharia

- CI valida frontend e build real;
- documentação canônica reflete o estado atual;
- handoffs antigos não competem com CURRENT_STATE;
- testes críticos são determinísticos.

---

## 23. Sequência arquitetural aprovada

A ordem de alto nível é:

```text
1. Concluir rollout seguro da Visual 2.0
2. Rotacionar JOBS_SECRET
3. Restaurar Scheduler transacional com rollout controlado
4. Estabilizar fila, webhooks e observabilidade
5. Criar Consent Truth / coverage
6. Construir Campaign Studio: brief + copy + image + preview
7. Integrar WhatsApp remarketing com templates aprovados
8. Integrar email campaign flow
9. Endurecer CI, health, redaction e segurança
10. Corrigir BI/Metabase semântico
11. Executar cleanup pós-cutover
12. Planejar futuras ações operacionais mais amplas dentro da Central
```

A criação de campanhas entra cedo porque é objetivo central de negócio, mas o envio permanece isolado atrás dos gates existentes.

---

## 24. Decisão final

A D'Rosa Central permanece como **monólito modular operacional**.

O principal novo subsistema é o **Campaign Studio**, construído sobre as capacidades atuais, não em paralelo.

A prioridade é combinar:

```text
RELIABILITY
+
CONSENT TRUTH
+
CREATIVE GENERATION
+
HUMAN APPROVAL
+
MEASUREMENT
```

sem sacrificar os mecanismos fail-closed que já protegem produção.
