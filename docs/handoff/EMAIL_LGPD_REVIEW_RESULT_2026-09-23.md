# D'Rosa Recovery — revisão LGPD do canal de e-mail

Data: 23/09/2026
Escopo: campanhas de marketing por e-mail para clientes no Brasil.

## Resultado

LGPD_REVIEW_STATUS=PENDING_EXTERNAL_TRANSFER_MECHANISM
MARKETING_LEGAL_BASIS=CONSENT_ONLY
LEGITIMATE_INTEREST_FOR_MARKETING=NOT_USED
CUSTOMER_PILOT=BLOCKED
EMAIL_TRANSFER_MECHANISM_APPROVED=false
EMAIL_LEGAL_REVIEW_APPROVED=false

Este documento é uma revisão operacional de conformidade baseada nas fontes oficiais citadas abaixo. Não se apresenta como parecer jurídico profissional.

## 1. Base legal escolhida para o piloto

Para o piloto, a D'Rosa adotará somente CONSENTIMENTO como base do marketing por e-mail.

Motivos:
- a Política de Privacidade pública já informa que promoções e novidades são enviadas sempre mediante consentimento e com opção de cancelamento;
- o recipient gate do Recovery só libera CONFIRMED_OPT_IN;
- opt-out, conflito, ausência de prova, suppression e cooldown bloqueiam;
- legítimo interesse não será usado como fallback para aumentar a audiência.

Logo, nenhum endereço sem prova de opt-in entra no piloto.

## 2. Transparência e direitos

A Política de Privacidade atual já informa:
- categorias de dados;
- finalidade de marketing mediante consentimento;
- compartilhamento com plataformas de marketing;
- cancelamento de comunicações;
- acesso, correção e exclusão quando aplicável;
- canal de atendimento.

Antes da ativação em clientes, deve ser incorporado o adendo preparado em
EMAIL_PRIVACY_POLICY_ADDENDUM_DRAFT.md, principalmente para explicitar
Resend, transferência internacional, retenção e descadastro One-Click.

## 3. Retenção adotada para o canal

Política operacional:
- Resend: retenção do plano vigente, hoje documentada pelo fornecedor como 30 dias para e-mails/logs e 7 dias para backups.
- EmailSend / EmailEventLog locais: 24 meses, com revisão anual; após o prazo, eliminar ou agregar quando não houver necessidade jurídica/segurança.
- Evidência de consentimento: manter enquanto o consentimento sustentar comunicações e por até 5 anos após o último evento relevante, exclusivamente para prestação de contas/defesa, com revisão de necessidade.
- Suppression/opt-out: manter o hash HMAC enquanto o programa de marketing existir para impedir reenvio indevido; não armazenar plaintext no ledger de suppression.
- Dados de pedido/fiscais seguem sua própria obrigação legal e não são abrangidos pela política de retenção de marketing acima.

Os prazos internos acima são decisões de governança da D'Rosa, não prazos legais atribuídos à LGPD.

## 4. Direitos do titular

Canal operacional: contato@drosamoda.com.br e WhatsApp oficial já publicado na política.

Processo:
1. registrar a solicitação;
2. autenticar de forma proporcional ao pedido;
3. localizar os dados e sistemas envolvidos;
4. aplicar acesso/correção/revogação/eliminação/bloqueio quando cabível;
5. preservar somente o que tiver fundamento de retenção;
6. registrar resposta e data;
7. garantir que opt-out de marketing seja imediato no ledger/suppression.

## 5. Incidentes

Para incidente que possa acarretar risco ou dano relevante:
- triagem imediata;
- preservar evidências;
- conter e mitigar;
- avaliar categorias/volume/titulares/impacto;
- comunicar ANPD e titulares em até 3 dias úteis, quando aplicável;
- manter registro do incidente por pelo menos 5 anos.

Runbook detalhado: EMAIL_PRIVACY_INCIDENT_RUNBOOK.md.

## 6. Transferência internacional — BLOQUEIO REAL

O Resend informa atualmente:
- armazenamento de dados de clientes nos Estados Unidos;
- conteúdo de mensagem, endereço de e-mail, logs e webhooks podem ser armazenados;
- região de envio (inclusive São Paulo) não muda a residência dos dados;
- o DPA público incorpora mecanismos para UE/Reino Unido, mas não demonstra incorporação das cláusulas-padrão da ANPD para Brasil.

A ANPD informa atualmente:
- a União Europeia é adequada para transferências do Brasil;
- os Estados Unidos não constam como jurisdição adequada;
- não há cláusulas equivalentes/específicas ou normas corporativas globais de terceiros aprovadas no repositório da ANPD;
- para transferir a país não adequado é necessário um mecanismo válido do art. 33 da LGPD/Resolução 19.

Conclusão operacional: não há evidência suficiente para marcar a transferência Brasil -> Resend/Estados Unidos como aprovada.

Por isso foi adicionado um gate independente:
EMAIL_TRANSFER_MECHANISM_APPROVED=false

Mesmo se alguém ligar EMAIL_SEND_ENABLED e aprovar a revisão jurídica, o dispatcher continua bloqueado.

## 7. Ação externa já iniciada

Foi enviado pedido ao canal de privacidade do Resend solicitando confirmação/documento de:
- cláusulas-padrão contratuais brasileiras da Resolução 19/2024 incorporadas ao contrato; ou
- outro mecanismo atualmente válido sob o art. 33 da LGPD para Brasil -> Estados Unidos.

Até resposta/documento verificável:
CUSTOMER_SEND=BLOCKED

## Fontes oficiais / fornecedor

- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- ANPD — Transferência Internacional: https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados
- ANPD — Resolução 19/2024: https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024
- ANPD — Direitos dos Titulares: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares
- ANPD — Incidentes: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
- Resend DPA: https://resend.com/legal/dpa
- Resend subprocessors: https://resend.com/legal/subprocessors
- Resend GDPR/data residency: https://resend.com/security/gdpr

## 8. Atualização final de 24/09/2026

### Auditoria viva da preferência atual na Nuvemshop

A consulta read-only foi repetida contra o endpoint de customers da loja, com paginação completa e sem persistir PII no relatório.

- customers lidos: 4.408
- accepts_marketing=true: 3.207
- accepts_marketing=false: 1.201
- accepts_marketing ausente/nulo: 0
- accepts_marketing_updated_at presente: 4.408
- rate-limit errors: 0
- base do CRM comparada: 4.016
- encontrados na API viva: 3.433
- stale opt-in histórico detectado: 1
- opt-ins recuperados por estado atual: 162

O executor em produção já faz revalidação individual imediatamente antes de cada envio e grava NUVEMSHOP_CUSTOMER_API como fonte autoritativa. Ausência de cliente, preferência desconhecida/timestamp inválido ou erro upstream bloqueiam o destinatário.

### Produção

Revisão live: drosa-recovery-email-lgpd-v3 (100% do tráfego).

Gates confirmados:
- EMAIL_MARKETING_CONSENT_SOURCE=CONFIGURED
- EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED=true
- EMAIL_DOMAIN_AUTHENTICATED=true
- EMAIL_PROVIDER=resend
- EMAIL_TRANSFER_MECHANISM_APPROVED=false
- EMAIL_LEGAL_REVIEW_APPROVED=false
- EMAIL_SEND_ENABLED=false
- EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false
- CRON_EMAIL_CAMPAIGNS_ENABLED=false

Health checks: /health=200, /health/deep=200, /crm=200.

### Solicitação formal ao Resend

Foi enviado em 24/09/2026 um pedido formal ao contato de privacidade do Resend solicitando comprovação do mecanismo válido para Brasil -> Estados Unidos sob o art. 33 da LGPD e Resolução CD/ANPD 19/2024, inclusive confirmação de adoção das cláusulas-padrão brasileiras ou outro mecanismo aplicável.

Até resposta/documento verificável:

EMAIL_TRANSFER_MECHANISM_APPROVED=false
EMAIL_LEGAL_REVIEW_APPROVED=false
CUSTOMER_SEND=BLOCKED
CUSTOMER_PILOT=BLOCKED

Esse bloqueio é deliberado e não é uma pendência técnica interna; depende de documentação/aceite externo do provedor ou troca por arquitetura/provedor com mecanismo internacional válido.

## 9. Atualização operacional de 25/09/2026

### Auditoria viva repetida

A auditoria read-only da preferência atual foi repetida contra a API de customers da Nuvemshop com o token de produção, sem imprimir credenciais e sem persistir PII no relatório.

- páginas lidas: 23
- customers lidos: 4.442
- accepts_marketing=true: 3.242
- accepts_marketing=false: 1.200
- preferência nula/ausente: 0
- accepts_marketing_updated_at presente: 4.442
- customers sem e-mail: 0
- linhas com e-mail duplicado: 1
- base CRM comparada: 4.052
- encontrados na API viva: 3.464
- não encontrados na API viva: 588
- estado vivo opt-in entre encontrados: 2.376
- estado vivo opt-out entre encontrados: 1.088
- DB_TRUE_LIVE_FALSE: 1
- DB_FALSE_LIVE_TRUE: 172
- stale opt-in histórico: 1
- opt-ins recuperados pelo estado atual: 172
- erros de rate limit: 0

Conclusão: o snapshot histórico continua inadequado como prova isolada para envio, mas o risco já está mitigado tecnicamente porque o executor reconsulta a preferência viva de cada destinatário imediatamente antes do recipient gate.

### Escopo de conteúdo da Nuvemshop

Foi tentada somente leitura de Pages nas versões v1 e 2025-03 para localizar a Política de Privacidade e publicar o adendo preparado. Ambas responderam HTTP 403.

Conclusão: o app/token atual não possui read_content (e, portanto, não há evidência de write_content). Nenhuma reautorização OAuth foi feita e nenhuma página pública foi alterada. A publicação do adendo permanece uma ação externa/de permissão, não uma falha do canal de e-mail.

### Política pública observada

A página pública /politica-de-privacidade/ já declara marketing apenas mediante consentimento, cancelamento, compartilhamento com plataformas de marketing e direitos básicos do titular. Ela ainda não explicita o Resend, destino internacional nos Estados Unidos, mecanismo de transferência, retenção do canal de e-mail ou List-Unsubscribe/One-Click.

O adendo em EMAIL_PRIVACY_POLICY_ADDENDUM_DRAFT.md deve ser incorporado antes de liberar o piloto.

### Resend — mecanismo internacional

Foram confirmadas cinco solicitações de privacidade/conformidade entregues ao endereço privacy@resend.com entre 24 e 25/09/2026, incluindo pedido expresso para:

- incorporar as cláusulas-padrão contratuais brasileiras do Anexo II da Resolução CD/ANPD nº 19/2024; ou
- indicar e comprovar outro mecanismo válido do art. 33 da LGPD para Brasil -> Estados Unidos.

A solicitação mais recente foi entregue em 25/09/2026 às 16:10 UTC. Não há, até esta atualização, documento verificável de contraparte incorporando as cláusulas brasileiras nem outro mecanismo aplicável comprovado para esta conta.

Por isso permanecem obrigatoriamente:

EMAIL_TRANSFER_MECHANISM_APPROVED=false
EMAIL_LEGAL_REVIEW_APPROVED=false
EMAIL_SEND_ENABLED=false
EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false
CRON_EMAIL_CAMPAIGNS_ENABLED=false
CUSTOMER_SEND=BLOCKED
CUSTOMER_PILOT=BLOCKED

### Fechamento interno

TECHNICAL_EMAIL_READINESS=COMPLETE
LIVE_CONSENT_REVALIDATION=PASS
INTERNAL_E2E=PASS
PRODUCTION_GATES=FAIL_CLOSED
EXTERNAL_TRANSFER_MECHANISM=PENDING
PRIVACY_POLICY_ADDENDUM_PUBLICATION=PENDING_CONTENT_SCOPE

Nenhuma campanha de clientes deve ser enviada enquanto os dois bloqueios externos acima não estiverem resolvidos e documentados.
