# D'Rosa Recovery — MASTER HANDOFF (ler primeiro numa sessão nova)

Data: 27/09/2026. Este arquivo existe para uma sessão nova (ou você) entender em 5 minutos tudo que está em andamento neste repo, sem precisar reconstruir contexto. Ele indexa os handoffs detalhados — não os substitui.

## Onde você está

- Repo: `drosamoda/drosa-recovery` (privado). **Dezenas de worktrees** deste mesmo repo existem na máquina (`git worktree list`) — várias sessões trabalharam em paralelo entre 21-27/09. Nunca force reset/push, nunca mexa em worktree com mudança que não é sua.
- **Este worktree:** `C:\Users\peter\OneDrive\Área de Trabalho\claude -meta ads\drosa-recovery`, branch `feat/central-react`, HEAD `30af607`.
- Projeto GCP: `gtm-m4sqc99b-nzjjz`. Serviço Cloud Run: `drosa-recovery` (região `us-central1`). URL: `https://drosa-recovery-1082403977536.us-central1.run.app`.

Existem **dois workstreams independentes** ativos neste repo agora. Não confundir um com o outro.

---

## Workstream 1 — D'Rosa Central Operacional (migração React)

**Objetivo:** consolidar `/crm` (legado) + `/crm-v2` (vanilla JS) + o BI separado (`drosa-recovery-bi-dashboard`, app Vercel à parte) numa única Central React, migrando tela por tela sobre as APIs `/crm-api/*` já existentes — sem reescrever regra de negócio.

**Branch de trabalho:** `feat/central-react` (a partir de `main` @ `47f36db`). **Nunca commitar isso direto em `main`** — foi um erro de uma rodada anterior, corrigido criando esta branch isolada.

### Estado atual: Foundation + Cliente 360/Jornada = PASS

| Fase | Status | Relatório |
|---|---|---|
| Fase 0 — Auditoria/Blueprint | PASS | `CONSOLIDATION_AUDIT_CENTRAL_OPERACIONAL_2026-09-26.md`, `REACT_MIGRATION_BLUEPRINT_2026-09-26.md` |
| Foundation + Dashboard piloto | PASS | `FOUNDATION_INTEGRATION_REPORT_2026-09-26.md` |
| Cliente 360 + Jornada | PASS | `CLIENTE_360_JOURNEY_MIGRATION_REPORT_2026-09-27.md` |
| Mensagens + Conversas | **NÃO INICIADO** | — |
| Recovery | **NÃO INICIADO** | — |
| Campanhas & IA + E-mail | não iniciado | — |
| Saúde + BI + Auth única + Cutover | não iniciado | — |

**O que já existe e funciona** (`frontend/`, servido pelo próprio Express em `/crm-next`, **não linkado em nenhum menu, não substituiu `/crm-v2`**):
- Stack: Vite + React + TS + Tailwind, SPA pura (sem framework de servidor), zero dependência nova no backend.
- Shell: `AppShell`/`Sidebar` (drawer responsivo <768px, fixa ≥768px)/`Topbar`/`PageHeader`.
- Design system embrionário, genérico (sem lógica de domínio): `StatCard`, `DataTable`, `Tabs`, `StatusBadge`, `ConsentStatus`, `OrderList`, `Timeline`/`TimelineEvent`, `LoadingState`/`ErrorState`/`EmptyState`.
- Telas funcionais: `/` (Dashboard), `/customers` (listagem), `/customers/:id` (Cliente 360 com 6 tabs incl. Jornada).
- 19 testes (Vitest + Testing Library + jsdom), todos passando.
- Auth: mesmo esquema de hoje — `x-crm-read-secret` digitado uma vez, guardado em `sessionStorage`. **Não existe (nem deve existir ainda) nenhuma auth nova.**

**Como rodar localmente:**
```bash
# backend (se precisar testar com backend local + banco local válido — ver Workstream 2 sobre .env)
npm run dev   # raiz do repo

# frontend
cd frontend && npm run dev   # vite, porta 5173 por padrão
# proxy de /crm-api aponta pra localhost:PORT (default 3000) OU:
VITE_BACKEND_URL=https://drosa-recovery-1082403977536.us-central1.run.app npm run dev
```
A segunda forma (`VITE_BACKEND_URL` apontando pra produção) é o jeito seguro de ver dados reais **sem nunca subir um backend local conectado ao banco de produção** — zero risco de cron/worker/envio, porque nenhum processo do `drosa-recovery` roda sob seu controle. Foi assim que toda a validação com dados reais desta fase foi feita.

**Próximo passo:** Fase B (Mensagens + Conversas), no mesmo padrão: inventariar endpoints primeiro (`/crm-api/messages`, `/crm-api/messages/:id`, `/crm-api/conversations`, `/crm-api/conversations/:id`, `/crm-api/templates`, `/crm-api/automations`), reaproveitar os componentes genéricos já provados, smoke read-only contra produção antes de fechar. Vocabulário obrigatório para status de mensagem (não usar "Enviadas" para duas coisas): Avaliadas / Elegíveis / Disparadas / Aguardando entrega / Entregues / Lidas / Bloqueadas-Não disparadas. Depois Recovery (Carrinho/Pix/Boleto/Remarketing) — cuidado especial: "Compra posterior" nunca é etapa do funil, é "Pedidos observados após contato", separado.

**Nunca fazer nesta fase (repetido de todas as rodadas):** alterar consentimento, disparar mensagem real, ativar cron, mexer em elegibilidade/regra de Recovery, mudar Resend, mudar schema, deploy, cutover, mexer em `/crm` ou `/crm-v2`.

---

## Workstream 2 — E-mail marketing / LGPD (compliance, não é sobre UI)

**Objetivo:** liberar o primeiro piloto real de e-mail marketing (máx. 20 destinatários). Já está tecnicamente pronto; só falta o lado jurídico/externo.

**Este workstream vive em `main`**, não em `feat/central-react`. Documento principal: `docs/handoff/EMAIL_LGPD_REVIEW_RESULT_2026-09-23.md` (apesar do nome, tem atualizações até 25-26/09 nas seções 8-10) + `EMAIL_ANPD_SCC_EXECUTION_REQUEST.md` + `EMAIL_PRIVACY_POLICY_ADDENDUM_DRAFT.md` + `EMAIL_LGPD_REVIEW_PACKET.md` + `EMAIL_LGPD_HUMAN_APPROVAL_RECORD.md` (template de decisão humana, criado 26/09, **ainda 100% vazio/pendente**, nenhum campo preenchido).

### 4 gates bloqueando o piloto (nenhum é decisão de IA)

```
A — Mecanismo de transferência internacional Brasil→EUA: BLOCKED
B — Resposta/evidência documental do Resend: WAITING_EXTERNAL
C — Aprovação jurídica humana: PENDING (template pronto, nada preenchido)
D — Publicação do adendo na política geral: PENDING_CONTENT_PERMISSION (token Nuvemshop sem read_content/write_content)
```

5 pedidos já foram enviados a `privacy@resend.com` entre 24-26/09 — **não envie um 6º sem tempo razoável ter passado**. A caixa de e-mail conectada nas sessões de IA (`peterjunio16@gmail.com` via MCP Gmail) **não é** a caixa que envia/recebe essa correspondência — confirmado por busca `to:` direta, não suposição. Sempre reconfirme qual conta está de fato conectada antes de declarar o Gate B resolvido ou não.

**As 5 flags de segurança estão `false` na produção real** (confirmado direto na spec da revisão em produção, não só no código): `EMAIL_SEND_ENABLED`, `EMAIL_TRANSFER_MECHANISM_APPROVED`, `EMAIL_LEGAL_REVIEW_APPROVED`, `EMAIL_CAMPAIGN_EXECUTOR_ENABLED`, `CRON_EMAIL_CAMPAIGNS_ENABLED`. Página pública `/privacy/email-marketing` está no ar e mostra corretamente "bloqueado para campanhas de clientes".

**Único próximo passo possível para IA:** verificar se chegou resposta do Resend (confirmando primeiro qual caixa de e-mail está realmente conectada), e preparar (nunca enviar sozinho) um follow-up se o tempo decorrido justificar. Tudo o resto depende de terceiro (Resend) ou de humano (aprovação jurídica, permissão de conteúdo na Nuvemshop).

---

## Achados de ferramenta acumulados (não repita a investigação)

1. **Hook do RTK (Rust Token Killer) reescreve comandos Bash silenciosamente e às vezes trava/corrompe saída** — já visto com `npm run lint`, `npm run test`, `gcloud run services describe --format=json`, e até `git diff --stat`. Sintoma: saída vazia por muito tempo, ou números que mudam entre chamadas idênticas. **Sempre que precisar de um número exato para um relatório, contorne com `rtk proxy <comando>` ou invoque o binário direto** (`./node_modules/.bin/eslint`, `node_modules/.bin/vitest run ...`). Ver memória `feedback_rtk_lint_hook_unreliable`.
2. **`$!` do Bash/MSYS e o PID de `Start-Process` do PowerShell não correspondem de forma confiável ao PID real do Windows** para processos nativos. O único método consistente: iniciar o processo, depois `netstat -ano | grep ":<porta> .*LISTENING"` pra achar o PID real, e usar esse PID pra tudo (registro e `taskkill //F //PID <exato>`).
3. **Nunca `taskkill /IM <nome>`** — mata processos de outras sessões paralelas na mesma máquina (aconteceu uma vez nesta sessão, matou o dev server de outro projeto). Sempre `tasklist //FI "PID eq <exato>"` pra confirmar antes de matar, sempre por PID.
4. **`/tmp/...` do Bash tool não é o mesmo `/tmp` que o Node enxerga no Windows** (`readFileSync('/tmp/x')` do Node dá ENOENT, resolve pra `C:\tmp`). Sempre usar o path absoluto Windows do scratchpad da sessão para arquivos que Node vai ler.
5. **Vitest + `beforeEach(() => mock.mockReset())` + um `mockImplementation` que rejeita no mesmo teste** pode derrubar o worker do Vitest (crash) ou produzir uma falha de teste sem nenhuma asserção reprovando (unhandled rejection mal atribuída). Se cada teste já configura seu próprio mock, **não use `mockReset()` no `beforeEach`** — foi a causa raiz confirmada nesta rodada, não um problema do React Query nem do jsdom.
6. **`find` dentro do Git Bash é o GNU find (busca em arquivos), não o `find.exe` do Windows (busca em texto)** — `| find /c "texto"` não funciona como no cmd.exe.
7. **Segredos:** sempre buscar do Secret Manager direto numa variável de shell não-ecoada (`$secret = & gcloud secrets versions access ...` em PowerShell, sem imprimir). Para autenticar um browser de teste sem nunca digitar/expor o valor real numa chamada de ferramenta: escrever uma página HTML efêmera na MESMA origem (`frontend/public/__seed.html`, nunca commitada) que só faz `sessionStorage.setItem(...)` e redireciona — apagar o arquivo ao final.

## Regras de segurança acumuladas (todo o projeto, não só uma fase)

- Nunca imprimir/logar/commitar: `DATABASE_URL`, `DIRECT_URL`, qualquer secret do Secret Manager, tokens, `EMAIL_HASH_PEPPER`.
- Nunca marcar um gate jurídico (`EMAIL_TRANSFER_MECHANISM_APPROVED`, `EMAIL_LEGAL_REVIEW_APPROVED`) como `true` sem documento verificável + decisão humana registrada.
- Nunca fazer deploy/cutover sem autorização explícita nova. `gcp-build` continua sem incluir o build do frontend React de propósito — `/crm-next` não é deployável ainda (proposta documentada no `REACT_MIGRATION_BLUEPRINT`, não aplicada).
- Nunca mexer em `/crm` ou `/crm-v2` durante a migração React — só ler para inventariar.
- Sempre confirmar `git status`/branch/HEAD antes de editar, dado o número de worktrees paralelos.

## Se o usuário disser "continue"

Pergunte (ou infira do contexto mais recente) qual dos dois workstreams — eles são independentes e não devem se misturar numa mesma sessão sem necessidade. Para o Workstream 1, o próximo bloco é Mensagens + Conversas em `feat/central-react`. Para o Workstream 2, o próximo passo é só verificar se há resposta do Resend (confirmando a caixa de e-mail certa primeiro) — não há mais nada de técnico a fazer ali.
