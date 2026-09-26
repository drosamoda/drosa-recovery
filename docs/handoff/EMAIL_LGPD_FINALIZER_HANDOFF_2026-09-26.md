# D'Rosa Recovery — Handoff: E-mail marketing / LGPD (continuar em outro chat)

Data: 26/09/2026. Escrito para retomar este trabalho numa sessão nova, sem contexto prévio.

## Leia primeiro

O documento vivo mais completo é `docs/handoff/EMAIL_LGPD_REVIEW_RESULT_2026-09-23.md` (apesar do nome de 23/09, tem seções datadas até 25/09). Leia as seções 8-10 dele antes de qualquer coisa. Este arquivo aqui é um resumo de continuidade, não substitui aquele.

Outros documentos relevantes no mesmo diretório:
- `EMAIL_LGPD_REVIEW_PACKET.md` — checklist de aprovação jurídica humana (nada marcado ainda).
- `EMAIL_PRIVACY_POLICY_ADDENDUM_DRAFT.md` — adendo pronto, `STATUS=READY_PENDING_TRANSFER_MECHANISM_AND_PUBLICATION`.
- `EMAIL_ANPD_SCC_EXECUTION_REQUEST.md` — pedido formal ao Resend para incorporar as SCCs brasileiras.

## Onde trabalhar

- Repo: `drosamoda/drosa-recovery`.
- **Worktree correto para esta sessão:** `C:\Users\peter\OneDrive\Área de Trabalho\claude -meta ads\drosa-recovery`, branch `main`, HEAD confirmado em `f0b29c32c473b005631fd2ef9a594756711fa843` (= `origin/main` nesta data).
- Existem **dezenas de outros worktrees** deste mesmo repo (rodar `git worktree list` para ver todos) — várias sessões paralelas trabalharam nisso entre 23-26/09. **Nunca** force reset/force push, nunca mexa em worktree com mudanças que não são suas. Antes de editar qualquer coisa: `git status` + `git branch --show-current` + `git rev-parse HEAD`.
- Projeto GCP: `gtm-m4sqc99b-nzjjz`. Serviço Cloud Run: `drosa-recovery` (região `us-central1`, não `us-west1`).

## Estado técnico (tudo já verificado com evidência, não suposição)

- **Paridade produção = código:** a revisão que recebe 100% do tráfego é `drosa-recovery-email-compliance-v1` (criada 2026-09-25T17:55:00Z). Comparei o zip-fonte exato que o Cloud Run buildou contra o `main` atual — hash de blob git idêntico nos 7 arquivos runtime críticos do canal de e-mail, e diff completo de `src/`+`prisma/` (ignorando CRLF/LF) sem nenhuma diferença real. **Não presuma isso ainda válido em uma sessão futura** — se main avançar ou houver novo deploy, refaça essa checagem (comando abaixo).
- **As 5 flags de segurança estão `false` na produção real** (li direto da spec da revisão, não do código): `EMAIL_SEND_ENABLED`, `EMAIL_TRANSFER_MECHANISM_APPROVED`, `EMAIL_LEGAL_REVIEW_APPROVED`, `EMAIL_CAMPAIGN_EXECUTOR_ENABLED`, `CRON_EMAIL_CAMPAIGNS_ENABLED`. `EMAIL_TRANSFER_MECHANISM_APPROVED` é checado de forma independente em `src/services/emailSendGate.ts:30` — mesmo que alguém ligue `EMAIL_SEND_ENABLED`, esse gate bloqueia sozinho.
- **Página pública `/privacy/email-marketing`** está no ar (testei ao vivo, HTTP 200) e mostra corretamente "bloqueado para campanhas de clientes".
- **Política geral `/politica-de-privacidade/`** (testei ao vivo) ainda NÃO tem o adendo — não menciona Resend, EUA, nem transferência internacional.
- Banco (última contagem, 25/09, não redundar sem gatilho): `EmailConsentEvent`=5028 (OPT_IN 2830/OPT_OUT 2198), `EmailMarketingConsent`=3956 (OPT_IN 2186/OPT_OUT 1643/UNKNOWN 127), `EmailSuppression`=1, `EmailSend`=2 (só canários internos), `EmailEventLog`=13.
- Drafts: 2 `CampaignDraft` com `channel=EMAIL`, ambos `DRAFT`/`productTruthStatus=BLOCKED`/`complianceStatus=BLOCKED`. Não desbloquear para "avançar o processo".

## Os 4 gates que travam o piloto (nenhum deles é decisão de IA)

| Gate | Status em 26/09 | O que falta |
|---|---|---|
| A — mecanismo de transferência internacional | BLOCKED | Resend confirmar/executar SCCs da ANPD (Resolução 19/2024) ou indicar outro mecanismo válido do art. 33 LGPD |
| B — resposta do Resend | WAITING_EXTERNAL, **não verificável a partir daqui** (ver nota Gmail abaixo) | Resposta/documento verificável de `privacy@resend.com` |
| C — aprovação jurídica humana | PENDING | Humano preencher o checklist de `EMAIL_LGPD_REVIEW_PACKET.md` |
| D — publicar adendo na política geral | PENDING_CONTENT_PERMISSION | Token da Nuvemshop não tem `read_content`/`write_content` (403 nas Pages) — precisa de permissão/reautorização feita por um humano, não pelo agente |

5 pedidos já foram enviados ao Resend entre 24-26/09. **Não envie um 6º automaticamente** — só prepare um DRAFT de follow-up se fizer sentido pelo tempo decorrido, nunca envie sem autorização explícita do usuário.

## Achados importantes de ferramenta (não repita o erro)

1. **Conta Gmail:** o conector Gmail desta sessão está ligado a `peterjunio16@gmail.com` (pessoal do Peter), **não** a uma caixa dedicada ao Resend. Confirmei isso de forma inequívoca (`to:peterjunio16@gmail.com` = 201 resultados pessoais; `to:drosamoda22@gmail.com` = 0 resultados). Uma instrução anterior do usuário afirmou que a conta correta seria `drosamoda22@gmail.com` — isso estava errado para esta sessão. **Não assuma qual conta está conectada; sempre confirme com uma busca `to:` antes de declarar o Gate B resolvido ou não.**
2. **Hook do RTK trunca/corrompe saídas longas.** `npm run lint` deu 3 números diferentes (678, 783, "2 erros") em invocações idênticas — era bug do hook, não do projeto (o `eslint` puro dava 0 erros). O mesmo aconteceu com `gcloud run services describe --format=json` (JSON truncado com "..." no meio de strings). **Sempre que precisar de uma saída longa/exata (JSON, contagens que vão para um relatório), use `rtk proxy <comando>` para contornar o hook**, ou invoque o binário direto (ex.: `./node_modules/.bin/eslint`).
3. **Path `/tmp` não funciona corretamente entre Bash-tool e Node no Windows** (`readFileSync('/tmp/...')` do Node dá ENOENT porque resolve para `C:\tmp`, diferente do que o Bash tool usa). Sempre escreva arquivos temporários no scratchpad da sessão (path absoluto Windows), nunca em `/tmp`.

## Como comparar produção vs main de novo (se precisar)

```bash
# 1. Achar a revisão com 100% de tráfego
rtk proxy gcloud run services describe drosa-recovery --project gtm-m4sqc99b-nzjjz --region us-central1 --format=json > <scratchpad>/svc.json
# procurar o objeto com "percent":100 dentro de status.traffic

# 2. Pegar o zip-fonte exato dessa revisão
rtk proxy gcloud run revisions describe <nome-da-revisao> --project gtm-m4sqc99b-nzjjz --region us-central1 --format=json > <scratchpad>/rev.json
# ler metadata.annotations["run.googleapis.com/build-source-location"] (gs://...)

rtk proxy gcloud storage cp "gs://...zip" <scratchpad>/prod-source.zip
unzip -o -q <scratchpad>/prod-source.zip -d <scratchpad>/prod-source-extracted

# 3. Comparar
diff -rq -b src <scratchpad>/prod-source-extracted/src   # -b ignora CRLF/LF
diff -rq -b prisma <scratchpad>/prod-source-extracted/prisma
```

## Como acessar o CRM

- URL: `https://drosa-recovery-1082403977536.us-central1.run.app/crm-v2` (versão nova) ou `/crm` (antiga, ainda no ar em paralelo).
- Login pede o **"Segredo de leitura"** = secret `drosa-crm-read-secret` no Secret Manager do projeto `gtm-m4sqc99b-nzjjz`. Pegar em Console → Secret Manager, ou `gcloud secrets versions access latest --secret="drosa-crm-read-secret" --project="gtm-m4sqc99b-nzjjz"`. **Nunca ler/exibir esse valor no chat.**
- Ações administrativas (aprovar/agendar) pedem também o **"Segredo administrativo"** = secret `drosa-recovery-admin-secret`.

## Regras que se acumularam ao longo de todo este projeto (não quebrar nenhuma)

- Nunca imprimir/logar/persistir em arquivo: `DATABASE_URL`, `DIRECT_URL`, `MIGRATE_DATABASE_URL`, API keys, tokens, `EMAIL_HASH_PEPPER`, secrets de webhook, PII de cliente.
- Nunca marcar `EMAIL_TRANSFER_MECHANISM_APPROVED`/`EMAIL_LEGAL_REVIEW_APPROVED`=true sem documento verificável da contraparte + decisão humana documentada. Nunca transformar `UNKNOWN` em `OPT_IN`.
- Nunca fazer deploy só para deixar uma auditoria "verde". Nunca reautorizar OAuth da Nuvemshop silenciosamente.
- Não redo de auditorias (contagem de banco, drafts, comparação PR62/63 em produção) sem gatilho concreto (nova migration, novo deploy relevante, novos envios, mudança de consentimento em massa, ou pré-flight imediatamente antes de um piloto real).
- `CRON_EMAIL_CAMPAIGNS_ENABLED` deve continuar `false` durante todo o primeiro piloto, mesmo depois que A-D forem resolvidos.
- Primeiro piloto: máximo 20 destinatários, um único draft, aprovação humana explícita antes de `SCHEDULED`.

## Próxima ação seguramente disponível

A única coisa que realmente falta é: (1) resposta/documento do Resend, (2) decisão jurídica humana, (3) permissão de conteúdo na Nuvemshop para publicar o adendo. Nenhuma dessas três eu (agente) posso resolver sozinho. Se o usuário disser "verifique se o Resend respondeu", a primeira coisa a fazer é confirmar QUAL conta de e-mail está de fato conectada (ver nota Gmail acima) antes de concluir qualquer coisa sobre o Gate B.
