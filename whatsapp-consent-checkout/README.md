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
3. Na página de sucesso, grava somente as decisões explícitas em
   `order.extra`, preservando metadata de terceiros.

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
