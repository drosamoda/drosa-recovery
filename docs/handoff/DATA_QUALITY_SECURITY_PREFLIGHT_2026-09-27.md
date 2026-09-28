# Fase E — Data Quality + Security Preflight (27/09/2026)

> **Status normalizado em 28/09 (Fase H):** AUTH_IMPLEMENTATION=PASS · AUTH_PRODUCTION_READINESS=FAIL · PREVIEW_CODE_READINESS=PASS · PREVIEW_ENV_READINESS=FAIL · PROD_SECRET_EXPOSURE_INCIDENT=YES · PROD_DB_WRITE_GUARD=FAIL. Ver `PHASE_H_PRODUCTION_CHANGE_PACKAGE_2026-09-28.md`.


## Semântica corrigida
- Recovery: "Pedidos observados após contato" → **"Pedidos com contato registrado"**. A API não traz horário do contato vs. pedido; o texto não afirma ordem nem atribuição.
- Funil Recovery: legenda **"Amostra da página atual — N registros (de T no total)"**; percentuais valem só para a amostra. Motivos: "amostra da página atual".
- Webhooks: **"Últimos N eventos"** (N=100 hoje); taxa rotulada "Taxa de erro (janela)", explicitamente não histórica. Erros históricos (249 Nuvemshop) seguem pendentes.

## DATA_QUALITY_WARNING — título de oportunidade
- Origem provada: `src/services/aiOpportunityEngine.ts:168` → `title.replace('{n}', String(segment.eligible || segment.found))`. Com `eligible=0`, o `||` cai para `found` (população) e o template "{n} carrinhos abandonados elegíveis" passa a afirmar elegíveis inexistentes.
- Frontend: quando o título menciona "elegíveis" e o número não bate com `eligibleCount`, a headline vira neutra por tipo (`Carrinhos abandonados`) e o card mostra `DATA_QUALITY_WARNING` com o título cru. Contadores reais continuam separados. Elegibilidade não foi tocada.
- Correção de raiz sugerida (backend, fora desta rodada): usar `found` com texto de população ("{n} carrinhos abandonados") ou `eligible` sem fallback.

## INBOX_ADMIN_SECRET
- Produção usa Secret Manager `drosa-recovery-inbox-admin-secret` v2 (= latest).
- Comparação SHA-256 local (.env) × produção: **MATCH_PRODUCTION=NO**. Valor local substituído por valor aleatório (não impresso). `.env` é gitignored e nunca foi commitado.
- **Incidente durante o preflight:** a primeira tentativa usou uma função PowerShell chamada `H`, que colide com o alias `Get-History`; a mensagem de erro imprimiu o valor de produção v2 na saída da sessão. Portanto **PRODUCTION_SECRET_ROTATION_REQUIRED=YES** — não rotacionado automaticamente (ver plano no relatório final da rodada).

## Performance baseline (GET sequencial ×3, direto no Cloud Run, 27/09)
| Endpoint | p50 (s) | máx (s) | timeout |
|---|---|---|---|
| dashboard?period=7d | 2.48 | 2.75 | 0 |
| customers | 1.91 | 2.10 | 0 |
| messages | 0.95 | 1.02 | 0 |
| conversations | 1.09 | 1.17 | 0 |
| checkouts (50) | 2.82 | 2.83 | 0 |
| payments/pix (50) | 1.19 | 1.19 | 0 |
| remarketing (20) | 1.50 | 2.09 | 0 |
| **ai/opportunities?channel=all** | **5.59** | **6.41** | 0 |
| email/audiences | 0.51 | 0.52 | 0 |
| health | 2.47 | **3.10** | 0 |
| audit (100) | 1.02 | 1.33 | 0 |

>3s: `ai/opportunities` (p50), `health` (máx). >8s: nenhum. Sob concorrência (várias abas pesadas ao mesmo tempo) checkouts chegou a ~10s e uma chamada falhou — não otimizado nesta fase.
