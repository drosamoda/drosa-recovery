# Strategy Lab v1 — Exemplos por tipo de oportunidade

Estes exemplos vêm literalmente da mesma fonte usada pelos testes automatizados
(`src/__tests__/fixtures/strategyLabFixtures.ts`) — não são texto solto de
documentação, são o conteúdo que `strategyLab.test.ts` verifica a cada rodada
de `npm test`. Se o texto aqui divergir do arquivo de fixture, é a fixture
que está certa; abra uma issue.

Todos usam `productId: null` porque nenhum candidato de produto real é
fornecido nesta fase (`candidateProducts: []` em `campaignService.ts`) — nunca
porque a IA "esqueceu" de citar um produto. Nenhuma mensagem contém desconto,
cupom, frete grátis, urgência, prazo, escassez, cor, tamanho, tecido,
lançamento, exclusividade, bestseller, prova social ou benefício corporal sem
comprovação — isso é o que os gates de Compliance auditam automaticamente.

Para cada tipo: `PRODUCT_TRUTH`, `COMPLIANCE` e `CREATIVE_DISTANCE` = PASS
significa que `strategyLab.test.ts` roda os 3 gates reais do código
(`auditAllStrategies`, `evaluateCreativeDistance`, `auditDirectionAdherence`)
contra este exato conteúdo e não encontra nenhum finding.

---

## ABANDONED_CART

| | A — RECUPERAÇÃO DIRETA | B — ASSISTÊNCIA / REDUÇÃO DE FRICÇÃO | C — PRODUTO / DESEJO |
|---|---|---|---|
| Mensagem | Notamos que seu carrinho ficou aberto com um item separado. Ainda dá tempo de finalizar a compra quando quiser. | Vimos que você não conseguiu concluir a compra. Teve alguma dúvida ou dificuldade que possamos ajudar a resolver agora? | O item que você separou no carrinho continua disponível para você levar quando quiser finalizar. |
| CTA | Finalizar compra | Falar com atendimento | Ver item no carrinho |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## PIX_PENDING

| | A — LEMBRETE DE PAGAMENTO | B — ASSISTÊNCIA DE PAGAMENTO | C — PRAZO REAL *(degradado — sem prazo comprovado)* |
|---|---|---|---|
| Mensagem | Seu pagamento via Pix ainda está pendente de confirmação. Você pode concluir quando quiser. | Notamos que o Pix ainda não foi concluído. Teve alguma dificuldade com o QR code ou com o aplicativo do banco? | O pagamento via Pix continua disponível para você concluir quando for conveniente — é rápido e simples. |
| CTA | Ver pagamento | Pedir ajuda | Pagar agora |
| Aviso | — | — | Direção C (prazo real) degradada: nenhum prazo de expiração comprovado está disponível para este Pix — a variação gerada evita menção a prazo. |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## BOLETO_PENDING

| | A — LEMBRETE | B — FACILITAÇÃO / SEGUNDA VIA *(degradado)* | C — PRAZO REAL *(degradado)* |
|---|---|---|---|
| Mensagem | Seu boleto ainda está pendente de pagamento. Você pode concluir quando for conveniente. | Notamos que o boleto ainda não foi pago. Se precisar de ajuda para resolver o pagamento, é só responder por aqui. | O pagamento do boleto pode ser feito em qualquer banco ou lotérica, quando for conveniente para você. |
| CTA | Ver boleto | Pedir ajuda | Ver formas de pagar |
| Aviso | — | Direção B (segunda via) degradada: não há confirmação de que a reemissão do boleto está disponível para este pedido — a variação gerada oferece assistência geral no lugar. | Direção C (prazo real) degradada: nenhum vencimento comprovado está disponível para este boleto — a variação gerada evita menção a prazo. |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## VIP

| | A — CURADORIA PERSONALIZADA | B — RELACIONAMENTO | C — NOVIDADE / AFINIDADE *(sem produto candidato)* |
|---|---|---|---|
| Mensagem | Preparamos uma seleção pensada especialmente para o seu histórico de compras com a gente. | Você é um dos nossos clientes mais frequentes e queríamos agradecer por isso. | Ainda não temos uma recomendação de produto específica para você nesta janela, mas queríamos manter contato. |
| CTA | Ver seleção | Ver novidades | Responder esta mensagem |
| Aviso | — | — | Nenhum produto candidato real foi fornecido para esta direção — recomendação de produto fica pendente. |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## RECENT_CUSTOMER

| | A — CROSS-SELL COMPLEMENTAR | B — STYLE GUIDANCE | C — NOVIDADES RELACIONADAS |
|---|---|---|---|
| Mensagem | Como você comprou recentemente, separamos um complemento que combina com o que já é seu. | Preparamos algumas sugestões de como aproveitar melhor o que você comprou recentemente no dia a dia. | Chegaram novidades na mesma categoria da sua última compra, caso queira dar uma olhada. |
| CTA | Ver complemento | Ver sugestões | Ver novidades |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## ENGAGED_NO_PURCHASE

| | A — VENDA ASSISTIDA | B — CURADORIA DE OPÇÕES *(sem produto candidato)* | C — REDUÇÃO DE FRICÇÃO |
|---|---|---|---|
| Mensagem | Vimos que você conversou com a gente recentemente. Podemos continuar te ajudando a decidir? | Ainda não temos produtos candidatos específicos para sugerir nesta janela, mas ficamos à disposição para ajudar a encontrar o que procura. | Ficamos com uma dúvida: teve algo que impediu a compra da última vez que conversamos? |
| CTA | Continuar conversa | Contar o que procura | Responder aqui |
| Aviso | — | Nenhum produto candidato real foi fornecido para esta direção — apresentamos um convite geral em vez de opções específicas. | — |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## WINBACK

| | A — NOVIDADE *(sem produto candidato)* | B — AFINIDADE DE CATEGORIA | C — REDESCOBERTA / RELACIONAMENTO |
|---|---|---|---|
| Mensagem | Ainda não temos uma novidade específica de produto para compartilhar com você nesta janela, mas gostaríamos de retomar contato. | Notamos que faz um tempo desde sua última compra na categoria que você costumava explorar com a gente. | Faz um tempo que não conversamos. Gostaríamos de saber como você está e se podemos ajudar em algo. |
| CTA | Responder esta mensagem | Dar uma olhada | Responder aqui |
| Aviso | Nenhum produto candidato real foi fornecido para esta direção — apresentamos uma reconexão geral em vez de uma novidade específica. | — | — |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## REPEAT_PURCHASE

| | A — COMPLEMENTO DA COMPRA ANTERIOR | B — RENOVAÇÃO DE LOOK | C — NOVIDADES DA CATEGORIA DE AFINIDADE |
|---|---|---|---|
| Mensagem | Como faz um tempo desde sua última compra, separamos um complemento que combina bem com o que você já tem. | Preparamos ideias de como renovar o que você já tem, combinando com peças novas. | Chegaram novidades na categoria que você costuma comprar com a gente, caso queira conferir. |
| CTA | Ver complemento | Ver ideias | Ver novidades |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

---

## O que NÃO está resolvido nesta fase (limitações honestas)

- **"Sem histórico de categoria" não é um gate de código** — não existe hoje
  nenhuma fonte real de "categoria de interesse" em `Opportunity`. As direções
  de afinidade de categoria (WINBACK B, REPEAT_PURCHASE C, RECENT_CUSTOMER C)
  usam linguagem genérica de propósito; `strategyLab.test.ts` verifica que o
  próprio exemplo não inventa um nome de categoria, mas isso é garantia de
  autoria, não um bloqueio automático — não há uma lista de categorias reais
  para comparar contra ainda.
- **Tamanhos numéricos (36, 38, 40...) não são auditados** — só tamanhos por
  letra (PP/P/M/G/GG/XG/XXG). Números curtos colidem demais com preço/
  quantidade para um scanner de substring seguro; ver comentário em
  `complianceService.ts`.
- **`recommendedProduct` continua sempre `null`** — nenhuma mudança de
  arquitetura de produto foi feita nesta fase; todas as direções que dependem
  de produto real (`somente se um produto candidato real for fornecido`)
  degradam para a variação "sem produto candidato" hoje.
