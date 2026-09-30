# WhatsApp consent — checkout extension (NubeSDK)

Extensão de checkout da loja Nuvemshop (`store_id=7716231`, D'Rosa Moda) que
captura dois opt-ins explícitos e independentes para WhatsApp:

- **transactional** — atualizações sobre o pedido;
- **marketing** — ofertas, novidades e lembretes de carrinho.

Os dois opt-ins são opcionais e desmarcados por padrão. O backend nunca
infere consentimento pelo silêncio do cliente.

## O que esta extensão faz

1. Renderiza duas checkboxes no slot `after_contact_form`:
   - "Quero receber atualizações sobre meu pedido da D'Rosa Moda pelo WhatsApp."
   - "Quero receber ofertas, novidades e lembretes de carrinho da D'Rosa Moda pelo WhatsApp."
2. Guarda cada decisão de forma independente em `asyncSessionStorage`.
3. **Ao marcar/desmarcar** cada checkbox (antes de o pedido ser concluído), despacha
   `order:add:extra` com somente as decisões explícitas. A página de sucesso é tarde demais:
   o pedido já foi criado e o webhook `order/created` já saiu com `extra={}` (comprovado no
   pedido #4459). `order:add:extra` **substitui** o objeto inteiro, então o envio parte sempre de
   `state.order.extra` atual, preservando metadata de terceiros (auditoria de 60 dias: 0 pedidos
   com chaves estrangeiras em `extra`).
4. Deduplicação por **estado da decisão** (não "um envio por instância"): mudar a decisão gera novo
   envio; repetir a mesma não reenvia. Recarregar o mesmo checkout restaura e re-materializa.
5. O id do carrinho é guardado junto da decisão; outro carrinho nunca herda a escolha anterior. No
   sucesso, um fallback envia a última decisão e limpa a sessão.
6. Silêncio nunca vira `revoked`: escopo não tocado não é enviado (backend trata como UNKNOWN).

### Marcador transactional

```json
{
  "drosa_whatsapp_transactional_version": "v1",
  "drosa_whatsapp_transactional_store_id": "<store id em runtime>",
  "drosa_whatsapp_transactional_source": "nuvemshop_checkout_whatsapp_optin",
  "drosa_whatsapp_transactional_scope": "transactional",
  "drosa_whatsapp_transactional_choice": "granted" | "revoked"
}
```

### Marcador marketing

```json
{
  "drosa_whatsapp_marketing_version": "v1",
  "drosa_whatsapp_marketing_store_id": "<store id em runtime>",
  "drosa_whatsapp_marketing_source": "nuvemshop_checkout_whatsapp_optin",
  "drosa_whatsapp_marketing_scope": "marketing",
  "drosa_whatsapp_marketing_choice": "granted" | "revoked"
}
```

Um pedido pode conter nenhum, um ou ambos os marcadores. Se o cliente não
interagir com um determinado opt-in, esse escopo permanece `UNKNOWN`.

A extensão não possui endpoint HTTP próprio. A única escrita é
`order:add:extra`; o Recovery lê esses dados somente a partir do pedido
canônico recebido da Nuvemshop.

## Regra do backend

- templates Meta `UTILITY` exigem consentimento `transactional`;
- templates Meta `MARKETING` exigem consentimento `marketing`;
- suppression/opt-out global continua prevalecendo;
- marcadores ausentes, incompletos ou divergentes falham fechado.

A tabela `whatsapp_consents` já suporta isso pela chave única
`(normalizedPhone, scope)`; não é necessária migração de banco.

## Build

```bash
npm install
npm run typecheck
npm test
npm run build
```

O bundle gerado é `dist/main.min.js`.

## Publicação

O script deve ser publicado no app NubeSDK correto no Partner Portal da
Nuvemshop, com execução no checkout. Não assuma que o app OAuth usado pelo
backend é automaticamente o mesmo app da extensão: confirme o app e a
configuração NubeSDK antes de publicar.

A documentação atual da Nuvemshop exige NubeSDK para apps que atuam no
checkout. O identificador do app é fornecido pelo host em runtime; não deve
ser hardcoded no código-fonte.

## Checklist de publicação (PR #85 em `main`)

Bundle esperado: `dist/main.min.js` gerado do `main` (`npm ci && npm run build`), **7716 bytes**,
SHA-256 `c7e04e17d07c7c026078bf0e47fdbef5afde334d031e5264d133968c595ee404`.

1. No Partner Portal, abrir o app NubeSDK **da extensão de checkout** (não assuma o app OAuth `38911`
   "D'Rosa Customer OS — Staging": ele aparece como app OAuth no handoff; confirme no portal).
2. Conferir o script atualmente publicado (versão/hash) e anotar para rollback.
3. Gerar o bundle do `main` e conferir tamanho e SHA-256 acima.
4. Enviar SOMENTE esse arquivo ao script do checkout (slot `after_contact_form`, execução no checkout).
5. Não alterar nenhum outro script, slot ou configuração do app.
6. Salvar/publicar e aguardar a propagação (limpar cache do navegador ou janela anônima).
7. Executar a validação abaixo SEM concluir pedido.
8. Rollback: republicar o script anotado no passo 2.

## Validação pós-publicação (sem criar pedido)

- Bundle carregado: a checkbox aparece no `after_contact_form` (versão nova).
- As duas checkboxes começam **desmarcadas**.
- Marcar só a transacional: `order:add:extra` é despachado ANTES do sucesso (observar pelo console/SDK:
  marcador `drosa_whatsapp_transactional_choice=granted` preparado; não registrar telefone/e-mail).
- Marketing não tocado: nenhum marcador `drosa_whatsapp_marketing_*` é gerado.
- Desmarcar/marcar de novo gera novo despacho; recarregar o checkout restaura a escolha.
- Nenhum dado pessoal em logs do console.
