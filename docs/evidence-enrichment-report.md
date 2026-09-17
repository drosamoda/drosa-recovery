# Evidence Enrichment v1 — relatório de dados reais

**Metodologia e uma limitação honesta primeiro**: este relatório foi produzido
por leitura do código-fonte já em produção (webhooks, jobs, tipos Nuvemshop),
não por uma consulta ao vivo ao banco de dados real ou à API real da
Nuvemshop — esta sessão não tem credenciais nem autorização para acessar
diretamente o Postgres de produção/Preview, e a missão pede explicitamente
para não tocar banco. O código que já processa esses payloads em produção
hoje É a fonte confiável de "quais campos existem" — se `orderService.ts` já
extrai com sucesso `payment_details.method` de todo pedido real há meses, isso
é uma confirmação indireta, mas real, do formato do payload. Onde a resposta
depende do que a API COMPLETA da Nuvemshop retornaria (não o que já está
armazenado), isso está marcado explicitamente como não verificado.

## 1. `AbandonedCheckout.rawPayload`

Shape confirmado em `src/services/abandonedCheckoutService.ts:10-24`
(`NuvemshopCheckoutPayload`): `id, token, contact_name/email/phone, total,
currency, products: [{ name?, quantity? }], checkout_url,
abandoned_checkout_url, created_at, updated_at`.

```
ABANDONED_CHECKOUT_HAS_PRODUCT_ID=AUSENTE
```
Line items só têm `name`/`quantity` — nenhum `product_id`/`variant_id` em
nenhum lugar do tipo ou do código que o lê (`abandonedCheckoutService.ts`,
`nuvemshopService.ts`'s `NuvemshopCheckout`).

```
CHECKOUT_HAS_RECOVERY_URL=PRESENTE
```
`abandoned_checkout_url` (fallback `checkout_url`) já é extraído e vira a
coluna obrigatória `AbandonedCheckout.abandonedCheckoutUrl` — esta é a
evidência mais sólida de todo o relatório: 100% dos checkouts armazenados têm
um valor aqui (coluna `String`, não `String?`, no schema).

## 2. `Order.rawPayload`

Shape confirmado em `src/services/orderService.ts:12-28`
(`NuvemshopOrderPayload`): `id, number, status, event, payment_status,
payment_details: { method? }, contact_name/email/phone, total, currency,
checkout_url, created_at, updated_at`.

```
ORDER_HAS_PRODUCT_ID=AUSENTE
ORDER_HAS_VARIANT_ID=AUSENTE
ORDER_HAS_CATEGORY_ID=AUSENTE
```
Nenhum array de itens (`products`/`line_items`/`items`) existe no tipo ou é
lido em `orderService.ts`. `payment_details` só tem `method`.

```
PIX_HAS_EXPIRY=AUSENTE
BOLETO_HAS_DUE_DATE=AUSENTE
```
Busca por `expir|due_date|vencimento|boleto_url|barcode|pix_url|qr_code` em
todo `src/` (fora de testes/prompt de IA): zero ocorrências em código de
produção. Confirmado indiretamente por `src/jobs/syncBoletoExpiring.ts:17-25`:
o job de notificação de boleto vencendo calcula uma janela sintética
(`order.createdAt + BOLETO_NOTIFY_HOURS`) exatamente porque não existe um
campo real de vencimento para usar — se existisse, o job já o estaria usando.

## 3. Colunas tipadas do Prisma (não `rawPayload`)

`Order` (schema.prisma:42-76): sem coluna de vencimento/prazo.
`AbandonedCheckout` (schema.prisma:82-121): `productsSummary` é uma *string*
já achatada (`"2x Camiseta, Calça"`, montada em
`abandonedCheckoutService.ts:47-56`), não uma estrutura com IDs.

## 4. Tipos Nuvemshop (`nuvemshopService.ts`)

`NuvemshopProduct` (linha 5-15): `id, name, description, handle,
canonical_url, variants[], images[], attributes[]`. Sem `category`/
`categoryId`/`categories` em nenhum lugar — confirmado também em
`productTruthService.toProductTruth()`, que não popula nenhum campo de
categoria em `ProductTruth`.

## 5. Funções que já chamam a API real (não só o payload armazenado)

`fetchProductById`, `fetchOrderById`, `fetchCheckoutById` e `searchProducts`
já existem em `nuvemshopService.ts` e chamam endpoints reais. **Não verificado
nesta sessão**: se a resposta completa de `GET /orders/:id` da Nuvemshop
inclui um array de produtos com `product_id`/`variant_id` (a documentação
pública da Nuvemshop sugere que sim, mas isso nunca foi confirmado contra uma
conta real neste projeto, e `fetchOrderById` retorna `unknown` — o código
nunca comprometeu um formato). `campaignEvidenceService.ts` foi escrito de
forma defensiva para aproveitar isso se um dia for confirmado (extrai
`product_id`/`variant_id` de qualquer `products[]` que encontrar), mas hoje só
lê o que já está armazenado — nenhuma chamada nova à API foi adicionada para
esta investigação, por decisão deliberada (ver seção "Performance" abaixo).

## Por que nenhuma chamada nova à API foi feita para "confirmar" o que falta

A missão pede para não fazer uma chamada Nuvemshop por cliente em listas
grandes, e para preferir timeout fail-closed a inventar. Adicionar uma
chamada de detalhe (`fetchOrderById`/`fetchCheckoutById`) por linha amostrada
só para "talvez" descobrir um campo cujo formato não está confirmado teria um
custo real (latência, nova superfície de falha, uma chamada à conta de
produção da Nuvemshop) para um benefício não verificado. A escolha foi:
extrair só do que já está sincronizado localmente, documentar honestamente o
que falta, e deixar o extrator pronto (não a chamada de rede) para o dia em
que isso for decidido deliberadamente.

## Resumo

```
ABANDONED_CHECKOUT_HAS_PRODUCT_ID=AUSENTE
ORDER_HAS_PRODUCT_ID=AUSENTE
ORDER_HAS_VARIANT_ID=AUSENTE
ORDER_HAS_CATEGORY_ID=AUSENTE
PIX_HAS_EXPIRY=AUSENTE
BOLETO_HAS_DUE_DATE=AUSENTE
CHECKOUT_HAS_RECOVERY_URL=PRESENTE
```

Nenhum dado de cliente real foi exposto neste relatório — os únicos fatos
citados são nomes de campos e trechos de tipos TypeScript já públicos no
próprio repositório.
