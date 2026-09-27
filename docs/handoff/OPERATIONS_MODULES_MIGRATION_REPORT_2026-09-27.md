# Campanhas & IA, E-mail, Saúde, Webhooks, Auditoria — migração React (27/09/2026)

Rotas `/campaigns` (Oportunidades · E-mail · Campanhas · Automações · Aprendizados) e `/health` (Visão geral · Webhooks · Auditoria). Somente GET. Nenhum POST de `/crm-api/ai/campaigns*` é chamado; nenhuma flag, cron, envio, credencial, domínio, webhook, template operacional ou fila foi tocado.

## Fontes (GET) e contrato real
| Aba | Endpoint | Observado em produção |
|---|---|---|
| Oportunidades | `/crm-api/ai/opportunities?channel=all\|whatsapp\|email` | 19 cards; `eligibleCount` pode ser `null` → "Não calculado"; `topBlockers {reason,count}` |
| E-mail | `/crm-api/email/{campaign-library,audiences,recommendations}` | gate de envio bloqueado (`missing` exibido cru); sem métricas de abertura/clique/bounce/descadastro na API |
| Campanhas / Aprendizados | `/crm-api/ai/campaigns`, `/crm-api/ai/learning` | 503 `AI_DATABASE_NOT_CONFIGURED` → aviso neutro, não erro |
| Automações | `/crm-api/automations` | flags runtime por regra |
| Saúde | `/crm-api/health` | runtime `cron=false` → "Cron desabilitado" (neutro) |
| Webhooks | `/crm-api/audit?pageSize=100` | agregado da **amostra** dos 100 eventos mais recentes |
| Auditoria | `/crm-api/audit?pageSize=50` | `fullAuditLog.status=NOT_AVAILABLE` (faltam actor/before/after/reason) |

## Regras aplicadas
- Card de oportunidade: oportunidade, população, elegíveis, bloqueados, motivos (rótulo + código no tooltip), canal, template, status, recomendação existente. Sem botões de ação.
- Saúde por integração: estado, última evidência, problema, impacto, ação sugerida. Tom derivado de **evidência** (erro/HMAC inválido/não processado), nunca de boolean de configuração isolado. Flags de runtime sempre neutras: habilitado/desabilitado/estado desconhecido.
- Webhooks: provider, tópico, total, processados, erros, taxa, última ocorrência — rotulado como amostra. Os 249 erros históricos da Nuvemshop seguem investigação separada (não entram na amostra recente e nada foi alterado).

## Componentes novos
`HealthCard` (genérico). Reuso: `QueryView`, `FlagBadge`, `CodeBadge`, `Field`, `StatCard`, `DataTable`, `Notice`, `Tabs`, `Pagination`.

## Testes
10 novos (oportunidade sem ações; 503 neutro; e-mail só métricas reais + gap; cron neutro; 500 como erro; flags semânticas; cards de integração; agregado de webhooks; auditoria; 401).

## Ajuste de tooling
`vitest.config.ts` (raiz) passou a excluir `frontend/**` e `dist/**`: `npm test` na raiz coletava os testes do frontend (sem jsdom) e testes compilados antigos em `dist/`. CI (`test:unit`/`test:integration`) não era afetado.

## Gaps (NOT_AVAILABLE_FROM_CURRENT_API)
- Agregado completo de webhooks por provider/tópico (exigiria endpoint novo = mudança de backend).
- Métricas de e-mail (abertura, clique, bounce, descadastro).
- Campanhas/Aprendizados dependem de `AI_DATABASE_URL` (ativação separada).
- Log de auditoria de operador.
- Título da oportunidade de carrinho diz "elegíveis" enquanto `eligibleCount=0` — texto vem do backend; exibido sem alteração.
