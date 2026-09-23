# D'Rosa Recovery — fechamento técnico do canal de e-mail

Data: 23/09/2026

## Estado final técnico

- Banco/consentimento: concluído.
- Backfill/idempotência: concluídos e validados.
- Suppression/unsubscribe/tracking: implementados.
- Provider: Resend.
- Domínio de envio: mail.drosamoda.com.br.
- SPF/DKIM: verificados no Resend.
- DMARC: publicado no domínio raiz.
- Webhook assinado: ativo e validado.
- Cloud Run live: drosa-recovery-email-complete-v1, 100% do tráfego.
- Executor de campanhas: implementado e integrado à main.
- Executor/cron em produção: desligados por default.
- Envio real para clientes: bloqueado.

## E2E interno comprovado pelo próprio Recovery

Foi executado um canário interno controlado para contato@drosamoda.com.br, sem abrir os gates de campanha.

Fluxo exercitado:
Recovery -> EmailSend -> emailDispatcher -> Resend -> webhook -> EmailEventLog

Resultado:
- HTTP do canário: 200.
- finalStatus=DELIVERED.
- eventos persistidos: SENT, DELIVERED.
- providers registrados: CRM, resend.
- sendId=cmuehyd34000156t2paa2csue.
- EMAIL_SEND_ENABLED=false durante o teste.
- EMAIL_LEGAL_REVIEW_APPROVED=false durante o teste.
- rota canário/tag temporária removida após o teste.

O teste usou somente o endereço interno controlado e não enviou campanha a clientes.

## Executor de campanhas

O executor em src/services/emailCampaignExecutor.ts:
- processa apenas drafts EMAIL em SCHEDULED/RUNNING;
- resolve audiência no momento da execução;
- aplica recipient gate por endereço;
- exige consentimento elegível;
- bloqueia suppression;
- aplica cooldown;
- reserva/claim atômico em EmailSend;
- envia exclusivamente via emailDispatcher;
- emite List-Unsubscribe / One-Click por destinatário;
- registra EmailSend / EmailEventLog;
- possui batch size e cap máximo de piloto;
- possui endpoint protegido POST /jobs/process-email-campaigns;
- possui cron separado, desligado por default.

Probe de produção autenticado após o deploy:
- HTTP 409;
- enabled=false;
- processedDrafts=0;
- blockedBy=EMAIL_CAMPAIGN_EXECUTOR_DISABLED.

## Gates em produção

EMAIL_MARKETING_CONSENT_SOURCE=CONFIGURED
EMAIL_UNSUBSCRIBE_SUPPRESSION_IMPLEMENTED=true
EMAIL_DOMAIN_AUTHENTICATED=true
EMAIL_PROVIDER=resend

EMAIL_LEGAL_REVIEW_APPROVED=false
EMAIL_SEND_ENABLED=false
EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false
CRON_EMAIL_CAMPAIGNS_ENABLED=false

Esses quatro últimos controles impedem qualquer piloto de clientes até autorização posterior.

## Revisão jurídica / LGPD

Pacote técnico para revisão: docs/handoff/EMAIL_LGPD_REVIEW_PACKET.md.

A revisão técnica foi concluída, mas a aplicação não declara aprovação jurídica em nome da D'Rosa. A flag EMAIL_LEGAL_REVIEW_APPROVED só deve mudar para true após aprovação documentada por responsável jurídico/privacidade.

Pontos que exigem decisão/validação humana:
1. finalidade de marketing por e-mail;
2. base legal por origem da base;
3. suficiência da evidência histórica de opt-in;
4. texto/forma dos pontos de coleta;
5. Política/Aviso de Privacidade;
6. retenção;
7. processo de direitos dos titulares;
8. tratamento de transferência internacional via Resend;
9. procedimento de incidentes;
10. autorização do piloto.

Referências oficiais:
- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- ANPD — Legítimo Interesse: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse
- ANPD — Transferência Internacional: https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados
- ANPD — Incidentes: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis
- Resend DPA: https://resend.com/legal/dpa
- Resend subprocessors: https://resend.com/legal/subprocessors

## Piloto preparado, mas não executado

Depois da aprovação jurídica documentada, a sequência segura é:
1. manter CRON_EMAIL_CAMPAIGNS_ENABLED=false;
2. habilitar EMAIL_LEGAL_REVIEW_APPROVED=true;
3. habilitar EMAIL_SEND_ENABLED=true;
4. habilitar EMAIL_CAMPAIGN_EXECUTOR_ENABLED=true;
5. manter EMAIL_CAMPAIGN_MAX_TOTAL_SENDS=20;
6. selecionar/aprovar humanamente um único draft;
7. executar manualmente POST /jobs/process-email-campaigns;
8. conferir delivery, bounce, complaint, unsubscribe e suppression;
9. desligar novamente o executor se houver qualquer anomalia;
10. somente após o piloto manual decidir sobre o cron.

## Resultado

TECHNICAL_EMAIL_READINESS=COMPLETE
INTERNAL_E2E=PASS
CUSTOMER_SEND=BLOCKED
LEGAL_REVIEW_REQUIRED=YES
CUSTOMER_PILOT_EXECUTED=NO

Nenhuma campanha de cliente deve ser executada enquanto EMAIL_LEGAL_REVIEW_APPROVED=false.
