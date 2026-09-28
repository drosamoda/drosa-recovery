# FOUNDATION_INTEGRATION_REPORT — D'Rosa Central Operacional (React+Vite)

Data: 26-27/09/2026. Branch: `feat/central-react` (a partir de `47f36db`, HEAD atual desta rodada será commitada em seguida). Não avançar para Cliente 360 + Jornada sem revisar este relatório.

## PROCESS_ISOLATION_INCIDENT=YES

- **Comando executado:** `taskkill //F //IM node.exe` (Bash), tentando encerrar meu próprio servidor de dev.
- **Impacto observado:** matou **todos** os 10 processos `node.exe` da máquina, incluindo o dev server `cfo-web` (porta 3000, projeto/sessão diferente) e possivelmente outros processos Node de outras sessões paralelas ativas no momento (esta máquina tinha, na época, ~7+ sessões Claude Code paralelas confirmadas via `ListAgents`).
- **Causa:** `taskkill /IM` mata por nome de imagem, sistema inteiro — não é escopado ao processo/sessão de quem chama. Eu precisava matar só o meu processo, deveria ter usado o PID exato.
- **Prevenção adotada a partir deste ponto:** todo processo iniciado nesta sessão passou a ter **PID + porta + comando registrados imediatamente**, e todo encerramento usou `taskkill //F //PID <exato>`, com `tasklist //FI "PID eq <exato>"` confirmando a identidade do processo **antes** de matar. `taskkill /IM`, `killall node`, `pkill node` e qualquer variante por nome não foram usados de novo nesta sessão.
- **Nota técnica adicional descoberta:** `$!` do Bash/MSYS e o PID retornado por `Start-Process` do PowerShell **não correspondem de forma confiável ao PID real do Windows** para processos nativos spawnados a partir desses shells (em um caso, `Start-Process -FilePath node ...` devolveu o PID de um processo que nem existia mais poucos segundos depois; em outro, o PID retornado era do `cmd.exe` intermediário, não do `node.exe` real). O método que funcionou de forma consistente foi: iniciar o processo, depois `netstat -ano | grep ":<porta> .*LISTENING"` para achar o PID real dono da porta, e usar **esse** PID para tudo (registro e encerramento).

## Gates de backend — separando staleness de regressão

Esta branch (`feat/central-react`) foi checada isoladamente num worktree cujo `node_modules` estava desatualizado em relação ao `main` mais recente (faltava o pacote `resend`, cliente Prisma sem os models de e-mail). Depois de `npm install` (que já dispara `postinstall: prisma generate`):

```
FRONTEND_TYPECHECK=PASS
FRONTEND_BUILD=PASS
FRONTEND_TESTS=PASS (7/7, novos — ver seção "Testes da camada crm-api")
BACKEND_TYPECHECK=PASS
BACKEND_BUILD=PASS
BACKEND_TESTS=PASS (71+23 arquivos, 1036+208 testes)
BACKEND_LINT=PASS (0 erros, 199 arquivos — via `./node_modules/.bin/eslint` direto; o wrapper do RTK segue não confiável para esse comando, ver memória `feedback_rtk_lint_hook_unreliable`)
SECRET_SCAN=PASS (manual — sem `gitleaks`/`trufflehog` instalados na máquina; scan por padrão em todo o diff desta branch vs `dd58231`, zero ocorrências de chave/senha/connection string além de nomes de variável)
WORKTREE_STATUS=CLEAN (branch `feat/central-react`, sem alterações não commitadas fora do que está descrito neste relatório)
```

**Conclusão explícita:** a suspeita levantada na rodada anterior — de que as 10 linhas aditivas em `src/index.ts` (`/crm-next`) poderiam ter causado os erros de typecheck do backend — está **descartada**. A causa real era `WORKTREE_DEPENDENCY_STALENESS` (node_modules/Prisma client desatualizados neste worktree específico), não uma regressão de código. Confirmado rodando o mesmo typecheck/build ANTES de tocar em qualquer linha nova nesta rodada.

## Smoke test ponta a ponta — o que foi provado e o que ficou bloqueado

Backend real (`ts-node-dev`, não mockado) + frontend Vite real, ambos locais, processos com PID controlado (ver incidente acima).

**Provado, funcionando corretamente:**
- ConnectGate → digitar segredo → `sessionStorage` → shell libera.
- Autenticação real: header `x-crm-read-secret` chega no backend real e é validado pelo mesmo `crmAuth` de produção (não simulado).
- Chamada real a `/crm-api/dashboard?period=today` contra o backend rodando localmente.
- `LoadingState` durante a busca.
- `ErrorState` com a mensagem exata do erro real do servidor, botão "Tentar de novo".
- Retry manual (clique em "Tentar de novo") dispara nova busca e resolve corretamente.
- Refresh (F5/reload de página): sessão persiste via `sessionStorage`, refaz a busca sozinho, sem precisar reconectar.
- `/crm` e `/crm-v2` confirmados intactos: `git diff 47f36db --stat` não toca nenhum arquivo em `public/`, `src/index.ts` ou `package.json` (raiz) nesta rodada — só `frontend/`.

**Bloqueado — dados reais nunca chegaram a renderizar:**
```
DB_CONNECTIVITY=BLOCKED
```
O backend local não conseguiu conectar a `aws-1-us-west-2.pooler.supabase.com` (erro Prisma: "Can't reach database server"). Isolei a causa com cuidado antes de concluir:
- `Test-NetConnection` (PowerShell) confirma TCP aberto e respondendo nas portas 6543 e 5432 desse host, a partir desta mesma máquina — **não é bloqueio de rede/firewall/sandbox**.
- Reproduzi o mesmo erro lançando o backend por dois métodos diferentes (processo em background via Bash e via `Start-Process` do PowerShell) — **não é uma restrição específica do sandbox do Bash tool**.
- Portanto: é uma credencial/configuração (`DATABASE_URL`/`DIRECT_URL` no `.env` deste worktree) desatualizada ou inválida para este projeto Supabase específico neste momento — **não tentei ler, adivinhar ou alterar o valor** (meramente diagnostiquei por eliminação, sem nunca imprimir a connection string).
- **Consequência:** não foi possível validar `dados reais → cards reais` com números de verdade. O Dashboard piloto está provado correto e íntegro para os estados de loading/erro/retry/refresh, mas o caminho de sucesso com dados reais (o `data && <StatCard>...</StatCard>` de `DashboardPage.tsx`) **não foi exercitado nesta rodada** — continua sendo só uma inferência de que o código está certo, não uma prova.
- **Ação necessária para destravar:** alguém com acesso ao `.env`/Secret Manager precisa confirmar/corrigir `DATABASE_URL`/`DIRECT_URL` para este worktree local (mesmo padrão de sempre: variável de usuário do Windows ou `.env` local, nunca colado no chat).

## Bugs reais encontrados e corrigidos nesta rodada (achados de QA genuínos, não teatro)

1. **Proxy do Vite apontava para porta errada.** `vite.config.ts` assumia `localhost:8080`; o backend real usa `PORT` do `.env` (default 3000, testado aqui em 3999 por conflito de porta com outro projeto). Corrigido para usar `VITE_BACKEND_PORT` (env var), default 3000.
2. **`isLoading` do react-query v5 deixa uma janela de UI em branco.** Entre uma falha e a próxima tentativa automática, `isLoading` (= `isPending && isFetching`) fica `false` sem ainda haver `error` nem `data` — a tela ficava sem nenhum dos três blocos condicionais renderizado (branco). Corrigido usando `isPending` em vez de `isLoading`.
3. **Retry automático do react-query travava indefinidamente (`fetchStatus: 'paused'`).** Mesmo com `networkMode: 'always'` explicitamente configurado, o retry entre a 1ª falha e a 2ª tentativa nunca prosseguia neste ambiente (chegou a ficar 40+ segundos preso, confirmado via `queryClient.getQueryState()`). Não foi possível confirmar a causa raiz exata sem React Query Devtools (não instalado). **Decisão pragmática, não só contorno:** desabilitei o retry automático (`retry: false`) e mantive o botão manual "Tentar de novo" que já existia — mais previsível para um backend que pode estar genuinamente fora do ar, e elimina a dependência de um mecanismo que se mostrou frágil neste ambiente. Recomendo não reabilitar retry automático em telas futuras sem antes instrumentar com React Query Devtools para entender a causa raiz.
4. **JSON de resposta inválido não virava `ApiError`.** Se `response.json()` falhar (ex.: servidor devolve HTML de erro com `Content-Type` incorreto em uma resposta 2xx), o erro não era um `ApiError` consistente. Corrigido: agora sempre lança `ApiError('Resposta invalida do servidor.', status)`.

## REAL_DATA_READONLY_VALIDATION (rodada 2, 27/09)

Seguindo a melhor opção indicada: **nenhum backend local foi iniciado**. O frontend Vite local (`VITE_BACKEND_URL`) apontou o proxy de `/crm-api` direto para a API de produção já existente (`https://drosa-recovery-1082403977536.us-central1.run.app`), a mesma revisão `drosa-recovery-email-compliance-v1` já auditada. Isso elimina por completo o risco de cron/worker/envio: nenhum processo do `drosa-recovery` rodou sob meu controle em momento algum desta validação — a chamada foi atendida pela instância de produção já em execução, exatamente como aconteceria se qualquer operador abrisse o dashboard real.

**Manuseio do segredo:** `drosa-crm-read-secret` foi buscado do Secret Manager dentro de uma única sessão PowerShell não-interativa (`$secret = & gcloud secrets versions access ...`), sem nunca aparecer em stdout/stderr. Para autenticar o browser sem eu precisar digitar/ver o valor em nenhuma chamada de ferramenta, o mesmo script gravou um arquivo HTML efêmero (`frontend/public/__seed.html`, nunca commitado) que só faz `sessionStorage.setItem('crmNextSecret', '<valor>')` e redireciona para `/crm-next/` — servido pelo próprio Vite (mesma origem, necessário para o `sessionStorage` valer). Naveguei o browser até esse arquivo, ele preencheu a sessão sozinho, e o dashboard carregou autenticado sem eu jamais ter visto o valor do secret. Ao final: `sessionStorage.clear()`, processo do Vite encerrado pelo PID exato, e o arquivo seed apagado do disco (confirmei via `git status` — nunca esteve no repositório).

**Evidência:**
```
REAL_DATA_DASHBOARD=PASS
```
Cards renderizados com números reais de produção (período "hoje"): Mensagens criadas=6, Enviadas=0, Clientes contatados=0, Mensagens recebidas=0, Conversas recebidas=0, Carrinhos abandonados=0, Carrinhos convertidos=2, Pix pendentes=0, Boletos pendentes=0. Screenshot capturado.

```
NO_WRITE_SIDE_EFFECTS=PASS
```
`read_network_requests` confirmou: o único request a `/crm-api/*` foi `GET /crm-api/dashboard?period=today → 200 OK` (mais uma tentativa abortada pelo StrictMode, também GET) — nenhum POST/PUT/PATCH/DELETE em nenhum momento. Reforçado por leitura de código já feita: `crmReadService.dashboard()` só executa `groupBy`/`count`/`findMany` com `select` — nenhuma escrita possível nesse caminho mesmo que eu quisesse.

```
NO_SEND_SIDE_EFFECTS=PASS
```
Nenhum processo do backend rodou sob meu controle — a instância que respondeu é a mesma de produção, já rodando de forma independente, com as 5 flags de envio confirmadas `false` na rodada anterior (não re-verificadas agora para não repetir uma auditoria sem gatilho novo). A validação não tocou em nenhuma rota de `/webhooks`, `/jobs`, `/crm-api/ai/campaigns` (write) nem qualquer endpoint de disparo.

## Sidebar responsiva — corrigida nesta rodada

Implementado exatamente como pedido: desktop (`md:` e acima) mantém a sidebar estática e sempre visível; mobile (< `md:`, ou seja < 768px) esconde a sidebar por padrão e a mostra como drawer deslizante com backdrop, acionado por um botão de menu acessível (`aria-label="Abrir menu de navegacao"`) no Topbar, visível só em mobile (`md:hidden`). O drawer fecha ao clicar no backdrop e ao clicar em qualquer item de navegação (`onClick` no `NavLink` chama `onClose`).

Testado visualmente nos 4 breakpoints pedidos:
- **375px:** sidebar escondida, botão de menu visível, conteúdo ocupa a largura toda. Drawer abre com backdrop, fecha ao clicar fora e ao navegar (confirmado via clique real e via `dispatchEvent` para eliminar qualquer dúvida de imprecisão de coordenada).
- **768px:** sidebar fixa visível, sem botão de menu — comportamento de desktop já a partir deste breakpoint (`md:` do Tailwind = 768px).
- **1024px:** igual a 768px, sidebar fixa.
- **1440px:** confirmado na rodada anterior (screenshot do smoke test com dados reais).

## Lint do frontend — adicionado nesta rodada

O frontend não tinha nenhum ESLint configurado até agora. Adicionei o setup padrão Vite+React+TS (`@typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`), rodando via `npm run lint` (script novo). Resultado, confirmado tanto pelo wrapper quanto pelo binário `./node_modules/.bin/eslint` direto (mesmo cuidado de sempre com o hook do RTK, que já se provou não confiável para saída de lint):
```
FRONTEND_LINT=PASS (0 erros, 0 warnings, 18 arquivos)
```

## Testes da camada `crm-api` (frontend)

Novo `frontend/src/lib/__tests__/api.test.ts`, Vitest, 7 testes, todos passando:
- sucesso (payload retornado corretamente);
- header `x-crm-read-secret` enviado em toda chamada;
- 401 → `ApiError` + `clearStoredSecret()` chamado;
- 403 → `ApiError` com `status` correto;
- 500 → `ApiError` com mensagem contendo o código HTTP;
- erro de rede (fetch rejeitado) → propagado corretamente;
- payload de sucesso com JSON inválido → `ApiError` (bug #4 acima, coberto por teste de regressão).

Timeout não tem teste dedicado: `api.ts` não implementa timeout próprio hoje (depende só do `AbortSignal` que o react-query passa) — não é uma lacuna de teste, é ausência de funcionalidade a decidir numa fase futura, se necessário.

## Proposta exata para produzir `frontend/dist` no deploy (documentar, não aplicar ainda)

`gcp-build` continua **inalterado** nesta rodada, por decisão explícita — `/crm-next` não é deployável ainda. Quando houver autorização para testar em preview no Cloud Run, a mudança mínima seria:

```json
"gcp-build": "npx prisma generate && npx tsc -p tsconfig.build.json && npm --prefix frontend ci && npm --prefix frontend run build"
```

Pontos a decidir **antes** de aplicar essa mudança (não decidir aqui, só documentar as perguntas):
- `npm --prefix frontend ci` exige `frontend/package-lock.json` commitado e sincronizado (já está, verificado nesta rodada).
- O buildpack do Cloud Build (`gcloud run deploy --source`, sem Dockerfile hoje) instala dependências na raiz automaticamente; não está confirmado se `frontend/node_modules` (gerado pelo `npm --prefix frontend ci` dentro do `gcp-build`) é removido da imagem final depois do build ou se permanece ocupando espaço — precisa ser testado uma vez, sem impacto em produção, antes de decidir se vale a pena introduzir um passo de limpeza (`rm -rf frontend/node_modules` no fim do `gcp-build`) ou aceitar o tamanho extra.
- Isso **não** afeta `/crm` nem `/crm-v2` de nenhuma forma — ambos continuam sendo arquivos estáticos já commitados em `public/`, sem passo de build.

## Resumo de estado — FINAL

```
FOUNDATION_INTEGRATION_REPORT=PASS

PROJECT_GATES=FRONTEND_GATES=PASS / BACKEND_GATES=PASS (apos resolver staleness, sem regressao)
FRONTEND_TYPECHECK=PASS · FRONTEND_LINT=PASS (0/0, 18 arquivos) · FRONTEND_TESTS=PASS (7/7) · FRONTEND_BUILD=PASS
BACKEND_TYPECHECK=PASS · BACKEND_LINT=PASS (0/0, 199 arquivos) · BACKEND_TESTS=PASS (1036+208) · BACKEND_BUILD=PASS
SECRET_SCAN=PASS (manual)

REAL_DATA_DASHBOARD=PASS (dados reais de producao renderizados, via proxy direto — sem backend local)
NO_WRITE_SIDE_EFFECTS=PASS
NO_SEND_SIDE_EFFECTS=PASS

UI_SMOKE_TEST=PASS (connectgate/auth/loading/error/retry/refresh/dados reais — todos os 8 itens pedidos)
CRM_LEGACY_INTACT=CONFIRMADO (git diff 47f36db --stat, zero mudanca em public/ ou index.ts alem das 10 linhas ja existentes)
API_CLIENT_TESTS=7/7 PASS
MOBILE_RESPONSIVE=CORRIGIDO (375/768/1024/1440px testados, drawer com backdrop, fecha ao navegar)
PROCESS_ISOLATION_INCIDENT=YES (detalhado acima, mitigado a partir do ponto do incidente; zero incidentes na rodada 2)
DEPLOY_READY=NAO (proposta documentada, gcp-build inalterado — decisão consciente, fora de escopo desta fundação)
```

**Recomendação:** `FOUNDATION_INTEGRATION_GATE` fechado. Liberado para avançar a Cliente 360 + Jornada. Nenhum item pendente nesta fundação — `DB_CONNECTIVITY=BLOCKED` do `.env` local deixou de ser bloqueante porque `REAL_DATA_READONLY_VALIDATION` proveu o caminho de dados reais por uma via mais segura (API de produção somente-leitura via proxy, sem backend local), que é preferível de qualquer forma para futuras validações de tela.
