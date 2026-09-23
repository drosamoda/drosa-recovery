# D'Rosa Recovery — Pacote de revisão jurídica/LGPD do canal de e-mail

Data técnica: 23/09/2026

> Documento técnico para revisão por profissional jurídico/privacidade. Não substitui parecer jurídico e não declara uma base legal como válida.

## Estado técnico
- Resend configurado; `mail.drosamoda.com.br` autenticado.
- Consent ledger, suppression, One-Click unsubscribe, tracking e recipient gate implementados.
- `EMAIL_SEND_ENABLED=false`.
- `EMAIL_LEGAL_REVIEW_APPROVED=false`.
- `EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false`.
- `CRON_EMAIL_CAMPAIGNS_ENABLED=false`.
- Cap inicial preparado: 20 reservas/envios por draft.

## Dados e minimização
O endereço de e-mail em texto é usado apenas em memória na resolução da audiência e no envio. Os novos ledgers usam HMAC-SHA256 do e-mail com `EMAIL_HASH_PEPPER`. A inteligência de campanha usa agregados; não envia e-mail, nome, telefone, CPF ou número de pedido à IA.

## Consentimento e elegibilidade
O recipient gate exige `CONFIRMED_OPT_IN`; estados desconhecidos/conflitantes, opt-out, suppression, cooldown ou falha de consulta bloqueiam.

O revisor jurídico deve confirmar por origem da base:
- hipótese legal e finalidade específica;
- suficiência da evidência histórica;
- origens a excluir;
- prova/documentação necessária;
- se houver legítimo interesse, teste de finalidade, necessidade, balanceamento e salvaguardas.

## Transparência, direitos e retenção
Revisar Política/Aviso de Privacidade e pontos de coleta: finalidade, controlador/contato, compartilhamentos, retenção, direitos, opt-out e eventual transferência internacional. Confirmar processo para acesso, correção, eliminação/bloqueio quando aplicável, portabilidade, informação, revogação e oposição.

## Descadastro e suppression
Implementados `List-Unsubscribe`, One-Click, token HMAC, POST de descadastro, hard bounce/spam complaint e bloqueio de suprimidos. Aprovar texto visível e política de retenção da suppression.

## Segurança/governança
- secrets no Google Secret Manager;
- webhook assinado e raw body verificado;
- idempotência e claim atômico;
- cooldown de 72h;
- aprovação humana antes de SCHEDULED;
- IA não escolhe audiência;
- logs do executor sem destinatário;
- executor e cron desligados por default.

## Resend / transferência internacional
Revisar DPA/termos, papel do Resend/suboperadores, localizações, retenção, segurança e eventual transferência internacional, inclusive mecanismo aplicável conforme LGPD e Resolução CD/ANPD nº 19/2024.

## Incidentes
Validar procedimento, registro, critérios de risco/dano relevante, responsáveis e prazos de comunicação aplicáveis.

## Checklist de aprovação
- [ ] Finalidade definida.
- [ ] Base legal definida por origem.
- [ ] Evidência de opt-in validada quando aplicável.
- [ ] Origens não elegíveis excluídas.
- [ ] Política/Aviso de Privacidade atualizado.
- [ ] Textos de coleta/consentimento aprovados.
- [ ] Texto de descadastro aprovado.
- [ ] Política de retenção definida.
- [ ] Processo de direitos do titular definido.
- [ ] Resend/DPA/suboperadores revisados.
- [ ] Transferência internacional avaliada.
- [ ] Processo de incidentes revisado.
- [ ] Encarregado/canal de contato confirmado, quando aplicável.
- [ ] Piloto de até 20 destinatários autorizado.

## Referências oficiais
- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- ANPD — Guia de Legítimo Interesse: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_legitimo_interesse.pdf
- ANPD — Materiais: https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes
- ANPD — Regulamentações: https://www.gov.br/anpd/pt-br/assuntos/regulacao/analise-de-impacto-regulatorio
- ANPD — Incidentes: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis

`LEGAL_REVIEW_REQUIRED_BEFORE_REAL_CAMPAIGN=YES`

`EMAIL_LEGAL_REVIEW_APPROVED=false`

`EMAIL_SEND_ENABLED=false`

Nenhum piloto de clientes deve ocorrer sem aprovação jurídica documentada e autorização operacional separada.
