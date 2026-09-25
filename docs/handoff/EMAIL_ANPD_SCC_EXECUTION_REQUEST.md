# D'Rosa Moda — solicitação de execução das Cláusulas-Padrão Contratuais da ANPD com o Resend

Data de preparação: 25/09/2026

## Objetivo

Este documento prepara a solicitação formal para que o Resend (Plus Five Five, Inc.) incorpore ao instrumento contratual aplicável à conta da D'Rosa Moda as Cláusulas-Padrão Contratuais brasileiras aprovadas pela Resolução CD/ANPD nº 19/2024, ou indique outro mecanismo válido do art. 33 da LGPD aplicável à transferência Brasil -> Estados Unidos.

Este arquivo não substitui a assinatura/aceite da contraparte e, sozinho, não abre o gate de transferência.

## Partes

### Exportador / controlador

D rosa comercio ltda  
CNPJ público no site: 66.718.918/0001-89  
Canal de contato: contato@drosamoda.com.br  
Papel: Controlador dos dados dos destinatários de marketing.

### Importador / operador

Plus Five Five, Inc. (Resend)  
2261 Market Street #5039, San Francisco, CA 94114, USA  
Contato de privacidade: privacy@resend.com  
Papel indicado no DPA do Resend para Customer Data: Processor.

## Operação

Finalidade: entrega de e-mails promocionais solicitados/autorizados por clientes da D'Rosa Moda.

Dados mínimos enviados ao provider:
- endereço de e-mail do destinatário;
- assunto e conteúdo da mensagem;
- metadados técnicos necessários à entrega;
- identificadores técnicos de tracking do envio, sem CPF, endereço postal ou telefone.

Não serão enviados dados pessoais sensíveis como parte normal do canal.

Frequência: contínua enquanto o canal estiver ativo, respeitados consentimento, suppression e cooldown.

Origem/destino: Brasil -> Estados Unidos.

## Base legal do tratamento de marketing

Para o piloto e para a ativação inicial, a D'Rosa adota CONSENTIMENTO como única base operacional do marketing por e-mail.

Não será usado legítimo interesse como fallback.

O executor:
- reconsulta a preferência atual accepts_marketing na Nuvemshop antes de cada envio;
- persiste NUVEMSHOP_CUSTOMER_API como fonte autoritativa;
- exige CONFIRMED_OPT_IN;
- bloqueia opt-out, conflito, ausência de prova, suppression e cooldown.

## Mecanismo de transferência requerido

A Resolução CD/ANPD nº 19/2024 exige mecanismo válido para a transferência internacional, além da hipótese legal do tratamento.

A preferência é incorporar integralmente, sem alteração, o Anexo II (Cláusulas-Padrão Contratuais) da Resolução CD/ANPD nº 19/2024 ao contrato/DPA aplicável à conta da D'Rosa.

Alternativamente, o Resend pode indicar outro mecanismo efetivamente aplicável e documentado nos termos do art. 33 da LGPD.

## Fundamentação contratual já existente no Resend

O DPA público do Resend informa que:
- o Customer pode ser controlador e o Resend atua como processor para Customer Data;
- as operações principais de processamento ocorrem nos Estados Unidos;
- o DPA já incorpora SCCs para UE/Reino Unido;
- a seção 6.6.4 prevê que, se a lei aplicável exigir a execução de Standard Contractual Clauses como acordo separado, o Data Importer deverá executá-las mediante solicitação do Data Exporter, com os ajustes necessários para refletir a lei aplicável e os anexos/detalhes da transferência.

A D'Rosa solicita a aplicação desse compromisso às Cláusulas-Padrão Contratuais brasileiras da ANPD.

## Evidências técnicas disponíveis

- domínio de envio autenticado;
- Resend DPA e subprocessors revisados;
- consent ledger com HMAC do e-mail;
- live consent refresh antes de cada envio;
- List-Unsubscribe e One-Click;
- suppression por opt-out/hard bounce/spam complaint;
- webhook assinado;
- idempotência/claim atômico;
- cooldown;
- piloto limitado a 20 envios por draft;
- cron desligado para o primeiro piloto.

## Ação esperada da contraparte

Responder por escrito com uma das opções:

1. confirmar e executar/incorporar as Cláusulas-Padrão Contratuais do Anexo II da Resolução CD/ANPD nº 19/2024 para a conta da D'Rosa; ou
2. identificar o mecanismo alternativo do art. 33 da LGPD efetivamente aplicável à transferência Brasil -> Estados Unidos, fornecendo documento verificável.

## Gate

Até existir documentação verificável da contraparte:

EMAIL_TRANSFER_MECHANISM_APPROVED=false  
EMAIL_LEGAL_REVIEW_APPROVED=false  
EMAIL_SEND_ENABLED=false  
EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false  
CRON_EMAIL_CAMPAIGNS_ENABLED=false

## Referências

- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Resolução CD/ANPD nº 19/2024: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024
- Resend DPA: https://resend.com/legal/dpa
- Resend GDPR/data residency: https://resend.com/security/gdpr
- Resend subprocessors: https://resend.com/legal/subprocessors
