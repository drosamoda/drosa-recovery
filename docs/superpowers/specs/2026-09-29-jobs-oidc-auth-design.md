# Autenticação OIDC de `/jobs/*` para o Cloud Scheduler — spec curta

- Data: 2026-09-29 · Status: implementado no backend (branch `feat/jobs-oidc-auth`); recursos de nuvem (service account, Scheduler) ainda NÃO criados.
- Problema: o script anterior do Scheduler gravava `JOBS_SECRET` como header estático no objeto do job. O Scheduler guarda headers na configuração; o Google recomenda OIDC com service account para chamar Cloud Run.

## Desenho
- **A. Service account dedicada:** `drosa-scheduler-invoker@gtm-m4sqc99b-nzjjz.iam.gserviceaccount.com`, sem papéis no projeto (o Scheduler só precisa **assinar** o token: o agente de serviço do Cloud Scheduler precisa de `roles/iam.serviceAccountTokenCreator` sobre essa service account).
- **B. Privilégio mínimo:** a service account não recebe `run.invoker` porque o serviço continua público (webhooks da Meta e da Nuvemshop precisam ser públicos). A autorização acontece na aplicação.
- **C. Audience:** URL exata do endpoint (`https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/jobs`), configurada em `JOBS_OIDC_AUDIENCE`. O job usa `--oidc-token-audience` igual.
- **D–G. Validação no backend** (`src/services/jobsOidc.ts`): `OAuth2Client.verifyIdToken` (assinatura com as chaves públicas do Google, expiração e audience) e, sobre os claims: issuer `https://accounts.google.com` ou `accounts.google.com`; `aud` igual à configurada; `email_verified=true`; `email` na lista `JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS`; `exp` no futuro.
- **H. Chaves do Google:** cache e rotação a cargo da biblioteca oficial.
- **I. Fail closed:** sem `JOBS_OIDC_AUDIENCE` ou sem service account permitida, o OIDC fica desligado e só o `x-jobs-secret` vale. Qualquer erro de verificação = 401.
- **J. Compatibilidade:** `x-jobs-secret` continua aceito (operação manual, smoke, emergência). Header presente e inválido = 401 sem cair no OIDC.
- **K. Logs:** o token e o segredo nunca são logados.
- **L. Testes:** `src/__tests__/unit/jobsAuth.test.ts` (13 casos, verificador injetado; sem rede): sem credencial, segredo válido/inválido, OIDC válido, audience/issuer/service account/e-mail/expiração inválidos, token malformado, esquema não-Bearer, OIDC desligado, sem token em log.
- **M. Rollback:** remover as variáveis `JOBS_OIDC_*` (nova revisão) volta ao comportamento anterior; o Scheduler é pausado/deletado pelo script.

## Passos de nuvem (ainda não executados; script `scripts/ops/process-messages-scheduler-oidc.ps1` a criar)
1. criar a service account; 2. conceder `TokenCreator` ao agente de serviço do Scheduler sobre ela; 3. nova revisão com `JOBS_OIDC_AUDIENCE` e `JOBS_OIDC_ALLOWED_SERVICE_ACCOUNTS`; 4. criar o job **pausado** (`--oidc-service-account-email`, `--oidc-token-audience`); 5. só depois do canário aprovado e da estratégia da fila antiga, `resume`.
