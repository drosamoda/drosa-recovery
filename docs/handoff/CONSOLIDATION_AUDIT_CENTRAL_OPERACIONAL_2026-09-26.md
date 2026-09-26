# D'Rosa Central Operacional — CONSOLIDATION_AUDIT (Fase 0)

Data: 26/09/2026. Entrega da Fase 0 do "PROMPT MESTRE — D'Rosa Central Operacional 2.0". Só auditoria — **nenhum código foi alterado, nenhuma rota movida, nada apagado.**

## Fonte canônica confirmada

- Repo: `drosamoda/drosa-recovery`, worktree `C:\Users\peter\OneDrive\Área de Trabalho\claude -meta ads\drosa-recovery`, branch `main`, HEAD `dd58231` = `origin/main`, working tree limpo.
- Produção Cloud Run: serviço `drosa-recovery`, projeto `gtm-m4sqc99b-nzjjz`, região `us-central1`, revisão `drosa-recovery-email-compliance-v1` com 100% do tráfego (verificado com paridade byte-a-byte contra este `main` em 26/09).
- **Achado principal, muda a premissa do prompt:** não existem "múltiplos CRMs concorrentes" — existe UM app backend (`drosa-recovery`) servindo DUAS UIs estáticas (`/crm` legado, `/crm-v2` canônico) contra a MESMA API (`/crm-api/*`), mais UM app Next.js totalmente separado (BI, outro projeto/deploy/login). A consolidação real é: (1) aposentar `/crm` depois de portar 1 feature que falta no v2, (2) incorporar o BI como módulo dentro do v2.

## A. INVENTÁRIO

### `/crm` (legado) — `public/crm/` (32K, app.js minificado)
Views: `dashboard`, `journey` (Jornada — **não existe no v2**), `customers`, `conversations`, `messages`, `checkouts`, `pix`, `boleto`, `remarketing`, `automations`, `templates`, `consents`, `health`, `audit`.
Todas consultam os mesmos endpoints `/crm-api/*` que o v2 usa. Apresentação: tabelas cruas paginadas, sem cards de tendência, sem cliente 360 unificado (customer detail é 3 blocos de JSON cru: orders/checkouts/messages).

### `/crm-v2` (canônico) — `public/crm-v2/` (176K, app.js legível)
Nav atual (`app.js:40-47`):
```
dashboard        → Dashboard
messages         → Envios (tabs: Mensagens, Templates)
customers        → Cliente 360 (tabs: Clientes, Consentimentos)
conversations    → Conversas
checkouts        → Carrinho (tabs: Abandonados, Pix, Boleto, Remarketing)
automations      → Campanhas & IA (tabs: Oportunidades, E-mail, Campanhas, Automações, Aprendizados)
health           → Saúde (tabs: Visão geral, Auditoria)
```
Cliente 360 já tem tabs internas (`overview`, `privacy`, etc. — `renderCustomer360Tab`), incluindo consentimentos e suppression por cliente. Campanhas & IA já tem: oportunidades com cards, estratégias A/B/C com achados de compliance, biblioteca de e-mail com segmentos/cooldown/recomendações, aprendizados por status. Isso é **substancialmente mais avançado** que qualquer coisa que precise ser "construída do zero" pelo prompt mestre — grande parte da Fase 4 do prompt (Cliente 360, Campanhas & IA) já existe.

### BI Dashboard (app externo) — `C:\Users\peter\drosa-recovery-bi-dashboard-v0`
Next.js App Router, projeto Vercel separado (`drosa-recovery-bi-dashboard`), login próprio (`DASHBOARD_AUTH_USERS`), lê as mesmas 12 views `bi_*` do MESMO Supabase de produção (role `drosa_bi_reader`, só-leitura, sem PII), mais um Metabase em Cloud Run separado embutido via iframe assinado.
Páginas: `/` (dashboard), `/bi` (embed Metabase — Visão Executiva), `/carrinho-abandonado`, `/consentimentos`, `/envios`, `/pedidos`, `/saude-sistema`, `/templates`, `/webhooks`.
**Sem `.git`** — fonte "oficial" é o chat v0 (`v0.app/chat/bPBuiea0H5s`). Isso é uma limitação real: qualquer código migrado de lá precisa ser copiado manualmente, não há histórico de commits para revisar.

## B. DUPLICAÇÕES

| Dado/tema | `/crm` | `/crm-v2` | BI dashboard | Ação recomendada |
|---|---|---|---|---|
| Dashboard geral | Cards simples | Cards + funis + atividade recente | Cards + Metabase "Visão Executiva" | v2 já é a melhor versão operacional; BI é a melhor versão analítica/tendência — não competem, são complementares |
| Clientes / Cliente 360 | JSON cru (orders/checkouts/messages) | Tabs estruturadas + consentimentos | — | v2 vence, mas falta a "Jornada" (ver linha abaixo) |
| **Jornada/Timeline do cliente** | **`journey` — existe, com filtros ricos (ação, mensagem, consentimento, respondeu, fluxo, período)** | **Não existe** | — | **Única feature real a portar de `/crm` para `/crm-v2` antes de aposentar o legado** |
| Conversas | Tabela crua | Área dedicada | — | v2 vence |
| Carrinho/Pix/Boleto/Remarketing | Tabelas separadas | Unificado em "Carrinho" com tabs | Página "Carrinho Abandonado" (agregada/tendência) | v2 (operacional) + BI (tendência) são complementares, não duplicados |
| Consentimentos | Tabela crua | Tab dentro de Cliente 360 | Página "Consentimentos" (agregada) | idem acima |
| Templates | Tabela crua | Tab dentro de Envios | Página "Templates" (agregada) | idem acima |
| Saúde | JSON cru por integração | Visão geral + Auditoria | Página "Saúde do Sistema" (outra fonte/ângulo) | Precisa decidir: v2/health vira o operacional, BI/saude-sistema vira o painel de tendência histórica dentro do módulo BI do v2 |
| Webhooks | Só dentro de "Auditoria" (eventos técnicos) | Idem | Página dedicada "Webhooks" (com contagem de erro, taxa) | BI tem uma visão mais rica (contagem/taxa de erro) que vale trazer para dentro de Saúde no v2 |
| E-mail | Não existe | **Já existe e é sofisticado** (base, segmentos, biblioteca, recomendações) | Página "Envios" (E-mail + WhatsApp juntos, agregado) | v2 já é o operacional; BI vira só o histórico agregado dentro do módulo BI |
| BI/Metabase | Não existe | Não existe | **Único lugar que existe hoje** | Precisa migrar para dentro do v2 como módulo "BI & Inteligência" |

## C. MELHOR VERSÃO (o que sobrevive)

- **Frontend operacional (transacional, tempo real, ação):** `/crm-v2`. Vence em quase tudo.
- **Frontend analítico (tendência, agregado, histórico):** o conteúdo do BI dashboard (via Metabase embed + páginas próprias), mas **a casca de login/navegação separada não sobrevive** — vira um módulo dentro do v2.
- **Única peça a migrar de `/crm` para `/crm-v2` antes de aposentar o legado:** a view `journey` (Jornada). É pouco código (uma função de ~15 linhas no app.js legado + o endpoint `/crm-api/journey` que já existe e é reaproveitável).
- **Metabase (Cloud Run) e as 12 views `bi_*`:** continuam existindo por baixo exatamente como estão — só a experiência do usuário muda (embed dentro do v2 em vez de app separado).

## D. ARQUITETURA FINAL (proposta, não implementada)

Reaproveitando o que já existe em vez de recriar do zero:

```
D'Rosa Central Operacional (/crm-v2, único login)

Dashboard                    [já existe]

Clientes                     [já existe: Cliente 360 + Consentimentos]
  └── + Jornada/Timeline     [PORTAR de /crm]

Mensagens                    [já existe: Envios + Templates]
  └── Conversas              [já existe como seção irmã — pode virar tab aqui]

Recovery                     [já existe: Carrinho/Pix/Boleto/Remarketing]

Campanhas & IA               [já existe: Oportunidades/E-mail/Campanhas/Automações/Aprendizados]

BI & Inteligência            [NOVO — migrar do app externo]
  ├── Visão Executiva        (Metabase embed, já existe pronto)
  ├── Recovery               (Metabase dashboard "Carrinho Abandonado", id 6)
  ├── Mensagens              (Metabase "Envios", id 3)
  ├── Consentimentos         (Metabase "Consentimentos", id 5)
  ├── Pedidos                (Metabase "Pedidos", id 7)
  └── Webhooks e Saúde       (Metabase "Webhooks e Saude", id 8)

Saúde                        [já existe: Visão geral + Auditoria]
  └── + métricas de erro/taxa de webhook do BI (opcional, ver item B)
```

Não é necessário criar `Auditoria` como item de topo separado — já é uma tab dentro de Saúde no v2, e isso funciona bem.

## E. REDESIGN PLAN (visual)

`/crm-v2` hoje é HTML/CSS/JS vanilla servido como estático pelo Express (não é React/Next.js). Isso significa:
- **Não há componentização real hoje** — cada `render*Area()` monta HTML via template strings. Um design system de verdade (`PageShell`, `StatCard`, `DataTable`, etc., conforme pedido no prompt) exigiria decidir entre (a) introduzir um framework de componentes dentro do mesmo app vanilla (ex.: web components, ou uma camada leve de templating), ou (b) migrar `/crm-v2` para um framework (React/Next.js), o que é uma decisão arquitetural grande, não cosmética.
- **Recomendação:** não decidir isso sozinho nesta auditoria — é exatamente o tipo de "alteração estrutural" que o próprio prompt mestre pede para parar e apresentar antes de agir (seção 36). As opções técnicas com trade-offs devem ser levadas ao usuário antes da Fase 2 (Design System).
- O BI dashboard (Next.js) já tem componentização real e uma paleta/tipografia mais próxima do "SaaS premium" pedido — pode servir de referência de componentes visuais (StatCard, badges de status) mesmo que o v2 continue vanilla por enquanto.

## F. MIGRATION PLAN (passos seguros, em ordem)

1. Portar a view "Jornada" de `/crm` para `/crm-v2` (reaproveita o endpoint `/crm-api/journey` já existente — só UI nova).
2. Decidir e documentar (com o usuário) se `/crm-v2` migra para um framework de componentes ou continua vanilla com um design system leve próprio — **bloqueante para a Fase 2 do prompt mestre**.
3. Criar o módulo "BI & Inteligência" no v2 como nova seção de NAV, reaproveitando os embeds Metabase assinados já existentes (endpoint `/api/metabase/embed-url` do app BI — precisa decidir se esse endpoint migra para dentro do `drosa-recovery` backend ou continua sendo chamado do app Vercel separado).
4. Só depois de (1)-(3) provados em produção: marcar `/crm` como legacy de verdade (banner de aviso, não mais linkado) — **não apagar ainda**, conforme item 30 do prompt.
5. Só depois de tudo estável: avaliar aposentar o app Vercel do BI dashboard — **não apagar ainda**.

## G. RISKS

- `/crm-v2` é vanilla JS de ~2.500+ linhas num único `app.js` — introduzir um design system sem framework tende a virar mais template strings, não componentes reais. Risco de o "redesign premium" ficar caro/lento se a decisão do item F.2 não for tomada antes.
- BI dashboard não tem `.git` — qualquer código migrado de lá precisa ser copiado manualmente e revisado, sem diff/histórico para conferência.
- Unificar login (`x-crm-read-secret` do v2 vs `DASHBOARD_AUTH_USERS`/bcrypt do BI) é uma mudança de autenticação — não uma mudança visual. Precisa de plano próprio e não deve ser feita "de passagem" durante um redesign.
- Nenhuma das automações/flags de envio de e-mail (`EMAIL_SEND_ENABLED` etc., ver `EMAIL_LGPD_FINALIZER_HANDOFF_2026-09-26.md`) deve ser tocada por este trabalho de UI — são projetos ortogonais que só compartilham a mesma tela.

## H. TOP_10_IMPLEMENTATION_TASKS (em ordem, baixo risco primeiro)

1. Portar a view Jornada de `/crm` para `/crm-v2` (reaproveita endpoint existente).
2. Levar ao usuário a decisão de framework para o v2 (vanilla+design-system-leve vs migração para React/Next.js) — **decisão humana, não técnica de IA**.
3. Prototipar o módulo "BI & Inteligência" como nova seção do NAV do v2 (só a casca de navegação + 1 embed Metabase, sem mexer no resto).
4. Levantar e reutilizar o endpoint de embed assinado do Metabase dentro do backend `drosa-recovery` (evita manter 2 apps/2 segredos de embed).
5. Padronizar `StatCard`/badge de status entre v2 e o que já existe no BI (mesma semântica de cor: verde/âmbar/vermelho/cinza, nunca vermelho só porque é `false`).
6. Redesenhar o Dashboard do v2 primeiro (tela-piloto, conforme pedido no prompt), usando os padrões visuais do BI como referência de tipografia/cor.
7. Revisar semântica de métricas já sinalizada no BI (enviadas vs disparadas, funil de conversão pós-leitura, consentimento como escopo paralelo — ver Metric Definitions do D'Rosa Intelligence para o padrão de dicionário de métricas a seguir).
8. Adicionar banner "legado" em `/crm` (sem remover) apontando para `/crm-v2`.
9. Mapear dependências de API keys/webhooks do Resend antes de qualquer limpeza (nenhuma remoção nesta fase).
10. Só então: levar um plano de redesign visual completo (paleta, tipografia, sidebar, cards, tabelas) para aprovação antes de tocar em qualquer tela além do Dashboard.

---

**Não implementei nada além desta auditoria.** Itens 2 e o "REDESIGN PLAN" completo (seções 9-22 do prompt mestre) dependem de uma decisão arquitetural (vanilla vs framework) que cabe ao usuário, não a mim — conforme a própria regra do prompt mestre de parar antes de alterações estruturais.
