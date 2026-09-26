# D'Rosa Recovery — Registro de decisão humana LGPD / Email Marketing

Data de preparação: 26/09/2026

> Este documento registra a decisão de um responsável humano autorizado após revisão jurídica/privacidade. Ele NÃO constitui aprovação enquanto os campos de decisão e responsável não forem preenchidos por uma pessoa.

## Estado técnico já verificado

- Canal de e-mail tecnicamente implementado e fail-closed.
- Consentimento operacional baseado somente em opt-in confirmado.
- Revalidação viva da preferência na Nuvemshop antes do envio.
- Suppression, List-Unsubscribe e One-Click implementados.
- Resend configurado e domínio autenticado.
- Aviso público específico em `/privacy/email-marketing`.
- Piloto técnico limitado a 20 destinatários.
- Cron de e-mail permanece desligado.

## Evidência obrigatória antes da aprovação

- [ ] Resposta/documento do Resend recebido e arquivado.
- [ ] Mecanismo de transferência internacional Brasil -> EUA identificado.
- [ ] Documento account-specific ou instrumento contratual aplicável confirmado.
- [ ] Necessidade de assinatura/aceite adicional resolvida.
- [ ] DPA/subprocessadores/localizações revisados.
- [ ] Política de retenção aprovada.
- [ ] Adendo da política geral da D'Rosa aprovado para publicação.
- [ ] Canal de exercício de direitos confirmado.
- [ ] Processo de incidente revisado.
- [ ] Piloto de até 20 destinatários expressamente autorizado.

## Decisão sobre transferência internacional

Mecanismo utilizado:

`PENDING_FINAL_TRANSFER_MECHANISM`

Documento/evidência de suporte:

`PENDING_DOCUMENTARY_EVIDENCE`

Conclusão do revisor:

`PENDING_HUMAN_REVIEW`

## Decisão final do responsável humano

Marcar apenas uma opção:

- [ ] APROVADO para piloto controlado de até 20 destinatários.
- [ ] APROVADO COM CONDIÇÕES — descrever abaixo.
- [ ] NÃO APROVADO — manter canal bloqueado.

Condições/observações:

```text
PREENCHER PELO RESPONSÁVEL HUMANO
```

Responsável pela decisão:

`PREENCHER`

Função/cargo:

`PREENCHER`

Data da decisão:

`PREENCHER`

Referência do parecer/documento, se houver:

`PREENCHER`

## Regra operacional

Enquanto este documento não contiver decisão humana válida e o mecanismo de transferência não estiver documentado:

```text
EMAIL_TRANSFER_MECHANISM_APPROVED=false
EMAIL_LEGAL_REVIEW_APPROVED=false
EMAIL_SEND_ENABLED=false
EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false
CRON_EMAIL_CAMPAIGNS_ENABLED=false
```

Mesmo após aprovação humana, qualquer ativação das flags deve ocorrer em mudança operacional separada, com pre-flight e auditoria.

`LEGAL_APPROVAL_RECORDED=NO`

`CUSTOMER_PILOT_AUTHORIZED=NO`
