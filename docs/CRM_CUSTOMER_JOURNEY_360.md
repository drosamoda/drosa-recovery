# CRM Customer Journey 360 — fase de leitura

Esta tela relaciona os registros já existentes pelo telefone normalizado. Cada linha representa um telefone identificado; clientes e contatos que compartilham o telefone aparecem juntos. A API executa somente consultas de leitura e não lê `rawPayload`. A rota continua sob o segredo de leitura do CRM e não oferece métodos de escrita.

A listagem seleciona no PostgreSQL uma página de até 100 telefones distintos e o total de candidatos; depois consulta em nove lotes apenas os telefones dessa página. O detalhe resolve o ID por índice e consulta somente o telefone correspondente. As métricas globais são agregadas no banco. O número de consultas do serviço permanece fixo por página, sem query por cliente; volumes muito altos concentrados num só telefone ainda podem tornar o detalhe grande e exigiriam paginação de eventos numa fase posterior.

Fontes: `customers`, `contacts`, `orders`, `abandoned_checkouts`, `message_logs`, `conversations`, `chat_messages`, `whatsapp_consents` e `suppressions`. Mensagens de saída do log e da Inbox com o mesmo identificador Meta são exibidas uma vez. O detalhe mantém a origem e a referência de cada evento. Quando a fonte não fornece o horário comercial (por exemplo, pagamento ou falha), a timeline mostra `NOT_AVAILABLE`; o horário técnico de ingestão não substitui o horário da ação.

`messageAt` é o horário de origem da mensagem (envio, aceitação ou agendamento); `statusAt` é o horário da última confirmação conhecida. A última mensagem usa `messageAt`, para que uma leitura tardia não faça uma mensagem antiga ultrapassar uma mensagem enviada depois.

Os indicadores da tela têm períodos explícitos: atividade, carrinhos, pedidos e respostas são do dia; clientes contatados, entregas, leituras e falhas usam o histórico disponível. Os totais reais das nove tabelas dependem de uma consulta somente leitura ao banco de produção e não são inferidos do schema ou de testes locais.

## Lacuna de comportamento do site

O código atual não registra de forma confiável `product_view`, `add_to_cart`, `remove_from_cart`, `search` ou `checkout_started`. A jornada mostra apenas pedidos, carrinhos e mensagens persistidos. Uma fase futura pode receber eventos com `event_id` único, identificador anônimo/de sessão, `customer_id` quando identificado, telefone/email somente quando obtidos legitimamente, tipo do evento, IDs de produto/variante/checkout/pedido, `occurred_at`, origem e metadados sanitizados. Ela precisará de política de retenção, deduplicação, vinculação de identidade, transparência/consentimento apropriados e separação explícita entre atividade do site e permissão para WhatsApp.

Esta fase não inclui captura de eventos, migration, envio, job ou mudança dos gates comerciais. O consentimento exibido usa a classificação canônica: `GRANTED` exige `consented=true`, `consentedAt` presente e `revokedAt` ausente; opt-out e suppression permanecem separados.
