# Fase I — Preview Setup + Regression (28/09/2026)

Branch `feat/central-react`. Preview: **https://drosa-central-preview-1082403977536.us-central1.run.app/crm-next/** (serviço separado; revisão `drosa-central-preview-00002-hhq`, imagem do commit `9399e83`).

## 1. INBOX_ADMIN_SECRET — PASS
- Nova versão **v3** (gerada no processo, nunca impressa). Código live não aceita dois valores → sem janela dupla; alternativa documentada executada:
  1. revisão `drosa-recovery-inbox-rot-v3` = **mesma imagem da revisão que servia** (`email-compliance-v1`) + mesmo env, só `INBOX_ADMIN_SECRET → :3`, publicada com `--no-traffic` (tag `inbox-v3`); cron interno confirmado desligado;
  2. validação na tag: v3 aceita, v2 → 401;
  3. tráfego 100% → `drosa-recovery-inbox-rot-v3`; validação no live: v3 aceita, v2 → 401, `/health` 200, `/crm-api/{health,dashboard,messages}` 200;
  4. **v2 desabilitada** no Secret Manager.
- Observado (pré-existente, não relacionado): `GET /inbox/conversations` responde **500** tanto com v2 (antes) quanto com v3 (depois) — auth passa, o handler falha. Investigar separadamente.
- **Ação humana pendente:** operador do `/inbox` precisa digitar o valor v3 (`gcloud secrets versions access 3 --secret=drosa-recovery-inbox-admin-secret`), pois o navegador guarda o antigo em `localStorage`.
- Rollback: `gcloud secrets versions enable 2 …` + `update-traffic --to-revisions drosa-recovery-email-compliance-v1=100` (só em emergência — reabre o valor comprometido).
- Nota: 27 revisões antigas referenciam `:2` e deixaram de poder iniciar (intencional: fecha as URLs com tag que aceitariam o valor vazado). `:1` segue habilitada (5 revisões antigas) — recomendado desabilitar como higiene.

## 2. Arquitetura do preview (decisão do dono)
- **Nenhuma credencial `postgres`** no preview. Módulos operacionais: **proxy server-side GET/HEAD** para `/crm-api` oficial (`src/middlewares/crmUpstreamProxy.ts`): allowlist de rotas, host fixo, segredo injetado no servidor, 405 para escrita, 401/403 do upstream → 502, timeout 25 s, log sem query.
- BI: role novo **`drosa_central_bi_reader`** (senha enviada ao Postgres só como verificador SCRAM; URL em `drosa-central-bi-db-url`). `DATABASE_URL`/`DIRECT_URL` do preview apontam para esse reader → mesmo que algum código tentasse ler tabela operacional, o banco negaria.
- `PUBLIC` **não** alterado; nenhuma mudança global de TEMP.

### Testes negativos do reader (conectado como ele)
```
SELECT bi_* ..................... PASS
SELECT operational tables ....... DENIED (permission denied)
INSERT/UPDATE/DELETE operational  DENIED (privilégio + read-only default)
TRUNCATE operational ............ DENIED
CREATE persistent table ......... DENIED
CREATE schema ................... DENIED
admin attributes ................ NONE
grants .......................... SELECT=12, non-SELECT=0
TEMP ............................ herdado de PUBLIC (decisão: não alterar); bloqueado pelo read-only default
```

## 3. Secrets e service account — PASS
Criados (valores nunca impressos): `drosa-central-session-secret` (48 bytes), `drosa-central-auth-users` (hash bcrypt do usuário **temporário** `preview-temp@drosamoda.test`), `drosa-central-preview-login` (credencial temporária; só para o dono/testes — a SA do preview **não** tem acesso), `drosa-metabase-embed-key` (**migrada** do app DB do Metabase — provada idêntica à em uso: dashboard 2 → 200 antes de qualquer mudança), `drosa-central-bi-db-url`. Proxy usa `drosa-crm-read-secret` existente.
SA **`drosa-central-preview@…`**: zero papéis no projeto; `secretAccessor` apenas nesses 5 secrets. Referências de versão explícitas (`:1`).

## 4. Metabase — PASS
`enable_embedding=true` apenas em 3, 5, 6, 7, 8 (1 e 4 intocados; 2 já estava). Token assinado: 2/3/5/6/7/8 → 200. Pela Central (preview): 6 aliases → 200, `nope`/`2` → 404, sem credencial → 401, chave nunca na resposta. Embed renderizado dentro do BI (Visão Executiva).
**Débito novo:** os KPIs *internos* dos dashboards Metabase (ex.: "Failure rate", "Mensagens hoje" com skipped) seguem a semântica do BI antigo e não foram auditados contra o dicionário.

## 5. Cloud Run client IP — PASS
Cadeia real observada (log só com contagem): sem header → 1 entrada; com N entradas forjadas → N+1 (o front-end do Google acrescenta o IP real por último) ⇒ `CENTRAL_TRUSTED_PROXY_HOPS=1` correto. 5 falhas variando o spoof → 6ª tentativa (senha correta, spoof novo ou sem header) **429**. Segundo cliente real (egress do Cloud Build), durante o bloqueio → **401** (não 429): sem bloqueio global. Limiter é por instância (max 2).

## 6. Smoke do preview — PASS
`/health`, `/crm-next/`, `/crm`, `/crm-v2` 200 · `/jobs`, `/webhooks`, `/admin`, `/inbox` 404 · `/crm-api` sem credencial 401 · 11 rotas GET via proxy 200 (`ai/learning` 503 esperado) · POST/PUT/PATCH/DELETE 405 · fora da allowlist 404 · BI local 200 · boot `[cron] jobs internos desabilitados` · único ERROR nos logs = o 503 esperado.

## 7. Regressão (PREVIEW_REGRESSION_MATRIX)
**A. Paridade de dados (API, produção × preview, 26 casos com filtros e páginas):** 26/26 idênticos (dashboard difere só em `period.to` = instante da chamada). Masking: nenhum telefone completo. Latência preview ≈ produção (proxy +0–0,1 s; `ai/opportunities` 5,5–6,5 s nos dois = PERFORMANCE_DEBT).
**B. UI** — como eu não posso digitar credenciais em host não-local, a UI foi exercitada num Express **local na configuração exata do preview** (mesmo código, proxy para a API oficial, BI pelo reader, segredo legado local aleatório):
| Tela | Dados | Filtros/Pag. | Masking | Auth | Responsivo 375–1440 | Errors/Loading | Console | Network | Notas |
|---|---|---|---|---|---|---|---|---|---|
| Dashboard | PASS (= v2: 3/0/0…) | N/A | PASS | PASS | PASS | PASS | 0 erros | só GET | v2 destaca "282 falhas" no dashboard; React mostra em Saúde (gap de UX, não de dado) |
| Cliente 360 / Jornada | PASS (API) | PASS | PASS | PASS | PASS | PASS | 0 | só GET | |
| Mensagens / Templates | PASS | PASS | PASS | PASS | PASS | PASS | 0 | só GET | vocabulário novo |
| Conversas | PASS | PASS | PASS | PASS | PASS | PASS | 0 | só GET | somente leitura |
| Recovery | PASS | PASS | PASS | PASS | PASS | PASS | 0 | só GET | amostra rotulada |
| Campanhas & IA / E-mail | PASS | PASS | PASS | PASS | PASS (375: carregamento >16 s com 8 telas simultâneas) | PASS | 0 | só GET | PERFORMANCE_DEBT |
| Saúde / Auditoria | PASS | PASS | PASS | PASS | PASS | PASS | 0 | só GET | |
| BI | PASS (reader) | período | N/A | PASS | PASS | PASS | 0 | só GET | embed renderiza; 3 warnings de dados |
32/32 combinações rota×largura sem overflow nem estado de erro. Sessão nova no Cloud Run validada por API (login/429/401); **login visual no preview não feito por mim** (regra: não digito credenciais em host não-local) → pendente do dono.

## Pendências para o cutover
1. Dono: logar no preview com a credencial temporária e revisar visualmente (lado a lado com `/crm-v2`).
2. Senha/usuários definitivos em `CENTRAL_AUTH_USERS`.
3. Operador do `/inbox` com v3.
4. Decidir tratamento dos débitos (UTC, consentimento histórico, purchased_after_contact, KPIs internos do Metabase, ai/opportunities).
5. `/inbox/conversations` 500 (pré-existente).
6. Revisão `drosa-recovery-consent-sync-v1` (outra frente, imagem não promovida) — decidir antes do freeze.
