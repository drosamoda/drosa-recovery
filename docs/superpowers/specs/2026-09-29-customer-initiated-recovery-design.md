# Recuperação iniciada pela cliente (CTA "Continuar pelo WhatsApp") — spec curta

- Data: 2026-09-29 · Status: PROPOSTA (aguarda aprovação; NÃO implementar antes do fechamento do canário P0A)
- Contexto confirmado (auditoria de código): webhook Meta reutilizável (`POST /webhooks/meta` → `inboxService.saveInboundMessagesFromMetaPayload` grava a mensagem e `conversation.lastInboundAt`); janela de 24h já calculada (`isWithinWhatsappCustomerCareWindow`, hoje só no envio manual); `abandoned_checkouts` indexado por `normalizedPhone`; `conversation.assignedTo` existe (handoff humano); nada responde sozinho a inbound; nenhum `wa.me` no código.
- Contexto confirmado na documentação oficial da Nuvemshop: Storefront NubeSDK possui slots de carrinho, incluindo `after_cart_summary` e `after_go_to_checkout`. Para esta feature, `after_go_to_checkout` é o ponto preferido porque mantém o CTA de WhatsApp como ação secundária ao checkout principal. Em temas antigos/customizados, confirmar que o slot existe no carrinho AJAX e na página `/comprar` antes de publicar.

## Objetivo
Cliente sem opt-in de marketing → toca "Continuar minha compra pelo WhatsApp" → ela própria envia a primeira mensagem → o CRM responde, **dentro da janela de 24h**, com o contexto mínimo do carrinho e o link para retomar. Não é opt-in permanente: a conversa iniciada pela cliente nunca converte em consentimento de marketing.

## Decisões
- **A. CTA:** texto "Continuar minha compra pelo WhatsApp".
- **B. Mensagem pré-preenchida:** "Oi! Quero continuar minha compra na D'Rosa pelo WhatsApp." (a loja não envia; a cliente aperta Enviar).
- **C. Onde colocar (decisão técnica):**

| Superfície | Facilidade | Contexto do carrinho | Risco no checkout | Permissão nova |
|---|---|---|---|---|
| **Carrinho via Storefront NubeSDK / `after_go_to_checkout` (recomendada)** | alta | tem itens/URL | nenhum: ação secundária | nenhuma nova, desde que o slot esteja presente no tema |
| Carrinho via tema direto | alta | tem itens/URL | nenhum | edição de tema |
| Checkout | média | tem | maior risco de interferir na conversão | depende do slot |
| Página de produto | alta | sem carrinho consolidado | nenhum | nenhuma; recupera pouco |

  Recomendação: primeiro tentar `after_go_to_checkout` no carrinho via NubeSDK. Se o tema Recife instalado não expuser o slot, usar inserção mínima no tema. Nada é publicado sem aprovação.
- **D. Número (`wa.me`):** o CRM usa um único `META_PHONE_NUMBER_ID` (templates e inbox no mesmo número). `WHATSAPP_API_NUMBER` configurado termina em `…4855`. O `wa.me` deve usar **exatamente** o número exibido desse `phone_number_id`; confirmar no runtime/console antes de publicar.
- **E. Matching (job, não webhook):** telefone = remetente verificado pela Meta (nunca digitado no inbound). Carrinho = `abandoned_checkouts` com `normalizedPhone` igual, `status='abandoned'`, não convertido, criado nos últimos 7 dias, o mais recente. Mais de um candidato recente com produtos diferentes ou nenhum → **handoff humano** (`conversation.assignedTo` sem dono + status aberto), sem inventar.
- **F. Segurança da resposta:** só resumo mínimo (até 3 itens: nome do produto e quantidade) + link de retomada. Nunca nome completo, endereço, documento, e-mail ou telefone. Risco documentado: cliente que digitou número de terceiro no checkout — a resposta só chega a quem controla esse número e contém apenas itens e link.
- **G. Assíncrono e idempotente:** o webhook só grava o inbound (como hoje). Um registro de intenção `customer_initiated_cart_recovery` (linha em `message_logs` com `source` dessa origem, `entityType` do carrinho, chave de idempotência = `waMessageId` do inbound) é criado fora do webhook e processado por job com claim atômico. Mesmo inbound → no máximo 1 resposta.
- **H. Janela:** só resposta livre (texto) enquanto `isWithinWhatsappCustomerCareWindow(lastInboundAt)`; fora da janela → não responde, entra no handoff humano.
- **I. Sem migration:** reaproveita `message_logs`, `conversations`, `abandoned_checkouts`.
- **J. Métricas** ("pedido após interação", nunca "causado por"): medir inbound iniciado por origem, respostas enviadas, handoffs e pedidos do mesmo telefone após a resposta. Clique no CTA só entra se houver instrumentação explícita no storefront.

## Arquivos mínimos
`src/services/inboxService.ts` (detectar inbound elegível e registrar a intenção após gravar), `src/jobs/processCustomerInitiatedRecovery.ts` (novo), `src/routes/jobs.routes.ts` (rota + Scheduler futuro), `src/services/customerInitiatedRecovery.ts` (matching + texto), testes; storefront: extensão/tema para 1 CTA no carrinho.

## Scheduler
Não armazenar `JOBS_SECRET` como header estático dentro do objeto do Cloud Scheduler. Para o job permanente, preferir autenticação OIDC com service account dedicada e validação restrita no endpoint. Até esse auth path existir e estar testado, não criar o Scheduler permanente.

## Fora de escopo
Marketing por WhatsApp sem opt-in; template de marketing na janela; guardar consentimento a partir da conversa; e-mail como fallback (PR de orquestração de canais).
