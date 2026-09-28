# METABASE_SEMANTIC_AUDIT — 28/09/2026

Fonte: `report_dashboardcard`/`report_card` do app DB do Metabase (leitura, transação READ ONLY). SQL real de cada card.

| Dashboard | Card | KPI | Fonte | Fórmula | Status | Motivo |
|---|---|---|---|---|---|---|
| 2 Visão Executiva | 42 Mensagens hoje (total) | total do dia | bi_message_daily_stats | sum(message_count) todos os status | FIX | inclui bloqueadas/fila; rótulo correto = "Avaliadas hoje" |
| 2 | 43 Failure rate hoje (%) | taxa de falha | bi_message_daily_stats | failed / total (com skipped/pending) | FIX (HIDE até corrigir) | denominador errado; usar failed / (disparadas + failed) |
| 2 | 40 Mensagens hoje por status | contagem por status | bi_message_daily_stats | status cru | KEEP | fato bruto (débito UTC) |
| 2 | 41 Tendência diária (30d) | série por status | bi_message_daily_stats | status cru | KEEP | fato bruto (débito UTC) |
| 3 Envios | 44 Funil Send→Delivered→Read | funil | bi_message_daily_stats | "enviadas"=sent+delivered+read; entregues; lidas | FIX | renomear "enviadas" → "Disparadas" (etapas são subordinadas) |
| 3 | 45 Falhas por template | falhas | bi_template_daily_stats | sum failed por template | KEEP | |
| 5 Consentimentos | 47 Estado atual por escopo | telefones por escopo/status | bi_consent_current_state | contagem | KEEP | |
| 5 | 48 Funil pedidos → consentimento | pedidos × escopos | bi_orders_consent_funnel_daily | somas | FIX | escopos transacional/marketing são PARALELOS, não funil; renomear e trocar visualização |
| 6 Carrinho | 49 Funil carrinho abandonado | funil | bi_abandoned_cart_funnel_daily | abandonados→telefone→consent.→elegíveis→"enviada"→entregue→lida→compra_posterior | HIDE | mistura etapas não subordinadas (disparo ⊄ elegíveis de hoje); `purchased_after_contact` = só `convertedOrderId IS NOT NULL` apresentado como "compra posterior"; "enviada" |
| 7 Pedidos | 50 Faturamento diário | "faturamento" | bi_orders_daily_summary | sum(total_amount) TODOS os status | FIX | inclui pendentes/cancelados; ou filtrar pagos ou renomear "Valor de pedidos (todos os status)" |
| 7 | 51 Pedidos por status de pagamento | pedidos/total/ticket | bi_orders_daily_summary | avg(avg_ticket) | FIX | média de médias diárias ≠ ticket médio; usar sum(total)/sum(pedidos) |
| 8 Webhooks e Saúde | 52 Eventos por provider | eventos/erros/HMAC | bi_webhook_daily_summary | somas | KEEP | |
| 8 | 53 Pulso do sistema | último pedido/webhook, fila | bi_system_pulse | fatos | KEEP | |

## Decisão aplicada (sem editar o Metabase)
Editar cards direto no app DB arriscaria quebrar `visualization_settings` (nomes de coluna) e o mesmo Metabase ainda atende o BI Vercel. Portanto:
- A Central só embute dashboards **100% KEEP**: hoje apenas **8 (integrations)** — `METABASE_SEMANTICALLY_APPROVED` em `src/services/metabaseEmbed.ts`, aplicado no servidor.
- Aliases executive/messages/consents/recovery/orders → `503 METABASE_SEMANTIC_REVIEW_PENDING`; a aba mostra aviso neutro e os KPIs nativos do React (já no dicionário: Avaliadas/Bloqueadas/Disparadas/Aguardando entrega/Entregues/Lidas, taxas sobre Disparadas, escopos paralelos, "Carrinhos com pedido vinculado").
- **Resultado: METABASE_SEMANTIC_AUDIT=PASS, INVALID_EXECUTIVE_KPIS_VISIBLE=0** (na Central).

## Backlog (METABASE_CARD_FIXES)
Corrigir no Metabase (UI de admin, que atualiza metadados corretamente) os cards 42, 43, 44, 48, 50, 51 e ocultar/reconstruir 49; depois incluir o alias em `METABASE_SEMANTICALLY_APPROVED`. O BI Vercel continua mostrando os cards antigos até ser aposentado.
