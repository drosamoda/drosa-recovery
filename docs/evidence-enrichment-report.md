# Evidence Enrichment — relatório de dados reais

## ⚠️ Correção v1.1 (Live Evidence Probe) — leia isto primeiro

A versão original deste relatório (v1) concluiu `product_id AUSENTE` com base
**só na leitura do código-fonte e das interfaces TypeScript**
(`NuvemshopCheckoutPayload`/`NuvemshopOrderPayload`), sem consultar o dado
real armazenado. Essa conclusão estava **errada** e foi corrigida nesta
revisão.

O motivo do erro: `orderService.ts` e `abandonedCheckoutService.ts` salvam o
payload bruto em uma coluna `Json` tipada como `[key: string]: unknown` — ou
seja, a interface TypeScript documenta só um SUBCONJUNTO dos campos que a
integração realmente persiste, porque o código nunca precisou tipar o resto
para funcionar. Uma interface estreita não é prova de ausência do dado real.

Para corrigir isso com segurança, foi feita uma inspeção **read-only, sem
PII** do banco de Preview (script temporário fora do repositório, usando a
credencial de leitura já existente em `.env.preview.local`; nenhuma variável
de ambiente foi alterada, nenhuma migração foi aplicada): até 3
`AbandonedCheckout` e 3 `Order` reais, imprimindo apenas os NOMES das chaves
encontradas (nunca valores — nunca nome/telefone/e-mail/endereço). Os fatos
abaixo substituem a v1.

## Fatos confirmados por inspeção real (read-only, Preview, 2026-09)

```
ABANDONED_CHECKOUT_HAS_PRODUCT_ID=PRESENTE
ABANDONED_CHECKOUT_HAS_VARIANT_ID=PRESENTE
ORDER_FETCHED_PAYLOAD_HAS_PRODUCT_ID=PRESENTE
ORDER_FETCHED_PAYLOAD_HAS_VARIANT_ID=PRESENTE
```

**Caminhos exatos confirmados** (únicos suportados por
`campaignEvidenceService.ts` — extração por caminho fixo, nunca um crawler
genérico que vasculha qualquer campo):

- `AbandonedCheckout.rawPayload.products[]` (raiz, sem aninhamento) — cada
  item tem `id, product_id, variant_id, sku, name, quantity, price,
  compare_at_price, width, height, depth, weight, barcode, image, is_gift,
  free_shipping, promotions, properties, variant_values,
  has_promotional_price, name_without_variants`.
- `Order.rawPayload.products[]` — presente quando o webhook original já veio
  completo.
- `Order.rawPayload.fetchedOrderPayload.products[]` — presente quando o
  pedido precisou de um fetch de detalhe adicional
  (`orderService.resolveOrderPayload`); nesse caso
  `Order.rawPayload.originalWebhookPayload` fica reduzido a
  `{ id, event, store_id }` e o payload completo (incluindo `products[]`)
  fica dentro de `fetchedOrderPayload`.

`product_id` e `variant_id` são campos **distintos** em todo item de produto
real observado — nunca o mesmo id, e um nunca substitui o outro
(`campaignEvidenceService.ts` extrai os dois separadamente; só `product_id`
comprovado é verificado via `productTruthService.verify()` contra a Nuvemshop
real; um `variant_id` sozinho fica fail-closed, nunca tratado como se fosse
`product_id`).

### Ainda confirmado AUSENTE (não mudou nesta revisão)

```
PIX_HAS_EXPIRY=AUSENTE
BOLETO_HAS_DUE_DATE=AUSENTE
ORDER_HAS_CATEGORY_ID=AUSENTE
```

Inspeção real confirmou: `payment_details` (checkout e pedido) só tem
`{ method, installments, credit_card_company }` — nenhum campo de
vencimento/expiração em nenhum nível até profundidade 2 (a mesma profundidade
que `findExpiryLikeKey()` varre). Nenhum item de produto real amostrado tem
`category_id`/`categories` — só os campos listados acima.

### Confirmado PRESENTE mas ainda NÃO usado (fora do escopo desta rodada)

`AbandonedCheckout.rawPayload.has_stock_available` (bool no nível do
checkout) e `promotional_discount.total_discount_amount` +
`has_promotional_price`/`compare_at_price` por item — poderiam sustentar
`hasStockEvidence`/`hasPromotionEvidence` adicionais no futuro, mas não foram
ligados a nenhuma flag nesta rodada por decisão deliberada de escopo, não por
limitação técnica.

```
CHECKOUT_HAS_RECOVERY_URL=PRESENTE
```
Continua a evidência mais sólida do relatório: `abandonedCheckoutUrl` é
coluna `String` obrigatória no schema (`prisma/schema.prisma`), não
`String?` — praticamente sempre presente na prática.

## Bloqueio de escopo (não impede este commit)

```
BLOCKER_NUVEMSHOP_PREVIEW_CREDENTIALS=YES
```
Nenhuma credencial real da Nuvemshop (`NUVEMSHOP_ACCESS_TOKEN`) existe em
`.env.preview.local` — só os nomes das variáveis existem como placeholder em
`.env.example`. Por isso a sonda de detalhe via API real
(`fetchOrderById`/`fetchCheckoutById`, seção "GET /orders/:id retorna
product_id?") **não foi executada** nesta rodada — permanece não verificada.
Isso não bloqueia o trabalho desta rodada porque toda a correção feita
(separação `product_id`/`variant_id`, extração pelos caminhos confirmados,
contexto de `purchasedProducts`/`cartProducts` para a IA) depende só do
payload já armazenado, que FOI verificado.

## Metodologia

Leitura read-only via Prisma direto (sem passar pela API HTTP do CRM),
usando a credencial de leitura já autorizada em Preview
(`.env.preview.local`: `DATABASE_URL`/`DIRECT_URL`). O script rodou fora do
repositório (scratchpad da sessão), nunca foi commitado, e imprimiu somente
uma árvore recursiva de nomes de chave (`Object.keys()`), nunca um valor —
nenhum nome, telefone, e-mail ou endereço de cliente real foi lido ou exibido
em nenhum momento desta investigação.

## Resumo

```
ABANDONED_CHECKOUT_HAS_PRODUCT_ID=PRESENTE
ABANDONED_CHECKOUT_HAS_VARIANT_ID=PRESENTE
ORDER_FETCHED_PAYLOAD_HAS_PRODUCT_ID=PRESENTE
ORDER_FETCHED_PAYLOAD_HAS_VARIANT_ID=PRESENTE
ORDER_HAS_CATEGORY_ID=AUSENTE
PIX_HAS_EXPIRY=AUSENTE
BOLETO_HAS_DUE_DATE=AUSENTE
CHECKOUT_HAS_RECOVERY_URL=PRESENTE
BLOCKER_NUVEMSHOP_PREVIEW_CREDENTIALS=YES
```

Nenhum dado de cliente real foi exposto neste relatório — os únicos fatos
citados são nomes de campos, nunca valores.
