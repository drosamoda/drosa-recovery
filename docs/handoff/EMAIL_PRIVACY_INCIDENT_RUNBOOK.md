# Runbook — incidente de privacidade no canal de e-mail

## Gatilho

Abrir incidente sempre que houver suspeita de acesso, uso, alteração, perda,
divulgação ou envio indevido envolvendo endereço de e-mail, conteúdo de mensagem,
consentimento, suppression ou logs do canal.

## Primeiros passos

1. Parar EMAIL_SEND_ENABLED e EMAIL_CAMPAIGN_EXECUTOR_ENABLED.
2. Manter CRON_EMAIL_CAMPAIGNS_ENABLED=false.
3. Preservar logs e evidências sem copiar PII para tickets desnecessariamente.
4. Identificar período, sistemas, categorias de dados e quantidade aproximada de titulares.
5. Conter credenciais, tokens ou endpoints comprometidos.
6. Avaliar risco ou dano relevante aos titulares.
7. Documentar decisão e medidas.

## Comunicação

Quando o incidente puder acarretar risco ou dano relevante, o controlador deve
comunicar a ANPD e os titulares no prazo aplicável. A Resolução CD/ANPD 15/2024
estabelece prazo de 3 dias úteis, ressalvada legislação específica.

Se informações ainda estiverem incompletas, usar comunicação preliminar e complementar
conforme o procedimento da ANPD.

## Registro

Manter registro dos incidentes de segurança com dados pessoais por pelo menos 5 anos.

## Encerramento

Somente reabrir envio depois de:
- causa raiz identificada;
- credenciais/controles corrigidos;
- suppression e consentimento reconciliados;
- risco de repetição mitigado;
- obrigações de comunicação cumpridas;
- aprovação humana registrada.
