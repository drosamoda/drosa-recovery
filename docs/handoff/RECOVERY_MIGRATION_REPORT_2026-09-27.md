# Recovery — migração React (27/09/2026)

Rota `/recovery`, abas Carrinho abandonado / PIX / Boleto / Remarketing. Somente leitura, nenhuma mudança de regra, consentimento, janela, prioridade, idempotência, cron, envio, webhook ou banco.

## Fontes (GET)
| Aba | Endpoint | Observações do contrato real |
|---|---|---|
| Carrinho | `/crm-api/checkouts?status&page&pageSize=50` | `eligible`/`blockers` vêm de `evaluateAbandonedCheckoutEligibilityBatch` no backend; `total` é string (Decimal). Resposta leva ~8–10 s em produção. |
| PIX / Boleto | `/crm-api/payments/{pix,boleto}` | `error.category` = `normalizeFailure()` do backend. |
| Remarketing | `/crm-api/remarketing?pageSize=20` | runs + até 20 destinatários + flags `runtime`. |

## Regras de apresentação aplicadas
- Funil só com etapas subordinadas: Avaliados → Elegíveis → Disparados → Entregues → Lidos. Percentual relativo a Avaliados, sem limitar em 100%. Rotulado como **amostra da página carregada** (não é total do período — a API não expõe agregado).
- "Pedidos observados após contato" em cartão separado (carrinho com mensagem registrada + `convertedOrderId`), com aviso "Não é atribuição". Nunca "conversão", "recuperação", "receita recuperada" ou ROI.
- Motivos de bloqueio: contagem dos códigos devolvidos pelo backend na página (sem segunda lógica). Rótulo amigável + código cru no tooltip. Mapa cobre o enum completo de `AbandonedCheckoutEligibilityReason` (inclui `too_recent`, observado em produção).
- Flags de runtime (`REMARKETING_ENABLED`, `AUTOMATION_SEND_ENABLED`, `WHATSAPP_DRY_RUN`) em badge neutro: habilitado/desabilitado/estado desconhecido; false nunca vira vermelho.
- Status de destinatário de remarketing com mapa próprio (`RemarketingRecipientStatus`: eligible/suppressed/queued/sent/failed).

## Componentes novos
`StageFunnel` (genérico), `FlagBadge` (genérico, reusado em Saúde).

## Testes
5 novos: funil + separação da compra posterior + agregação de motivos; dado fora de ordem sem ajuste; PIX com status/motivo; remarketing com flags neutras e motivos do destinatário; erro e vazio.

## Gaps (NOT_AVAILABLE_FROM_CURRENT_API)
- Funil agregado do período inteiro (só amostra por página).
- Horário do contato vs. horário do pedido não vem junto no checkout → "após contato" significa "com contato registrado".
- Consentimento marketing vs. transacional por carrinho não é exposto no endpoint de checkouts (ver Cliente 360 › Consentimentos).
