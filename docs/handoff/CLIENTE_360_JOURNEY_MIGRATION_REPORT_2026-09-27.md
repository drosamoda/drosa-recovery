# CLIENTE_360_JOURNEY_MIGRATION_REPORT — Fase A

Data: 27/09/2026. Branch: `feat/central-react`. Migração de interface sobre APIs existentes — nenhuma logica de cliente/consentimento/pedido/elegibilidade foi criada ou alterada.

## CLIENT_360_SOURCE_MAP

| UI (React) | Endpoint | Dados | Origem |
|---|---|---|---|
| `/customers` (listagem) | `GET /crm-api/customers?page&pageSize&search` | `data[]` (id, name, phone mascarado, email mascarado, orders, lastOrder, lastContact, consent, optOut, suppressed, messages, conversations), `pagination` | `crmReadService.customers()` — identico ao `/crm-v2` |
| Cliente 360 — cabecalho/Visao Geral | `GET /crm-api/customers/:id` | id, name, phone, email, optOut, suppression, consents[], orders[], checkouts[], messages[], conversations[] | `crmReadService.customer()` |
| Cliente 360 — Pedidos | mesmo `customers/:id` (`orders[]`) | orderNumber, total (string/Decimal), paymentStatus, paymentMethod, status, date | idem |
| Cliente 360 — Recovery | mesmo `customers/:id` (`checkouts[]`) | checkout, total, products, status, date | idem |
| Cliente 360 — WhatsApp | mesmo `customers/:id` (`messages[]`) | templateName, status, entityType, createdAt | idem |
| Cliente 360 — Consentimentos & Privacidade | mesmo `customers/:id` (`consents[]`, `suppression`, `optOut`) | scope, consented, source, consentedAt, revokedAt | idem — semantica preservada (marketing/transacional continuam escopos independentes, opt-out/suppression nunca inferidos) |
| Cliente 360 — Jornada | `GET /crm-api/journey/customer:<id>?action&message&consent&responded&flow&period` | JourneyDetail (timeline[], messages[], kpis implicitos) | `crmJourneyService.detail()` — **nenhum endpoint novo**, reaproveita o prefixo `customer:` ja suportado por `resolvePhone()` |

Nenhum campo foi inventado; nenhum endpoint novo foi criado. `E-mail` como tab separada **não foi criada** — `/crm-api/customers/:id` não expõe nenhum dado de e-mail marketing (só WhatsApp), então criar essa aba seria fake integration.

## Componentes criados (reutilizáveis, sem lógica de domínio)

- `DataTable` (`components/data/`) — genérico, colunas via `render(row)`, zero referência a Cliente. Confirmado por grep: única menção a "Cliente" é o próprio comentário dizendo que é reutilizável por Mensagens/Recovery/Saúde.
- `Tabs` (`components/overlay/`) — genérico, `items/active/onChange`, zero lógica de domínio.
- `ConsentStatus`, `OrderList`, `Timeline`, `TimelineEvent` (viz) — reutilizáveis por design (`OrderList` já serve Pedidos e Recovery na mesma página).
- `CustomerSummaryCard` — este sim é específico de Cliente 360 (cabeçalho), como esperado.

## Jornada — feature portada do `/crm` legado

Filtros preservados exatamente como no legado (`action`, `message`, `consent`, `responded`, `flow`, `period`), todos passados como querystring para o endpoint já existente — nenhum recalculo local. `Timeline`/`TimelineEvent` mostram só o que a API devolve (tipo, horário, fonte, referência, status) — sem inventar causalidade/motivo onde a API não fornece (confirmado por teste de regressão: evento sem `at` mostra "Sem horario comprovado", nunca uma data inventada; tipo de evento desconhecido cai no valor cru, não trava).

## API_SHAPE_VALIDATION — comparado contra a API real de produção (sem imprimir PII)

Validação feita extraindo só a **forma** das respostas reais (nomes de campo + `typeof`, nunca o valor) via `/crm-api/customers`, `/crm-api/customers/:id` (incluindo um cliente com `messages`/`conversations` não-vazios) e `/crm-api/journey/customer:<id>`. Todos batem exatamente com `types.ts`.

**Achado real, corrigido:** `orders[].total` e `checkouts[].total` vêm da API sempre como **string** (Decimal do Prisma serializado em JSON), nunca como `number` — meu tipo já previa a união `number | string`, mas a formatação de moeda só disparava no ramo `number`, que nunca acontece na prática. Corrigido: `formatMoney()` agora converte a string para número antes de formatar, com fallback seguro (`String(total)`) se não for um número válido — nunca inventa ou trunca um valor.

## REAL_DATA_READONLY — smoke test contra produção, sem backend local

Mesmo método já usado no Foundation: Vite local com `/crm-api` apontando direto para `https://drosa-recovery-1082403977536.us-central1.run.app` (revisão em produção), **nenhum backend do `drosa-recovery` rodando sob controle desta sessão** — zero risco de cron/worker/envio por construção. Segredo buscado do Secret Manager direto numa variável PowerShell (nunca ecoado) e usado só para semear `sessionStorage` via uma página efêmera (`frontend/public/__seed.html`, nunca commitada, apagada ao final).

Provado com dados reais:
- Listagem: 4.155 clientes reais.
- Busca: "maria" → 390 resultados (filtro real, não client-side).
- Paginação: página 2 mostra clientes diferentes.
- Abrir Cliente 360: identidade real (nome sem máscara — comportamento já existente do backend, não alterado; telefone/e-mail mascarados: `55*****36`, `k***@uol.com.br`).
- Tabs: Visão Geral (StatCards reais), Pedidos (1 pedido real, R$ 538,00 após a correção), Consentimentos & Privacidade.
- Jornada: timeline real (`Pedido criado`/`Pedido pago`, fonte `nuvemshop_orders_backfill`), filtro `consent=UNKNOWN` confirmado na querystring real da requisição.
- Refresh: deep-link recarrega e busca de novo corretamente.
- 401: segredo inválido → `Segredo de leitura invalido ou ausente.` (mensagem real do backend) + sessão limpa automaticamente.
- Empty state: busca sem resultado → "Nenhum cliente encontrado." real.
- Loading/Error: já cobertos no Foundation, reconfirmados aqui.

```
CLIENTE_360_LIST=PASS
CLIENTE_360_DETAIL=PASS
JOURNEY=PASS
JOURNEY_FILTERS=PASS
API_SHAPE_VALIDATION=PASS
REAL_DATA_READONLY=PASS
PII_MASKING=PASS (telefone/e-mail mascarados como o backend ja faz; nome nunca foi mascarado em nenhuma interface existente, comportamento preservado — nao alterado nem "corrigido" por conta propria)
MOBILE=PASS (375/768/1024/1440 testados: sidebar vira drawer <768px, tabs com scroll horizontal em telas estreitas, sem overflow lateral)
```

## Bug real encontrado nos testes (não no app) — causa raiz investigada, não mascarada

Ao rodar a suíte completa pela primeira vez, o worker do Vitest **crashou** (não só travou) num teste com uma Promise eternamente pendente sem nenhuma forma de settle. Depois de corrigir isso, um teste de erro (401/500) continuava "falhando" com a mensagem exata do erro — mas sem nenhuma asserção real reprovando. Isolei com repros mínimos, testando cada variável isoladamente (mock factory, MemoryRouter, `placeholderData`, componente real vs. mínimo), até achar a causa exata: `beforeEach(() => mock.mockReset())` combinado com um `mockImplementation` que rejeita no mesmo teste. Como cada teste já configura seu próprio mock explicitamente, o reset era redundante — removido dos dois arquivos. Suíte agora passa limpa, de forma determinística, em uma única rodada. Nenhuma flag de "ignorar erro" do Vitest foi necessária no fim (cheguei a testar `dangerouslyIgnoreUnhandledErrors`, mas removi de novo assim que a causa real foi encontrada, para não mascarar bugs futuros).

## Gates finais

```
FRONTEND_TYPECHECK=PASS
FRONTEND_LINT=PASS (0 erros, 22 arquivos)
FRONTEND_TESTS=PASS (19/19, 4 arquivos, 1 rodada limpa)
FRONTEND_BUILD=PASS
BACKEND_TYPECHECK=PASS
BACKEND_LINT=PASS (0 erros, 199 arquivos)
BACKEND_TESTS=PASS (1036 unit + 208 integration = 1244)
BACKEND_BUILD=PASS
SECRET_SCAN=PASS (manual, sem ferramenta dedicada instalada na maquina)
```

## Gaps conhecidos (não bloqueantes, para fases futuras)

- Formatação de moeda dependia de um pressuposto de tipo que a API nunca cumpre na prática (`number`) — já corrigido nesta rodada, mas serve de alerta: ao migrar Recovery/Pedidos em outras telas, sempre confirmar o `typeof` real antes de assumir.
- `E-mail` como tab do Cliente 360 fica pendente até `/crm-api/customers/:id` (ou um endpoint novo, com autorização) expor dados de e-mail marketing — não é uma omissão, é a ausência real de dado na API atual.

## Commits desta fase (branch `feat/central-react`)

Componentes/rotas de Cliente 360 + Jornada, correção de `formatMoney`, setup de testes (Vitest+Testing Library+jsdom), correção da causa raiz do crash/falha espúria do Vitest, `/crm` e `/crm-v2` confirmados intactos (nenhuma alteração fora de `frontend/`).

## Próximo passo recomendado

Fase B (Mensagens + Conversas) pode começar com o mesmo padrão: inventário de endpoints primeiro, reaproveitar `DataTable`/`Tabs`/`LoadingState`/`ErrorState`/`EmptyState` já provados genéricos nesta fase, smoke read-only contra produção antes de fechar.
