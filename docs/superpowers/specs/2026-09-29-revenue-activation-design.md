# Revenue Activation — WhatsApp transacional, campanhas de e-mail e prontidão do WhatsApp marketing

- Data: 2026-09-29
- Classificação: ARCHITECTURAL (superpowers brainstorming)
- Status: DESIGN APROVADO → spec aguardando aprovação
- Fora de escopo: Visual 2.1, performance/pool (`INBOX_CONCURRENCY_PERFORMANCE_DEBT`), divergência de fuso BI×Saúde, qualquer feature nice-to-have.

## 1. Objetivo e critério de sucesso

Sair de "CRM que observa" para "CRM que vende", com o menor caminho seguro até produção:

1. fila transacional de WhatsApp processando sozinha e drenando;
2. mensagens operacionais reais (confirmação de pedido, pagamento confirmado, PIX, boleto) saindo;
3. primeira campanha real de e-mail enviada em canário e depois ampliada, com segurança (consentimento, supressão, descadastro fail-closed);
4. status e métricas registrados (entrega, bounce, reclamação, descadastro, abertura/clique quando o provedor fornecer, pedido após clique);
5. fluxo de campanha utilizável pela Central, sem script manual;
6. base de WhatsApp marketing pronta para crescer com consentimento real.

Nada depende de operação manual frágil: toda execução recorrente é Cloud Scheduler → rota `/jobs/*` autenticada.

## 2. Contexto confirmado (auditoria 28–29/09)

- Scheduler tem só `drosa-remarketing-{recent,vip,engaged}`; não existe job para `/jobs/process-messages` → 83 mensagens `pending` desde 28/09 01:41 (27 confirmação, 27 pagamento confirmado, 27 `_pix_pendente`, 2 boleto).
- 282 `failed` são históricas (mais recente maio/2026) — fora do escopo desta entrega; não reprocessar.
- `processMessages` já revalida antes de enviar (ex.: `payment_already_completed`, `order_cancelled`) e marca `skipped` com `reason`.
- `JOBS_SECRET` (`drosa-recovery-jobs-secret:1`, versão fixa na revisão) foi exposto em transcript anterior.
- E-mail: Resend + ledger de consentimento + supressão + descadastro + `emailSendGate` + `emailCampaignExecutor` (lote, limites, estados `SCHEDULED→RUNNING→…`) + webhook `/webhooks/.../resend` + atribuição `LAST_CLICK_7D` já em `main`; ~2.122 e-mails OPT_IN. Flags de envio todas `false`.
- API de campanhas (`/crm-api/ai/campaigns` create/select/approve/schedule/cancel) existe; responde 503 `AI_DATABASE_NOT_CONFIGURED` porque `AI_DATABASE_URL` não está configurada (tabelas `campaign_drafts`/`ai_runs` já existem no banco principal; o client restrito só enxerga essas duas).
- WhatsApp: consentimento via marcador no pedido (`recordConsentFromNuvemshopOrderExtra`); 0 consentimentos GRANTED reais → remarketing roda com 0 elegíveis (correto).
- Gates LGPD do e-mail: A (mecanismo de transferência internacional Resend), B (evidência do Resend), C (aprovação jurídica humana), D (publicação do adendo — bloqueada na Nuvemshop por falta de `write_content`; página própria `/privacy/email-marketing` existe).

## 3. P0A — WhatsApp transacional

### 3.1 Execução recorrente
- Novo job Cloud Scheduler `drosa-process-messages`: `POST /jobs/process-messages`, a cada 2 min, header `x-jobs-secret` (versão nova, ver 3.3), timeout ≥ 120 s, retry do Scheduler desligado (o próprio job é idempotente e roda de novo em 2 min).
- Abordagem descartada: `ENABLE_INTERNAL_CRON` (Cloud Run escala a zero/N instâncias → não roda ou duplica).

### 3.2 Expiração de mensagens atrasadas (decisão do dono: opção A)
Nova regra na revalidação pré-envio (`processMessages`), aplicada a toda mensagem transacional no momento do processamento:

| Template / evento | Envia se | Senão |
|---|---|---|
| confirmação de pedido | criada há ≤ 24 h | `skipped`, `reason=expired_stale` |
| pagamento confirmado | criada há ≤ 24 h | `skipped`, `reason=expired_stale` |
| PIX pendente | pedido ainda `pending`, não cancelado, e dentro da validade do PIX; sem data de validade no pedido → criada há ≤ 24 h | `skipped`, `reason=expired_stale` (ou os motivos já existentes `payment_already_completed`/`order_cancelled`) |
| boleto (pedido/vencendo) | pedido ainda `pending`, não cancelado, e vencimento não passou; sem vencimento no pedido → criada há ≤ 24 h | idem |

Regras obrigatórias:
- expirada **não** é falha: status `skipped`, nunca `failed`; não entra em contagem de falhas nem em alertas de falha;
- sem retry após expirar; o registro nunca é apagado;
- rótulo na Central: `reason=expired_stale` → "Não disparada · expirada" (o resto de `skipped` continua "Não disparada · bloqueada");
- a janela (24 h) fica em constante nomeada no código, coberta por teste; não vira flag de ambiente.

### 3.3 Rotação do `JOBS_SECRET`
Nova versão do secret → nova revisão Cloud Run apontando para a versão nova (não `latest`) com 0% → smoke → troca de tráfego → atualizar header dos 3 jobs de remarketing + o novo → desabilitar a versão antiga do secret depois de 1 h sem 401 nos logs. Rollback: revisão anterior (secret antigo só é desabilitado após o período de observação).

### 3.4 Idempotência (verificação, não reescrita)
Confirmar por código + teste que o claim `pending→processing` é atômico (`updateMany` condicional) e que duas execuções concorrentes do job não enviam a mesma mensagem. Se houver lacuna, corrigir só o claim.

### 3.5 Canário e drenagem
1. revisão nova a 0% → smoke; 2. execução manual única do job com limite reduzido (≤ 5 mensagens) → conferir no log e no webhook da Meta: enviadas/entregues, expiradas marcadas corretamente, nenhuma duplicada; 3. ligar o Scheduler; 4. observar até a fila atual chegar a 0 pendentes vencíveis; 5. conferir que novos pedidos geram mensagem que sai em ≤ ~5 min.

### 3.6 Alerta de fila parada
Novo job Scheduler (a cada 15 min) em `GET /jobs/automation-health` (já existe). No Action Center da Central, item crítico "Fila de WhatsApp parada" quando houver `pending` com `scheduledAt` mais antigo que 15 min. Só usa dados que `/crm-api/health` já expõe (`oldestPending`); nenhum threshold de negócio novo além desse.

## 4. P0B — Campanhas de venda por e-mail

### 4.1 Ativação do banco de campanhas
Criar credencial Postgres dedicada (papel com acesso só a `campaign_drafts`/`ai_runs`), guardar em Secret Manager (`drosa-recovery-ai-database-url`), ligar `AI_DATABASE_URL` na revisão. Nenhuma migration nova.

### 4.2 Remetente e provedor
Verificar (somente leitura) domínio do Resend (SPF/DKIM verificados), `EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`, chave do provedor e secret do webhook já wireados. Qualquer DNS pendente = ação humana (parada).

### 4.3 Gates LGPD
- A/B: fechados só com documento do Resend **ou** decisão registrada do dono de aceitar os termos padrão publicados pelo Resend (DPA/SCC públicos), com link e data no `EMAIL_LGPD_REVIEW_PACKET.md`.
- C: aprovação do dono registrada no mesmo documento.
- D: adendo publicado em `/privacy/email-marketing` (domínio próprio) e linkado no rodapé de todo e-mail; página da Nuvemshop deixa de ser pré-requisito.
- Só depois do registro: `EMAIL_TRANSFER_MECHANISM_APPROVED`, `EMAIL_LEGAL_REVIEW_APPROVED`, `EMAIL_SEND_ENABLED`, `EMAIL_CAMPAIGN_EXECUTOR_ENABLED` = true. O agente nunca liga essas flags sem o registro.

### 4.4 Fluxo mínimo na Central (Campanhas & IA)
Primeiras ações de escrita do frontend, visíveis e permitidas **só para sessão com `role=admin`** (backend valida; leitura continua igual):
1. **Criar rascunho** a partir de um segmento da biblioteca de e-mail existente (`POST /crm-api/ai/campaigns`).
2. **Revisar**: prévia renderizada com rodapé de conformidade e link de descadastro; contagem de elegíveis já descontando supressão/opt-out; limite de envio (`maxTotalSends`) editável.
3. **Aprovar** (`/approve`) — exige confirmação explícita.
4. **Agendar** (`/schedule`) com data/hora e tamanho do canário.
5. **Cancelar** enquanto `SCHEDULED`/`RUNNING`.
6. **Acompanhar**: status do rascunho e métricas (4.6).
Proxy: as rotas de escrita passam pelo mesmo `/crm-api` same-origin com sessão; CSRF: toda escrita exige `Origin` igual ao host da Central (rejeita ausente/diferente); o atributo `SameSite` do cookie de sessão atual é verificado e mantido no mínimo `Lax`. Nenhuma outra escrita é adicionada.

### 4.5 Execução
Novo job Scheduler `drosa-process-email-campaigns`: `POST /jobs/process-email-campaigns` a cada 5 min. Lote/limites do executor (`EMAIL_CAMPAIGN_BATCH_SIZE`, `EMAIL_CAMPAIGN_MAX_TOTAL_SENDS`, `EMAIL_CAMPAIGN_MAX_DRAFTS_PER_RUN`) configurados com valores conservadores na primeira campanha. Revalidação de consentimento/supressão por destinatário continua no gate (fail-closed).

### 4.6 Canário e medição
- Primeira campanha: `maxTotalSends=50`. Critério para ampliar: 0 erro de envio sistêmico, bounce < 5%, 0 reclamação de spam; ampliar em lotes (ex.: 250 → 1.000 → restante) com o mesmo critério a cada etapa.
- Métricas por campanha (de `EmailSend`/`EmailEventLog`): enviados, entregues, bounce, reclamação, descadastro, abertura e clique quando o Resend fornecer, e "pedidos após clique (7 dias)" pela atribuição existente — rotulado como "após clique", nunca como conversão causal.

## 5. P0C — WhatsApp marketing (prontidão, sem envio)

1. Verificar/instalar o script de consentimento do checkout na loja (token atual tem `write_scripts`).
2. Pedido de teste → consentimento gravado em `whatsapp_consents` com origem e data; opt-out continua prevalecendo.
3. Central (Campanhas & IA, somente leitura): contagem de contatos com consentimento de marketing ativo e evolução.
4. Remarketing inalterado: continua respeitando consentimento/cooldown e passa a enviar sozinho conforme a base cresce. Integração ao fluxo de campanhas: depois do P0B (fora desta entrega).

## 6. Erros e segurança

- Toda rota nova de escrita: sessão admin obrigatória; auditoria de quem aprovou/agendou/cancelou gravada no rascunho.
- Nenhum segredo em log; inspeção de Scheduler sempre com `--format="value(...)"` sem headers.
- Falha do provedor de e-mail: executor marca e segue o lote; nunca reenvia `SENT`.
- Webhooks Meta/Resend inalterados.

## 7. Testes

- `processMessages`: expiração por template (dentro/fora de 24 h; PIX/boleto pendente vs pago/vencido; sem data de validade); expirada ≠ failed; sem retry; claim concorrente não duplica.
- Health/Action Center: fila parada gera item crítico.
- Rotas de escrita de campanha: 401/403 sem sessão/sem admin; fluxo create→approve→schedule→cancel; Origin inválido rejeitado.
- Frontend: fluxo de campanha (render, confirmações, estados, erros 503 do banco de campanhas).
- Gates finais: typecheck, lint, suíte backend e frontend, build, secret scan.

## 8. Paradas humanas previstas

1. Troca de tráfego (P0A e ativação do P0B) — já dentro do rollout autorizado com smoke/0%.
2. DNS do domínio de envio, se não verificado.
3. Registro dos gates A–D pelo dono.
4. Autorização do canário da primeira campanha (50) e de cada ampliação.
5. Instalação do script de consentimento na loja (escrita na Nuvemshop).

## 9. Ordem de entrega

P0A (3.1–3.6) → P0B (4.1–4.6) → P0C (5). Cada bloco com PR próprio e deploy próprio; P0B só depois de P0A estável.
