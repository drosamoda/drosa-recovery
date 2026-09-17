# Strategy Lab v1.1 — Exemplos por tipo de oportunidade (Truth Hardening)

Estes exemplos vêm literalmente da mesma fonte usada pelos testes automatizados
(`src/__tests__/fixtures/strategyLabFixtures.ts`) — não são texto solto de
documentação, são o conteúdo que `strategyLab.test.ts` verifica a cada rodada
de `npm test`. Se o texto aqui divergir do arquivo de fixture, é a fixture
que está certa; abra uma issue.

**v1.1 corrigiu falsos positivos de Product Truth**: a v1 tinha exemplos que
soavam naturais mas afirmavam coisas que os dados atuais não sustentam —
"o item continua disponível" (implica estoque sem prova), "separamos um
complemento" (implica produto real sem `candidateProducts`), "chegaram
novidades da mesma categoria" (implica histórico de categoria que não existe).
Nenhum desses passa mais: `complianceService.auditClaimCategories` bloqueia
qualquer frase que pressuponha um fato sem a `EvidenceFlags` correspondente,
mesmo sem usar nenhuma palavra da lista de termos proibidos.

Como `candidateProducts` é sempre `[]` no sistema real hoje e nenhuma fonte de
categoria/estoque/novidade/prazo de pagamento comprovado existe, **a maioria
das direções abaixo está no seu estado degradado — que é o único estado
honesto possível agora**, não uma falha. Isso é esperado, testado e
documentado, não um "modo de erro".

Para cada tipo: `PRODUCT_TRUTH`, `COMPLIANCE` (palavra proibida) e `COMPLIANCE`
(claim implícita) e `CREATIVE_DISTANCE` = PASS significa que
`strategyLab.test.ts` roda os gates reais do código (`auditAllStrategies`,
`auditClaimCategories`, `evaluateCreativeDistance`, `auditDirectionAdherence`)
contra este exato conteúdo e não encontra nenhum finding.

---

## ABANDONED_CART

| | A — RECUPERAÇÃO DIRETA | B — ASSISTÊNCIA / REDUÇÃO DE FRICÇÃO | C — PRODUTO / DESEJO *(degradado — sem estoque comprovado)* |
|---|---|---|---|
| Mensagem | Notamos que seu carrinho ficou aberto com um item separado. Ainda dá tempo de finalizar a compra quando quiser. | Vimos que você não conseguiu concluir a compra. Teve alguma dúvida ou dificuldade que possamos ajudar a resolver agora? | Vimos que você demonstrou interesse por algo em nossa loja recentemente. Ficamos à disposição se quiser continuar de onde parou. |
| CTA | Finalizar compra | Falar com atendimento | Continuar de onde parei |
| Aviso | — | — | Direção C (produto/desejo) degradada: nenhuma confirmação real de estoque está disponível para o item deste carrinho — a variação gerada evita afirmar disponibilidade. |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## PIX_PENDING

| | A — LEMBRETE DE PAGAMENTO *(neutro)* | B — ASSISTÊNCIA DE PAGAMENTO | C — PRAZO REAL *(degradado — sem prazo comprovado)* |
|---|---|---|---|
| Mensagem | Identificamos que o pagamento via Pix deste pedido ainda consta como pendente. | Notamos que o Pix ainda não foi concluído. Teve alguma dificuldade com o QR code ou com o aplicativo do banco? | Para confirmar a situação atual do seu pagamento via Pix, é só nos chamar por aqui. |
| CTA | Ver situação do pagamento | Pedir ajuda | Falar com atendimento |
| Aviso | — | — | Direção C (prazo real) degradada: nenhum prazo de expiração comprovado está disponível para este Pix — a variação gerada evita implicar que o pagamento continua válido. |

Nenhuma das três implica que o Pix "continua válido" ou "pode ser pago quando
quiser" — essa é exatamente a claim que `auditClaimCategories` (categoria
`payment_validity`) bloqueia sem `hasPaymentExpiryEvidence`.

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## BOLETO_PENDING

| | A — LEMBRETE *(neutro)* | B — FACILITAÇÃO / SEGUNDA VIA *(degradado)* | C — PRAZO REAL *(degradado)* |
|---|---|---|---|
| Mensagem | Identificamos que o pedido ainda consta com boleto pendente de pagamento. | Notamos que o boleto deste pedido ainda não foi pago. Fale com a gente para verificar a situação e ver como podemos ajudar. | Para confirmar a situação atual do seu boleto, é só chamar a gente por aqui. |
| CTA | Ver situação | Falar com atendimento | Ver situação do boleto |
| Aviso | — | Direção B (segunda via) degradada: não há confirmação de que a reemissão do boleto está disponível para este pedido — a variação gerada evita implicar que o pagamento ainda é possível. | Direção C (prazo real) degradada: nenhum vencimento comprovado está disponível para este boleto — a variação gerada evita implicar que o pagamento continua válido. |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## VIP

| | A — CURADORIA PERSONALIZADA *(degradado — sem produto candidato)* | B — RELACIONAMENTO | C — NOVIDADE / AFINIDADE *(degradado — sem produto candidato)* |
|---|---|---|---|
| Mensagem | Analisando seu histórico com a gente, você tem um perfil de compras que valorizamos bastante. | Você é um dos nossos clientes mais frequentes e queríamos agradecer por isso. | Ainda não temos uma recomendação de produto específica para compartilhar com você nesta janela, mas gostaríamos de manter contato. |
| CTA | Ver catálogo atual | Responder esta mensagem | Falar com a gente |
| Aviso | Direção A (curadoria personalizada) degradada: nenhum produto candidato real foi fornecido — a variação gerada reconhece o perfil de compra sem afirmar uma curadoria específica. | — | Direção C (novidade / afinidade de categoria) degradada: nenhum produto candidato real foi fornecido — a variação gerada mantém contato sem afirmar novidade. |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## RECENT_CUSTOMER

| | A — CROSS-SELL COMPLEMENTAR *(degradado)* | B — STYLE GUIDANCE *(degradado)* | C — NOVIDADES RELACIONADAS *(degradado)* |
|---|---|---|---|
| Mensagem | Obrigado por comprar com a gente recentemente! Ficamos à disposição se precisar de qualquer coisa. | Preparamos algumas dicas gerais de cuidado e estilo que podem ser úteis no dia a dia. | Enquanto isso, você pode dar uma olhada no que temos disponível no catálogo atual. |
| CTA | Responder esta mensagem | Ver dicas | Ver catálogo |
| Aviso | Direção A (cross-sell complementar) degradada: nenhum produto candidato real foi fornecido — a variação gerada foca em relacionamento pós-compra, sem afirmar um complemento específico. | Direção B (style guidance) degradada: nenhum produto candidato real foi fornecido — a variação gerada oferece orientação geral, sem citar um item específico. | Direção C (novidades relacionadas) degradada: nenhuma evidência real de categoria está disponível — a variação gerada convida a conhecer o catálogo atual, sem afirmar relação com a compra anterior. |

As 3 direções deste tipo dependem de produto/categoria real — sem isso, as 3
degradam. É o caso mais extremo do Truth Hardening: nenhuma das 3 pode usar a
sua versão "plena" hoje.

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## ENGAGED_NO_PURCHASE

| | A — VENDA ASSISTIDA | B — CURADORIA DE OPÇÕES *(degradado — sem produto candidato)* | C — REDUÇÃO DE FRICÇÃO |
|---|---|---|---|
| Mensagem | Vimos que você conversou com a gente recentemente. Podemos continuar te ajudando a decidir? | Ainda não temos produtos candidatos específicos para sugerir nesta janela, mas ficamos à disposição para ajudar a encontrar o que procura. | Ficamos com uma dúvida: teve algo que impediu a compra da última vez que conversamos? |
| CTA | Continuar conversa | Contar o que procura | Responder aqui |
| Aviso | — | Direção B (curadoria de opções) degradada: nenhum produto candidato real foi fornecido — a variação gerada convida o cliente a detalhar o que procura, em vez de apresentar opções. | — |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## WINBACK

| | A — NOVIDADE *(degradado)* | B — AFINIDADE DE CATEGORIA *(degradado)* | C — REDESCOBERTA / RELACIONAMENTO |
|---|---|---|---|
| Mensagem | Ainda não temos uma novidade específica de produto para compartilhar com você nesta janela, mas gostaríamos de retomar contato. | Notamos que faz um tempo desde sua última compra com a gente. | Faz um tempo que não conversamos. Gostaríamos de saber como você está e se podemos ajudar em algo. |
| CTA | Responder esta mensagem | Dar uma olhada | Responder aqui |
| Aviso | Direção A (novidade) degradada: nenhum produto candidato real foi fornecido — a variação gerada reabre contato sem afirmar novidade específica. | Direção B (afinidade de categoria) degradada: nenhuma evidência real de categoria está disponível — a variação gerada se baseia apenas no tempo de inatividade, sem citar categoria. | — |

Repare que B não menciona nenhuma categoria — antes dizia "a categoria que
você costumava explorar", uma claim que nenhum dado comprova hoje.

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

## REPEAT_PURCHASE

| | A — COMPLEMENTO DA COMPRA ANTERIOR *(degradado)* | B — RENOVAÇÃO DE LOOK *(degradado)* | C — NOVIDADES DA CATEGORIA DE AFINIDADE *(degradado)* |
|---|---|---|---|
| Mensagem | Faz um tempo desde sua última compra com a gente. Ficamos à disposição se precisar de algo. | Preparamos algumas inspirações gerais de composição que podem ser úteis para renovar o visual. | Enquanto isso, você pode conferir o que temos disponível no catálogo atual. |
| CTA | Responder esta mensagem | Ver inspirações | Ver catálogo atual |
| Aviso | Direção A (complemento da compra anterior) degradada: nenhum produto candidato real foi fornecido — a variação gerada retoma o relacionamento, sem afirmar um complemento específico. | Direção B (renovação de look) degradada: nenhum produto candidato real foi fornecido — a variação gerada oferece inspiração geral, sem afirmar combinação específica. | Direção C (novidades da categoria de afinidade) degradada: nenhuma evidência real de categoria está disponível — a variação gerada convida a ver o catálogo atual, sem afirmar relação com a categoria de afinidade. |

`PRODUCT_TRUTH=PASS` `COMPLIANCE=PASS` `CREATIVE_DISTANCE=PASS`

---

## As 6 flags de evidência (`EvidenceFlags`)

| Flag | Comprova | Fonte real hoje |
|---|---|---|
| `hasCandidateProducts` | Existe produto candidato real | `candidateProducts.length > 0` — dinâmica, mas sempre `false` porque `campaignService.ts` chama `buildPromptInput(opportunity, [])` |
| `hasCategoryEvidence` | Categoria de interesse/afinidade comprovada | Nenhuma — `Opportunity` não carrega categoria |
| `hasStockEvidence` | Estoque confirmado para o item específico | Nenhuma — sem modelo de produto por pedido |
| `hasNewnessEvidence` | Existe novidade real a comunicar | Nenhuma |
| `hasPaymentExpiryEvidence` | Prazo/vencimento real comprovado | Nenhuma — `Order`/`Opportunity` não carregam prazo |
| `hasSecondCopySupport` | Segunda via de boleto disponível | Nenhuma |
| `hasPromotionEvidence` | Promoção/desconto real ativo | Nenhuma |

Quando uma fonte real existir para qualquer uma destas, o único lugar a mudar
é `computeEvidenceFlags()` em `campaignService.ts` — o playbook e o auditor de
claims já sabem o que fazer com `true`.

## O que NÃO está resolvido nesta fase (limitações honestas)

- **Tamanhos numéricos (36, 38, 40...) não são auditados** — só tamanhos por
  letra (PP/P/M/G/GG/XG/XXG). Números curtos colidem demais com preço/
  quantidade para um scanner de substring seguro; ver comentário em
  `complianceService.ts`.
- **`recommendedProduct` continua sempre `null`** — nenhuma mudança de
  arquitetura de produto foi feita nesta fase.
- **`auditClaimCategories` é baseado em frases, não em compreensão semântica**
  — cobre as frases identificadas nesta rodada de revisão, não é uma garantia
  formal de que nenhuma outra forma de dizer a mesma claim implícita escape.
  Novas frases identificadas devem ser adicionadas a `CLAIM_CATEGORY_RULES`.
