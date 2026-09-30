# CTA "Continuar minha compra pelo WhatsApp" — artefato para o carrinho (NÃO publicado)

Preparação apenas. Nada é publicado na Nuvemshop/Partner Portal sem aprovação.

- Texto do botão: **Continuar minha compra pelo WhatsApp**
- Slot preferido (NubeSDK, carrinho): `after_go_to_checkout` (ação secundária ao checkout).
  Antes de publicar, confirmar que o slot existe no tema Recife, no carrinho AJAX e em `/comprar`.
  Se não existir, inserção mínima no tema.
- Link: `https://wa.me/<NÚMERO_E164>?text=<mensagem codificada>`
  - Mensagem pré-preenchida (a cliente aperta Enviar): `Oi! Quero continuar minha compra na D'Rosa pelo WhatsApp.`
    → `Oi!%20Quero%20continuar%20minha%20compra%20na%20D%27Rosa%20pelo%20WhatsApp.`
  - `<NÚMERO_E164>` = exatamente o número exibido do `META_PHONE_NUMBER_ID` (o configurado termina em `…4855`).
    **Confirmar o número completo no console da Meta antes de publicar** (o CRM só guarda a versão mascarada).
- O texto canônico acima é o que o backend reconhece (`isCartRecoveryIntent`: sem acento/caixa/pontuação,
  contém "continuar minha compra"). Se o texto mudar aqui, o marcador do backend precisa continuar presente.

## Ativação no backend (tudo fail-closed)
1. `CUSTOMER_INITIATED_RECOVERY_ENABLED=true` (padrão `false`: webhook não registra, job não faz nada).
2. `INBOX_SEND_DRY_RUN=false` para a resposta sair de verdade (com `true` o job apenas simula e consome a intenção).
3. Scheduler de `POST /jobs/process-customer-recovery` só via OIDC (nunca `JOBS_SECRET` estático).
4. `AUTOMATION_ALLOWED_TEMPLATES` deve estar preenchida em produção: as intenções vivem em `message_logs`
   (template `customer_initiated_cart_recovery`) e a allowlist as mantém fora do `process-messages`.
