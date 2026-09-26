# D'Rosa Central Operacional — REACT_MIGRATION_BLUEPRINT

Data: 26/09/2026. ADR aprovada pelo usuário: **React + Vite, dentro do mesmo repo `drosamoda/drosa-recovery`, build estático servido pelo mesmo Express/Cloud Run.** Nada de Next.js, nada de novo serviço de produção. Este documento é a entrega solicitada antes de qualquer código — depois dele, a única implementação autorizada nesta rodada é **FOUNDATION + DASHBOARD PILOT**, sem substituir produção.

## Correção sobre o BI dashboard

O `CONSOLIDATION_AUDIT_CENTRAL_OPERACIONAL_2026-09-26.md` afirmou que `drosa-recovery-bi-dashboard-v0` não tinha `.git`. **Isso está desatualizado.** Verifiquei agora: `C:\Users\peter\drosa-recovery-bi-dashboard-v0` tem remote `origin` apontando para `https://github.com/drosamoda/drosa-recovery-bi-dashboard.git`, branch `main`, HEAD local e remoto batendo em `2eed56366b3dccb30ebdb0ef48595dff92852cc5` (confirmado via `git ls-remote origin HEAD`, não só leitura local). **Qualquer consulta futura ao código do BI deve clonar/ler esse repositório GitHub, nunca copiar manualmente do checkout v0.**

## 1. Estrutura de pastas proposta

```
drosa-recovery/                      (repo atual, inalterado)
├── src/                             (backend Express — inalterado)
├── prisma/                          (inalterado)
├── public/
│   ├── crm/                         (legado — inalterado, fica de rollback)
│   ├── crm-v2/                      (legado vanilla — inalterado até o cutover)
│   └── inbox/                       (inalterado)
├── frontend/                        (NOVO — projeto React+Vite, irmão de src/)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── routes/                  (uma pasta por módulo do NAV)
│   │   │   ├── dashboard/
│   │   │   ├── customers/           (Cliente 360 + Jornada)
│   │   │   ├── messages/
│   │   │   ├── conversations/
│   │   │   ├── recovery/            (checkouts/pix/boleto/remarketing)
│   │   │   ├── campaigns/           (Campanhas & IA + E-mail)
│   │   │   ├── bi/                  (BI & Inteligência)
│   │   │   └── health/
│   │   ├── components/
│   │   │   ├── shell/               (AppShell, Sidebar, Topbar, PageHeader, SectionHeader)
│   │   │   ├── data/                (StatCard, TrendCard, DataTable, FilterBar, SearchInput)
│   │   │   ├── feedback/            (AlertCard, HealthCard, StatusBadge, EmptyState, ErrorState, LoadingState)
│   │   │   ├── overlay/             (Drawer, Modal, Tabs)
│   │   │   └── viz/                 (Timeline, Funnel, MetricTooltip)
│   │   ├── lib/
│   │   │   ├── api.ts               (camada tipada para /crm-api/*, substitui api()/apiPost() do app.js atual)
│   │   │   ├── auth.ts              (estado de sessão — ver seção 6)
│   │   │   └── types.ts             (tipos compartilhados das respostas de /crm-api)
│   │   ├── design-tokens.css        (cores, espaçamento, tipografia — ver ADR de identidade visual)
│   │   └── router.tsx               (React Router)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json                (próprio, NÃO estende o tsconfig do backend)
│   ├── tailwind.config.ts
│   └── package.json                 (dependências do frontend isoladas do backend)
├── package.json                     (backend — ganha só um script novo, ver seção 3)
└── tsconfig.json                    (backend — inalterado; rootDir=./src já exclui frontend/)
```

`frontend/` fica fora de `src/`, então o `tsconfig.json`/`tsconfig.build.json` do backend (que já usa `rootDir: "./src"`, `include: ["src/**/*"]`) não precisa de nenhuma mudança e não vai tentar compilar o frontend.

## 2. Dependências propostas (frontend/package.json, isolado)

```
react, react-dom, react-router-dom
typescript, vite, @vitejs/plugin-react
tailwindcss, postcss, autoprefixer
@tanstack/react-query          (cache/estado de chamadas a /crm-api, evita reimplementar o que app.js já faz manualmente com AbortController)
recharts ou visx                (gráficos — decidir na Fase 3, não bloqueia o piloto do Dashboard)
```

`shadcn/ui`: avaliar caso a caso por componente (conforme pedido), começando pelos primitivos (Button, Input, Tabs, Dialog) e nunca adotando o pacote inteiro de uma vez.

Sem framework de servidor (sem Next.js, sem Remix) — é uma SPA pura buildada para arquivos estáticos.

## 3. Estratégia de build e como o Express serve o resultado

- `frontend/` tem seu próprio `package.json`/`node_modules`, buildado com `vite build`, saída em `frontend/dist/`.
- Backend ganha um script novo em `package.json` (raiz): `"build:frontend": "npm --prefix frontend run build"`, e o `gcp-build` passa a rodar os dois builds (backend + frontend) antes do deploy.
- Em `src/index.ts`, ao lado das linhas já existentes que servem `public/crm-v2` (`express.static(...)` + `app.get('/crm-v2', ...)`), adiciona-se **uma rota nova e não linkada publicamente** durante o desenvolvimento: `app.use('/crm-next-assets', express.static(path.join(process.cwd(), 'frontend', 'dist')))` + `app.get('/crm-next', (_req,res) => res.sendFile(path.join(process.cwd(),'frontend','dist','index.html')))`.
- **`/crm-v2` continua servindo o vanilla JS atual até o cutover explícito.** O React só assume a rota `/crm-v2` no passo 16 do plano do usuário (após paridade comprovada) — nunca antes.
- `.dockerignore`/build do Cloud Run: garantir que `frontend/node_modules` não vá para a imagem final (só `frontend/dist`), do mesmo jeito que hoje só `dist/` do backend vai (multi-stage build, se o Dockerfile atual já não fizer isso — verificar no build atual antes de mexer).

## 4. Estratégia de routing

- **React Router** (`createBrowserRouter` ou `<BrowserRouter>`) client-side, espelhando o NAV atual do v2: `/crm-next/dashboard`, `/crm-next/customers`, `/crm-next/customers/:id` (Cliente 360, com tab de Jornada), `/crm-next/messages`, `/crm-next/conversations`, `/crm-next/recovery` (com sub-rotas checkouts/pix/boleto/remarketing), `/crm-next/campaigns` (com sub-rotas oportunidades/e-mail/campanhas/automações/aprendizados), `/crm-next/bi`, `/crm-next/health`.
- Como é SPA servida por Express, toda rota sob `/crm-next/*` que não bater em um asset estático precisa cair no `index.html` (fallback do SPA) — adicionar isso como uma rota Express específica, **sem afetar o catch-all 404 genérico que já existe no fim de `index.ts`** (`app.use((_req, res) => {...})`), ou seja, o fallback do SPA precisa vir ANTES desse catch-all e só cobrir o prefixo `/crm-next`.
- No cutover (passo 16), troca-se `/crm-next` por `/crm-v2` nesse fallback e nos assets — não se cria uma quarta URL pública permanente, como pedido.

## 5. Estratégia de acesso a `/crm-api/*`

- `frontend/src/lib/api.ts` centraliza `fetch()` com o header `x-crm-read-secret`, substituindo as funções `api()`/`apiPost()`/`apiPostAdmin()` do `app.js` atual — mesmo contrato HTTP, mesmos endpoints, zero mudança no backend nesta fase.
- Tipos de resposta (`types.ts`) derivados lendo os handlers em `src/routes/crm.routes.ts`, `aiCampaignsRoutes`, `emailIntelligenceRoutes` — **não inventar shape**, extrair do código real.
- `@tanstack/react-query` para cache/retry/invalidation, com `queryKey` por endpoint+params, substituindo o padrão manual de `AbortController` que `app.js` usa hoje.

## 6. Estratégia de auth (documentar estado atual antes de propor o alvo, conforme pedido)

### AUTH_CURRENT_STATE
- `/crm-v2` (vanilla): usuário digita `x-crm-read-secret` num modal; fica em `sessionStorage`; ações administrativas exigem digitar `x-admin-secret` de novo a cada chamada (nunca persistido).
- BI dashboard (Next.js, app separado): `DASHBOARD_AUTH_USERS` (lista de e-mail+hash bcrypt) + rota `/api/auth/login`, cookie de sessão próprio daquele app Vercel — **mecanismo totalmente diferente, banco de usuários diferente, domínio diferente.**
- São dois sistemas de autenticação incompatíveis hoje. Nenhum dos dois usa cookie httpOnly com CSRF; o do v2 é essencialmente uma senha compartilhada guardada em memória do navegador.

### AUTH_TARGET_STATE (proposta, não implementar nesta rodada)
- Sessão via cookie `httpOnly` + `Secure` + `SameSite=Strict`, emitida por um endpoint novo no backend `drosa-recovery` (ex.: `POST /crm-api/auth/login`), substituindo o header `x-crm-read-secret` digitado toda sessão.
- Proteção CSRF (token de sync ou `SameSite=Strict` + verificação de origem) nas rotas de mutação (`crm-api/ai/campaigns`, aprovações).
- Roles mínimas: `read-only` (equivalente a `x-crm-read-secret` hoje) e `admin` (equivalente a `x-admin-secret` hoje) — sem inventar um sistema de permissões granular maior que o que já existe.
- Rate limit no endpoint de login.
- Logout explícito (invalida a sessão no servidor, não só limpa `sessionStorage`).
- **Isso é trabalho de uma fase própria (passo 14 da ordem aprovada) — o piloto do Dashboard desta rodada continua usando `x-crm-read-secret` exatamente como hoje, só trocando a UI.**

## 7. Plano de migração por tela (ordem já aprovada pelo usuário)

1. Dashboard (piloto desta rodada)
2. Cliente 360 + Jornada (nova, componente React, reaproveitando `/crm-api/journey`)
3. Mensagens/Conversas
4. Recovery
5. Campanhas & IA/E-mail
6. Saúde
7. BI & Inteligência (novo módulo, embed Metabase via endpoint server-side novo com allowlist — ver seção 8)

## 8. BI & Inteligência — nota técnica

- Migrar para o backend `drosa-recovery` um endpoint novo, ex. `GET /crm-api/bi/embed-url?dashboard=executive`, que gera a URL assinada do Metabase **server-side**, com um `allowlist` fixo de dashboards permitidos (`executive`, `recovery`, `messages`, `consents`, `orders`, `webhooks-health` → IDs 2/6/3/5/7/8 do Metabase, conforme o handoff do BI). **O browser nunca escolhe um ID de dashboard arbitrário** — só os 6 nomes da allowlist.
- Isso significa mover a lógica hoje em `app/api/metabase/embed-url/route.ts` (repo `drosamoda/drosa-recovery-bi-dashboard`) para dentro de `src/routes/crm.routes.ts` (ou um arquivo novo `biEmbed.routes.ts`) do backend `drosa-recovery`, reaproveitando `METABASE_SITE_URL`/`METABASE_SECRET_KEY` (hoje só no Vercel do BI — precisam ser replicados/movidos para o Secret Manager/env do Cloud Run do `drosa-recovery`).
- Fora de escopo desta rodada — entra no passo 13 da ordem aprovada.

## 9. Estratégia de rollback

- `/crm-v2` (vanilla) e `/crm` (legado) permanecem intocados e publicamente acessíveis durante toda a migração — nenhum arquivo em `public/crm` ou `public/crm-v2` é removido antes do cutover.
- O novo React fica em `/crm-next` (não linkado em nenhum menu, não anunciado) até paridade comprovada.
- Cutover = trocar o que a rota `/crm-v2` serve (de `public/crm-v2/index.html` para `frontend/dist/index.html`) — reversível instantaneamente revertendo esse único ponto em `src/index.ts`, já que os arquivos antigos continuam no repo.
- Nenhum banco de dados, migration ou flag de envio é tocado por este trabalho — rollback é puramente de arquivo estático servido.

## 10. Riscos

- Dois `package.json`/`node_modules` no mesmo repo (backend + `frontend/`) exige atenção no Dockerfile/`gcp-build` para não inflar a imagem de produção com `frontend/node_modules` — mapear o Dockerfile atual antes do primeiro deploy real do frontend.
- `@tanstack/react-query` + `x-crm-read-secret` em `sessionStorage`: replicar exatamente o mesmo tratamento de 401 que `app.js` já tem (limpar sessão e voltar ao modal de login), senão a UX piora na migração.
- BI embed (seção 8) exige mover segredos (`METABASE_SECRET_KEY`) entre dois projetos GCP diferentes — Vercel do BI hoje, Secret Manager do `drosa-recovery` depois. Isso é uma ação sensível de secret, não fazer "de passagem" dentro do piloto do Dashboard.
- Nenhum destes riscos bloqueia o piloto do Dashboard (itens 1-4 abaixo) — todos pertencem a fases posteriores.

## 11. Arquivos que seriam criados/alterados nesta rodada (FOUNDATION + DASHBOARD PILOT)

**Criados (tudo novo, nada de produção tocado):**
- `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tailwind.config.ts`, `frontend/index.html`
- `frontend/src/main.tsx`, `App.tsx`, `router.tsx`, `design-tokens.css`
- `frontend/src/lib/api.ts`, `auth.ts`
- `frontend/src/components/shell/{AppShell,Sidebar,Topbar,PageHeader}.tsx`
- `frontend/src/components/data/{StatCard,DataTable}.tsx`
- `frontend/src/components/feedback/{StatusBadge,EmptyState,ErrorState,LoadingState}.tsx`
- `frontend/src/routes/dashboard/DashboardPage.tsx` (única tela funcional desta rodada)

**Alterados (backend, mínimo, reversível):**
- `src/index.ts` — adicionar as 2 linhas de `express.static`/`sendFile` para `/crm-next` (path novo, não linkado), **sem tocar nas linhas de `/crm-v2` existentes**.
- `package.json` (raiz) — script `build:frontend` novo.

Nenhum arquivo de `public/crm` ou `public/crm-v2` é alterado. Nenhuma migration, nenhuma flag, nenhum secret é tocado.

## Próximo passo desta rodada

Implementar exatamente o escopo da seção 11 (Foundation + Dashboard pilot), rodar `typecheck`/`lint`/`build` do frontend novo, subir localmente e tirar screenshot do Dashboard piloto antes de reportar — **sem publicar em `/crm-v2` e sem propor cutover.**
