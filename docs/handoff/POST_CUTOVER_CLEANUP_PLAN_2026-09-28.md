# POST_CUTOVER_CLEANUP_PLAN — executar só após a janela de estabilidade (≥ 7 dias sem rollback)

| # | Ação | Pré-condição | Rollback |
|---|---|---|---|
| 1 | Remover rotas `/crm-legacy`, `/crm-v2-legacy` e `public/crm`, `public/crm-v2` | 7 dias estáveis, nenhum acesso nos logs | revert do commit |
| 2 | Remover aceitação de `x-crm-read-secret` no navegador (manter só para integrações, se houver) e rotacionar `CRM_READ_SECRET` | auditoria de chamadas sem cookie = 0 | reverter flag |
| 3 | `gcloud run services delete drosa-central-preview`; remover SA `drosa-central-preview`; apagar `drosa-central-preview-login`; desabilitar `drosa-central-auth-users:1` | passo 1 concluído | recriar a partir do `main` |
| 4 | Aposentar BI Vercel: desligar projeto, remover envs (inclusive `RECOVERY_JOBS_SECRET`), então rotacionar `JOBS_SECRET` + Cloud Scheduler | BI React + Metabase estáveis 14 dias | reativar projeto Vercel |
| 5 | Desabilitar `drosa-recovery-inbox-admin-secret:1`; revogar senha do `drosa_bi_reader` se só o Vercel usava (checar datasource do Metabase antes) | passo 4 | reabilitar versão |
| 6 | Remover revisões antigas com tag que referenciam segredo v2 (não iniciam mais) | — | não aplicável |
| 7 | Remover `CRM_UPSTREAM_URL`/proxy upstream se o preview não for mantido como staging | passo 3 | revert |
