# WhatsApp marketing consent — checkout extension (NubeSDK)

Extensão de checkout da loja Nuvemshop (`store_id=7716231`, D'Rosa Moda) que
captura o opt-in explícito de marketing via WhatsApp. Ver
`DROSA_CRM_HANDOFF_CLAUDE.md` (raiz do monorepo de projetos) para a
arquitetura completa e o protocolo aceito pelo backend
(`src/services/whatsappConsentService.ts` em `drosa-recovery`).

## O que esta extensão faz

1. Renderiza uma checkbox **opcional**, **desmarcada por padrão**, no slot
   `after_contact_form` (início do checkout). Nunca bloqueia o checkout.
2. Guarda a decisão do cliente (se houver) em `asyncSessionStorage` — nunca
   em `order.extra` diretamente nessa etapa, porque `state.order` só existe
   na página de sucesso.
3. Na página de sucesso do checkout, se (e somente se) o cliente
   interagiu explicitamente com a checkbox, grava um protocolo fixo em
   `order.extra` via `order:add:extra`:

   ```json
   {
     "drosa_whatsapp_marketing_version": "v1",
     "drosa_whatsapp_marketing_store_id": "<store id em runtime>",
     "drosa_whatsapp_marketing_source": "nuvemshop_checkout_whatsapp_optin",
     "drosa_whatsapp_marketing_scope": "marketing",
     "drosa_whatsapp_marketing_choice": "granted" | "revoked"
   }
   ```

   Se o cliente nunca tocar na checkbox, **nada é enviado** — o backend
   nunca recebe o marcador e o consentimento permanece `UNKNOWN` (nunca é
   inferido a partir do silêncio do cliente).

4. **Não existe nenhum endpoint HTTP próprio.** A única via de escrita é
   `order.extra`, lido pelo backend somente depois de (a) um webhook
   Nuvemshop com HMAC válido e (b) o pedido canônico correspondente — nunca
   a partir de dados soltos enviados pelo navegador.

## Build

```bash
npm install
npm run typecheck
npm test
npm run build   # gera dist/main.min.js
```

## Deploy — pendências externas (fora do alcance deste código)

O bundle `dist/main.min.js` só passa a valer em produção depois de passos
que exigem acesso ao Partner Portal da Nuvemshop e não podem ser concluídos
por este agente:

- Confirmar que o app (`NUBE_APP_ID` — ainda não fornecido/confirmado) está
  instalado e autorizado na loja `7716231`.
- Confirmar que a flag **"Uses NubeSDK"** está habilitada para esse app no
  Partner Portal.
- Publicar/registrar este script como o script do app no Partner Portal
  (o mecanismo exato de upload/registro depende da conta do app, que não
  está disponível aqui).

Sem esses três itens, o código acima está pronto e testado, mas não estará
rodando na loja. `NUBE_APP_ID` é injetado pelo host da Nuvemshop em runtime
(`self.__APP_DATA__.id`) — o código-fonte da extensão não precisa (e não
deve) hardcodar esse valor.
