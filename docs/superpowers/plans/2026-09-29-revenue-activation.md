# Revenue Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (Native/inline, escolhido pelo dono). Steps usam checkbox (`- [ ]`).

**Goal:** WhatsApp transacional drenando sozinho, primeira campanha real de e-mail em canário pela Central, e captação de consentimento de WhatsApp ativa.

**Architecture:** Cloud Scheduler → `/jobs/*` (idempotentes) em cima do código existente (`processMessages`, `emailCampaignExecutor`, `campaignService`). Escrita na Central só via sessão admin + checagem de Origin. Sem migration.

**Tech Stack:** Node/TS/Express/Prisma (backend), React/Vite/React Query (frontend), Cloud Run, Cloud Scheduler, Secret Manager, Resend, NubeSDK.

Spec: `docs/superpowers/specs/2026-09-29-revenue-activation-design.md` (commit `67e5166`).

---

## Decisões de implementação (achados no código ao planejar)

- **D1 — ordem P0C↔P0A (BLOQUEADOR ENCONTRADO):** `verifyDispatchContract` exige consentimento `transactional` para templates UTILITY e `marketing` para MARKETING (`_pix_pendente` e `pagamento_confirmado_drosa_01` são MARKETING). Com 0 consentimentos reais, drenar a fila hoje **não envia nada** (tudo vira `consent_unproven`/`transactional_consent_unproven`). A regra de consentimento NÃO muda nesta entrega. Portanto a instalação do script de consentimento (P0C, Tarefa 6) sobe para antes do canário do P0A; o canário só envia para pedidos novos com opt-in.
- **D2 — expiração:** já existe `AUTOMATION_MAX_MESSAGE_AGE_HOURS=24` → `skipped/message_expired` (por `scheduledAt`). O motivo usado é o existente `message_expired` (não `expired_stale`). Falta: revalidação de pagamento pendente para PIX/boleto **transacionais** (hoje só existe para remarketing) e o rótulo "Não disparada · expirada".
- **D3 — alerta de fila:** o item "Fila de WhatsApp parada" no Action Center usa `recoveryEngine.oldestPending` já exposto por `/crm-api/health`. O job de Scheduler para `automation-health` do spec 3.6 é omitido: só leria dados sem efeito (YAGNI).
- **D4 — copy do e-mail sem IA:** produção não tem `ANTHROPIC_API_KEY`; `createFromOpportunity` exige IA. Novo caminho determinístico `createEmailFromCopy`: o operador escreve assunto/preheader/título/corpo/CTA na Central; passa pela mesma auditoria `auditAllStrategies`; gera 1 estratégia já selecionada.
- **D5 — limite do canário:** usa o limite global existente `EMAIL_CAMPAIGN_MAX_TOTAL_SENDS` (50 no canário; ampliar = nova revisão com valor maior, cada ampliação é gate humano).
- **D6 — agendamento:** `schedule` aceita `scheduledAt` opcional (≥ agora); o executor passa a filtrar `scheduledAt <= now`.

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/services/transactionalMessageValidity.ts` (novo) | regra pura: PIX/boleto transacional ainda pendente? |
| `src/jobs/processMessages.ts` | aplica a regra no ramo de pedido não-remarketing |
| `src/services/crmReadService.ts` | `normalizeFailure`: `message_expired` → `EXPIRED` |
| `frontend/src/lib/labels.ts`, `frontend/src/routes/messages/MessagesPage.tsx` | rótulo "Não disparada · expirada" |
| `frontend/src/lib/attention.ts` | item "Fila de WhatsApp parada" |
| `src/middlewares/centralAdminWrite.ts` (novo) | sessão admin + Origin, ou `x-admin-secret` |
| `src/routes/aiCampaigns.routes.ts` | rotas de escrita protegidas + `POST /campaigns/email`, `GET /campaigns/:id/preview`, `GET /campaigns/:id/metrics` |
| `src/services/ai/campaignService.ts` | `createEmailFromCopy`, `schedule(id, scheduledAt?)` |
| `src/services/emailCampaignExecutor.ts` | filtro `scheduledAt <= now`; export `trackingCampaignKey`, `renderCampaignPreview` |
| `src/services/emailCampaignMetrics.ts` (novo) | agregados por campanha |
| `frontend/src/lib/api.ts` | `apiSend` (POST JSON) |
| `frontend/src/routes/campaigns/EmailCampaignsTab.tsx` (novo) | fluxo Criar→Revisar→Aprovar→Agendar→Acompanhar→Cancelar |
| `frontend/src/routes/campaigns/CampaignsPage.tsx` | aba Campanhas usa `EmailCampaignsTab`; contador de consentidos |
| `scripts/ops/rotate-jobs-secret.ps1`, `scripts/ops/create-ai-db-role.ps1` (novos) | operações de segredo sem imprimir valores |

Comandos base (repo `drosa-recovery`, branch `feat/revenue-activation`):
- backend focado: `npx vitest run <arquivo>` · backend total: `npx vitest run --no-file-parallelism`
- frontend: `cd frontend && npx vitest run <arquivo>` · gates: `npx tsc --noEmit`, `node ./node_modules/eslint/bin/eslint.js "src/**/*.{ts,tsx}"`, `npx vite build`

---

## FASE 1 — P0A código (sem produção)

### Tarefa 1: validade de PIX/boleto transacional

**Files:** Create `src/services/transactionalMessageValidity.ts`; Test `src/__tests__/unit/transactionalMessageValidity.test.ts`; Modify `src/jobs/processMessages.ts` (ramo `if (msg.entityType === EntityType.order)`, antes de `if (remarketingMessage)`).

- [ ] **Step 1: teste falhando**
```ts
import { describe, expect, it } from 'vitest'
import { transactionalPaymentReason, PAYMENT_PENDING_TEMPLATES } from '../../services/transactionalMessageValidity'

const order = (o: Partial<{ status: string; paymentStatus: string; paymentMethod: string | null }>) => ({ status: 'open', paymentStatus: 'pending', paymentMethod: 'pix', ...o })

describe('transactionalPaymentReason', () => {
  it('só se aplica a templates de pagamento pendente', () => {
    expect(PAYMENT_PENDING_TEMPLATES).toEqual(['_pix_pendente', 'pedido_boleto_drosa_01', 'boleto_vencendo_drosa_v2'])
    expect(transactionalPaymentReason('confirmacao_pedido_drosa', order({ paymentStatus: 'paid' }))).toBeNull()
  })
  it('pendente e não cancelado → envia', () => {
    expect(transactionalPaymentReason('_pix_pendente', order({}))).toBeNull()
    expect(transactionalPaymentReason('pedido_boleto_drosa_01', order({ paymentMethod: 'boleto' }))).toBeNull()
  })
  it('pago → payment_already_completed', () => {
    expect(transactionalPaymentReason('_pix_pendente', order({ paymentStatus: 'paid' }))).toBe('payment_already_completed')
  })
  it('cancelado/estornado → order_cancelled', () => {
    for (const status of ['cancelled', 'canceled', 'refunded']) expect(transactionalPaymentReason('boleto_vencendo_drosa_v2', order({ status }))).toBe('order_cancelled')
  })
})
```
- [ ] **Step 2:** `npx vitest run src/__tests__/unit/transactionalMessageValidity.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: implementação**
```ts
// Revalidação de pagamento para mensagens TRANSACIONAIS de pagamento pendente.
// A expiração por idade (24h) continua em processMessages (message_expired).
export const PAYMENT_PENDING_TEMPLATES = ['_pix_pendente', 'pedido_boleto_drosa_01', 'boleto_vencendo_drosa_v2'] as const

export function transactionalPaymentReason(
  templateName: string,
  order: { status: string; paymentStatus: string; paymentMethod: string | null },
): 'payment_already_completed' | 'order_cancelled' | null {
  if (!(PAYMENT_PENDING_TEMPLATES as readonly string[]).includes(templateName)) return null
  if (['cancelled', 'canceled', 'refunded'].includes(order.status)) return 'order_cancelled'
  if (order.paymentStatus !== 'pending') return 'payment_already_completed'
  return null
}
```
Em `processMessages.ts`, após `const bodyParams: string[] = [first]` e antes de `if (remarketingMessage) {`:
```ts
    if (!remarketingMessage) {
      const paymentReason = transactionalPaymentReason(msg.templateName, order)
      if (paymentReason) return { ok: false, reason: paymentReason }
    }
```
e o import `import { transactionalPaymentReason } from '../services/transactionalMessageValidity'`.
- [ ] **Step 4:** teste da Tarefa 1 + `npx vitest run src/__tests__/unit/processMessages*.test.ts` → PASS.
- [ ] **Step 5:** `git commit -m "feat(whatsapp): revalida pagamento pendente em PIX/boleto transacional"`

### Tarefa 2: rótulo "Não disparada · expirada"

**Files:** Modify `src/services/crmReadService.ts:104` (`normalizeFailure` + tipo `FailureCategory`), `frontend/src/lib/labels.ts`, `frontend/src/routes/messages/MessagesPage.tsx`; Test `src/__tests__/unit/crmReadService.normalizeFailure.test.ts`, `frontend/src/routes/messages/__tests__/MessagesPage.test.tsx`.

- [ ] **Step 1: testes falhando**
```ts
import { describe, expect, it } from 'vitest'
import { normalizeFailure } from '../../services/crmReadService'
describe('normalizeFailure', () => {
  it('message_expired → EXPIRED (não é falha de envio)', () => {
    expect(normalizeFailure('message_expired', null, 'skipped')).toBe('EXPIRED')
  })
})
```
Frontend (no teste existente de MessagesPage, novo `it`): lista com `{ status: 'skipped', failureCategory: 'EXPIRED' }` → `expect(await screen.findByText('Não disparada · expirada')).toBeInTheDocument()`.
- [ ] **Step 2:** rodar os dois → FAIL.
- [ ] **Step 3:** backend: incluir `'EXPIRED'` na união `FailureCategory` e, como primeira regra após `const value = …`: `if (value.includes('message_expired')) return 'EXPIRED'`. Frontend `labels.ts`: em `FAILURE_CATEGORY` adicionar `EXPIRED: { label: 'Expirada (fora da validade)', tone: 'neutral' }` e exportar
```ts
export function messageStatusLabel(status: string, failureCategory: string | null): Label | null {
  if (status === 'skipped' && failureCategory === 'EXPIRED') return { label: 'Não disparada · expirada', tone: 'neutral' }
  return lookup(MESSAGE_STATUS, status)
}
```
`MessagesPage.tsx` coluna status: `render: (r) => { const l = messageStatusLabel(r.status, r.failureCategory); return l ? <span title={r.status}><StatusBadge label={l.label} tone={l.tone} /></span> : '—' }` (import `StatusBadge`).
- [ ] **Step 4:** testes → PASS.
- [ ] **Step 5:** `git commit -m "feat(messages): expirada é rotulada e não conta como falha"`

### Tarefa 3: Action Center — fila parada

**Files:** Modify `frontend/src/lib/attention.ts`; Test `frontend/src/lib/__tests__/attention.test.ts`.

- [ ] **Step 1: teste falhando**
```ts
it('fila com item pendente há mais de 15 min vira alerta crítico', () => {
  const now = new Date('2026-09-29T12:00:00Z')
  const h = { ...base, recoveryEngine: { ...base.recoveryEngine, pending: 3, oldestPending: '2026-09-29T11:40:00Z' } }
  const items = buildAttentionItems(h, 5, now)
  expect(items[0]).toMatchObject({ key: 'queue-stalled', severity: 'danger' })
})
it('pendente recente não alerta', () => {
  const now = new Date('2026-09-29T12:00:00Z')
  const h = { ...base, recoveryEngine: { ...base.recoveryEngine, pending: 3, oldestPending: '2026-09-29T11:55:00Z' } }
  expect(buildAttentionItems(h, 5, now).some((i) => i.key === 'queue-stalled')).toBe(false)
})
```
(`base` = fixture existente do arquivo.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `buildAttentionItems(h, max = 5, now = new Date())`; adicionar como primeiro item:
```ts
const STALL_MS = 15 * 60_000
const stalled = h.recoveryEngine.pending > 0 && h.recoveryEngine.oldestPending !== null && now.getTime() - new Date(h.recoveryEngine.oldestPending).getTime() > STALL_MS
// …
stalled ? { key: 'queue-stalled', severity: 'danger', title: 'Fila de WhatsApp parada', context: `${n(h.recoveryEngine.pending)} pendentes; mais antiga de ${formatDateTime(h.recoveryEngine.oldestPending)}.`, action: 'Ver fila', to: '/messages?status=pending' } : null,
```
e manter o item `queue` (neutral) só quando `!stalled`.
- [ ] **Step 4:** PASS (`cd frontend && npx vitest run src/lib`).
- [ ] **Step 5:** `git commit -m "feat(central): alerta de fila de WhatsApp parada"`

### Tarefa 4: idempotência (verificação)

- [ ] **Step 1:** confirmar cobertura: `grep -n "claim" src/__tests__/unit/processMessages*.test.ts`. Se existir teste de duas execuções concorrentes → registrar e seguir. Se não:
```ts
it('duas execuções concorrentes não processam a mesma mensagem', async () => {
  // mock prisma.messageLog.updateMany: 1ª chamada {count:1}, 2ª {count:0} para o mesmo id
  // espera sendTemplate chamado 1 vez
})
```
implementado no arquivo de teste existente de `processMessages` seguindo os mocks já usados lá.
- [ ] **Step 2:** PASS → `git commit -m "test(whatsapp): claim concorrente não duplica"` (só se houve teste novo).

### Tarefa 5: gates FASE 1

- [ ] backend `npx tsc --noEmit`, `npx vitest run --no-file-parallelism`; frontend tsc/lint/vitest/build; secret scan do diff (`git diff origin/main -- . ':!frontend/package-lock.json' | Select-String '(sk_live|AKIA|-----BEGIN|postgres(ql)?://[^ ]*:[^ @]*@|re_[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{20,})'` = 0).
- [ ] push `feat/revenue-activation`; PR "P0A". **GATE HUMANO H1: merge do PR P0A.**

## FASE 1b — P0C script de consentimento (antecipado por D1)

### Tarefa 6: script de consentimento no checkout

**Files:** `whatsapp-consent-checkout/` (existente, NubeSDK).
- [ ] **Step 1:** `cd whatsapp-consent-checkout && npm test` → PASS.
- [ ] **Step 2:** verificar se a extensão está instalada/publicada na loja 7716231 (painel de apps/NubeSDK; leitura). Se não estiver: **GATE HUMANO H2: instalar/publicar a extensão na loja** (escrita na Nuvemshop) seguindo `whatsapp-consent-checkout/README.md`.
- [ ] **Step 3:** **GATE HUMANO H3: pedido de teste** marcando os dois opt-ins. Verificar via `/crm-api/customers/:id` (consents) que `transactional` e `marketing` ficaram `consented=true`, `source=nuvemshop_checkout_whatsapp_optin`, `consentedAt` preenchido.
- [ ] Critério: ≥ 1 consentimento real gravado com origem/data.

## FASE 2 — P0A produção

### Tarefa 7: rotação do JOBS_SECRET

**Files:** Create `scripts/ops/rotate-jobs-secret.ps1`.
```powershell
# Gera novo JOBS_SECRET e grava como nova versão no Secret Manager. Não imprime o valor.
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'
$bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$tmp = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($tmp, [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_'))
  gcloud secrets versions add drosa-recovery-jobs-secret --project=$proj --data-file=$tmp | Out-Null
} finally { Remove-Item $tmp -Force }
gcloud secrets versions list drosa-recovery-jobs-secret --project=$proj --sort-by='~createTime' --limit=1 --format='value(name)'
```
- [ ] Rodar → nova versão N (só o número aparece).
- [ ] Build do `main` (pós-H1) em diretório limpo (`git archive`), `gcloud run deploy drosa-recovery --source <dir> --no-traffic --tag p0a --update-secrets JOBS_SECRET=drosa-recovery-jobs-secret:N`.
- [ ] Smoke na tag (script `p0-smoke` existente): 0 falhas; `POST /jobs/remarketing-preview` com segredo novo = 200, com o antigo = 401 (segredos lidos em memória, nunca impressos).
- [ ] Troca de tráfego 100% para a revisão nova (rollout já autorizado com smoke). Rollback: `gcloud run services update-traffic drosa-recovery --to-revisions drosa-recovery-p0-main-1c370a6=100`.
- [ ] Atualizar header dos 3 jobs: `gcloud scheduler jobs update http <job> --location us-central1 --update-headers x-jobs-secret=<valor lido em variável>` (valor nunca ecoado).
- [ ] Após 1 h sem 401 em `/jobs/*` nos logs: `gcloud secrets versions disable 1 --secret drosa-recovery-jobs-secret`.

### Tarefa 8: canário ≤ 5 e Scheduler

- [ ] Estado da fila (leitura): contagem de `pending` por template; confirmar que as antigas vão expirar (`message_expired`) ao processar.
- [ ] Revisão com `MESSAGES_BATCH_SIZE=5` (`--update-env-vars`), 0% → smoke → 100% (rollback: revisão da Tarefa 7).
- [ ] **GATE HUMANO H4: autorizar o canário transacional real (≤ 5 mensagens).** Mostrar antes: pendentes, quantas expiram, quantas têm consentimento.
- [ ] `POST /jobs/process-messages` uma vez. Verificar no retorno e em `/crm-api/messages`: enviadas ≤ 5, expiradas marcadas `message_expired`, nenhuma duplicada, webhook Meta com `delivered/read`.
- [ ] Criar Scheduler: `gcloud scheduler jobs create http drosa-process-messages --location us-central1 --schedule "*/2 * * * *" --uri https://drosa-recovery-lkuoxpyjlq-uc.a.run.app/jobs/process-messages --http-method POST --update-headers x-jobs-secret=<var>,Content-Type=application/json --attempt-deadline 120s --max-retry-attempts 0`.
- [ ] Observar 30 min: fila sem item mais antigo que 15 min; 0 5xx novos; Action Center sem "fila parada".
- [ ] Critério P0A: pedido novo com opt-in gera mensagem que sai em ≤ 5 min.

## FASE 3 — P0B infraestrutura e gates

### Tarefa 9: role e credencial do banco de campanhas

**Files:** Create `scripts/ops/create-ai-db-role.ps1` (roda no terminal do dono: usa a credencial admin dele; imprime só a versão do secret).
```powershell
$ErrorActionPreference = 'Stop'
$proj = 'gtm-m4sqc99b-nzjjz'
$admin = gcloud secrets versions access latest --secret=drosa-recovery-database-url --project=$proj
$u = [Uri]$admin
$ref = ($u.UserInfo.Split(':')[0]).Split('.')[1]
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$pw = [Convert]::ToHexString($bytes).ToLower()
$sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_ai_writer') THEN CREATE ROLE crm_ai_writer LOGIN; END IF;
END `$`$;
ALTER ROLE crm_ai_writer PASSWORD '$pw' CONNECTION LIMIT 3;
GRANT USAGE ON SCHEMA public TO crm_ai_writer;
GRANT SELECT, INSERT, UPDATE ON public.campaign_drafts, public.ai_runs TO crm_ai_writer;
"@
$env:ADMIN_URL = $admin; $env:SQL = $sql
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient({datasources:{db:{url:process.env.ADMIN_URL}}});p.`$executeRawUnsafe(process.env.SQL).then(()=>p.`$disconnect())"
$aiUrl = "postgresql://crm_ai_writer.${ref}:$pw@$($u.Host):$($u.Port)$($u.AbsolutePath)?pgbouncer=true&connection_limit=1"
$tmp = [IO.Path]::GetTempFileName(); try { [IO.File]::WriteAllText($tmp, $aiUrl); gcloud secrets create drosa-recovery-ai-database-url --project=$proj --data-file=$tmp 2>$null; if ($LASTEXITCODE) { gcloud secrets versions add drosa-recovery-ai-database-url --project=$proj --data-file=$tmp | Out-Null } } finally { Remove-Item $tmp -Force; $env:ADMIN_URL=''; $env:SQL='' }
gcloud secrets add-iam-policy-binding drosa-recovery-ai-database-url --project=$proj --member="serviceAccount:$(gcloud run services describe drosa-recovery --region us-central1 --project $proj --format='value(spec.template.spec.serviceAccountName)')" --role=roles/secretmanager.secretAccessor | Out-Null
gcloud secrets versions list drosa-recovery-ai-database-url --project=$proj --limit=1 --format='value(name)'
```
Obs.: `executeRawUnsafe` com múltiplos comandos — se o driver recusar, dividir `$sql` por `;` e executar em sequência no mesmo script.
- [ ] **GATE HUMANO H5: dono roda `pwsh -File scripts/ops/create-ai-db-role.ps1`** (credencial admin é dele) e informa a versão.
- [ ] Revisão com `--update-secrets AI_DATABASE_URL=drosa-recovery-ai-database-url:<v>` 0% → `GET /crm-api/ai/campaigns` = 200 (antes 503) → 100%. Rollback: revisão anterior.

### Tarefa 10: remetente/domínio (somente leitura)

- [ ] `Resolve-DnsName -Type TXT mail.drosamoda.com.br`, `send._domainkey.mail.drosamoda.com.br`/`resend._domainkey.mail.drosamoda.com.br`, `_dmarc.drosamoda.com.br` → SPF/DKIM presentes.
- [ ] Valor (não secreto) de `EMAIL_DOMAIN_AUTHENTICATED` na revisão atual.
- [ ] Se DKIM/SPF ausentes: **GATE HUMANO H6: DNS.**

### Tarefa 11: gates LGPD A–D documentados

**Files:** Modify `docs/handoff/EMAIL_LGPD_REVIEW_PACKET.md` (seção "Decisão do dono — 2026-09"): campos A (mecanismo: documento do Resend OU aceite dos termos/DPA públicos com URL+data), B, C (aprovação), D (adendo publicado em `/privacy/email-marketing` + link no rodapé — conferir `addEmailComplianceFooter` recebendo `privacyUrl`).
- [ ] Conferir `GET /privacy/email-marketing` = 200 com o texto do adendo (`docs/handoff/EMAIL_PRIVACY_POLICY_ADDENDUM_DRAFT.md`); se o texto não estiver na página, atualizar só o conteúdo estático dessa rota.
- [ ] **GATE HUMANO H7: dono registra A–D.** Sem registro, nenhuma flag muda.

## FASE 4 — P0B fluxo de escrita

### Tarefa 12: middleware `centralAdminWrite`

**Files:** Create `src/middlewares/centralAdminWrite.ts`; Test `src/__tests__/unit/centralAdminWrite.test.ts`.
- [ ] **Step 1: testes**
```ts
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../config/env', () => ({ env: { CENTRAL_SESSION_ENABLED: true, ADMIN_SECRET: 'adm' } }))
vi.mock('../../services/centralSession', () => ({
  SESSION_COOKIE: 's', readCookie: () => 'tok',
  verifySessionToken: vi.fn(),
}))
import { verifySessionToken } from '../../services/centralSession'
import { centralAdminWrite } from '../../middlewares/centralAdminWrite'

function run(headers: Record<string, string>, session: unknown) {
  vi.mocked(verifySessionToken).mockReturnValue(session as never)
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  const next = vi.fn()
  centralAdminWrite({ headers, method: 'POST' } as never, res as never, next)
  return { res, next }
}
describe('centralAdminWrite', () => {
  it('admin com Origin do próprio host passa', () => {
    expect(run({ host: 'h', origin: 'https://h', cookie: 's=tok' }, { role: 'admin', email: 'a' }).next).toHaveBeenCalled()
  })
  it('leitura → 403', () => {
    expect(run({ host: 'h', origin: 'https://h' }, { role: 'read' }).res.status).toHaveBeenCalledWith(403)
  })
  it('Origin ausente ou de outro host → 403', () => {
    expect(run({ host: 'h' }, { role: 'admin' }).res.status).toHaveBeenCalledWith(403)
    expect(run({ host: 'h', origin: 'https://evil' }, { role: 'admin' }).res.status).toHaveBeenCalledWith(403)
  })
  it('sem sessão mas com x-admin-secret válido passa (compat)', () => {
    expect(run({ 'x-admin-secret': 'adm' }, null).next).toHaveBeenCalled()
  })
  it('sem nada → 401', () => {
    expect(run({}, null).res.status).toHaveBeenCalledWith(401)
  })
})
```
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
```ts
import { NextFunction, Request, Response } from 'express'
import { env } from '../config/env'
import { readCookie, SESSION_COOKIE, verifySessionToken } from '../services/centralSession'

// Escrita de campanhas: sessão da Central com papel admin + Origin do próprio
// host (cookie já é SameSite=Strict), ou o x-admin-secret legado.
export function centralAdminWrite(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-admin-secret']
  if (env.ADMIN_SECRET && typeof secret === 'string' && secret === env.ADMIN_SECRET) return next()
  const session = env.CENTRAL_SESSION_ENABLED ? verifySessionToken(readCookie(req.headers.cookie, SESSION_COOKIE)) : null
  if (!session) { res.status(401).json({ error: 'Nao autorizado' }); return }
  if (session.role !== 'admin') { res.status(403).json({ error: 'Ação restrita a administradores' }); return }
  const origin = req.headers.origin
  let originHost: string | null = null
  try { originHost = origin ? new URL(origin).host : null } catch { originHost = null }
  if (!originHost || originHost !== req.headers.host) { res.status(403).json({ error: 'Origem inválida' }); return }
  next()
}
```
(`env.ADMIN_SECRET` é o mesmo usado por `adminAuth`.)
- [ ] **Step 4:** PASS → `git commit -m "feat(campaigns): escrita via sessão admin + Origin"`

### Tarefa 13: `createEmailFromCopy` + `schedule(id, scheduledAt?)` + filtro do executor

**Files:** Modify `src/services/ai/campaignService.ts`, `src/services/emailCampaignExecutor.ts:411-415`; Test `src/__tests__/unit/campaignServiceEmailCopy.test.ts`, teste existente do executor.
- [ ] **Step 1: testes** (mocks de `getAiPrisma`, `getOpportunityById`, `auditAllStrategies` como nos testes existentes de `campaignService`):
  - copy válida → `campaignDraft.create` com `channel:'EMAIL'`, `strategies` com 1 item (`direction:'A'`, `productId:null`, campos da copy), `selectedStrategy:0`, `status:'AWAITING_HUMAN_APPROVAL'`, `audienceSnapshot` com `segmentKey`/`campaignKey`.
  - auditoria com findings → `status:'DRAFT'`, `complianceStatus:'BLOCKED'`.
  - campo vazio → `EmailCampaignNotAllowedError` (`code:'COPY_INVALID'`).
  - mesma `idempotencyKey` → retorna o draft existente sem criar.
  - `schedule(id, futuro)` grava `scheduledAt` futuro; `schedule(id, passado)` → `InvalidCampaignStateError`.
  - executor: `findMany` recebe `where` com `scheduledAt: { lte: now }`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
```ts
export interface EmailCopyInput { subject: string; preheader: string; headline: string; body: string; cta: string }

async createEmailFromCopy(opportunityId: string, campaignKey: string, copy: EmailCopyInput, idempotencyKey: string): Promise<CreateResult> {
  const aiPrisma = getAiPrisma()
  const existing = await aiPrisma.campaignDraft.findUnique({ where: { idempotencyKey } })
  if (existing) return fromExistingDraft(existing)
  const fields = [copy.subject, copy.preheader, copy.headline, copy.body, copy.cta].map((v) => (typeof v === 'string' ? v.trim() : ''))
  if (fields.some((v) => !v) || copy.subject.length > 120 || copy.body.length > 4000) throw new EmailCampaignNotAllowedError('Preencha assunto, preheader, título, corpo e CTA (assunto ≤ 120, corpo ≤ 4000).', 'COPY_INVALID')
  const opportunity = await getOpportunityById(opportunityId)
  if (!opportunity || opportunity.channel !== 'email') throw new CampaignNotFoundError(`Oportunidade de e-mail não encontrada: ${opportunityId}`)
  const def = resolveEmailCampaign(opportunity, campaignKey)
  const strategy: EmailStrategy = { direction: 'A', name: def.name, angle: def.objective, audience: SEGMENT_META[opportunity.segmentKey].name, productId: null, subject: fields[0], preheader: fields[1], headline: fields[2], body: fields[3], cta: fields[4], creativeBrief: 'Copy escrita pelo operador na Central', warnings: [] }
  const findings = auditAllStrategies([strategy], [null])
  const blocked = findings.length > 0
  const draft = await aiPrisma.campaignDraft.create({ data: {
    opportunityId: opportunity.id, opportunityType: opportunity.type, opportunityTitle: opportunity.title, channel: 'EMAIL',
    status: blocked ? 'DRAFT' : 'AWAITING_HUMAN_APPROVAL', idempotencyKey,
    audienceSnapshot: { channel: 'email', segmentKey: opportunity.segmentKey, segmentName: SEGMENT_META[opportunity.segmentKey].name, campaignKey: def.key, campaignName: def.name, audienceCount: opportunity.audienceCount, withValidEmailCount: opportunity.withValidEmailCount, sendEligibleCount: null, eligibilityStatus: opportunity.eligibilityStatus, generatedAt: opportunity.generatedAt, copySource: 'operator' },
    strategies: [{ ...strategy, status: blocked ? 'BLOCKED' : 'OK', findings }] as unknown as Prisma.InputJsonValue,
    selectedStrategy: 0, productTruthStatus: 'APPROVED', complianceStatus: blocked ? 'BLOCKED' : 'APPROVED', complianceFindings: findings as unknown as Prisma.InputJsonValue,
  } })
  return { id: draft.id, status: draft.status, strategies: draft.strategies as Strategy[] | null, complianceFindings: findings }
},
```
(`EmailCampaignNotAllowedError(message, code)` — usar a assinatura existente no arquivo; `EmailStrategy` importado de `./aiProvider`.)
`schedule`:
```ts
async schedule(id: string, scheduledAt?: Date) {
  const when = scheduledAt ?? new Date()
  if (when.getTime() < Date.now() - 60_000) throw new InvalidCampaignStateError('Agendamento no passado')
  // …checagens existentes…
  return getAiPrisma().campaignDraft.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt: when } })
},
```
Executor: `where: { channel: 'EMAIL', status: { in: ['SCHEDULED', 'RUNNING'] }, scheduledAt: { lte: new Date() } }`.
- [ ] **Step 4:** PASS → `git commit -m "feat(campaigns): e-mail com copy do operador e agendamento com data"`

### Tarefa 14: rotas (escrita protegida, preview, métricas)

**Files:** Modify `src/routes/aiCampaigns.routes.ts`; Create `src/services/emailCampaignMetrics.ts`; Modify `src/services/emailCampaignExecutor.ts` (exportar `trackingCampaignKey`, novo `renderCampaignPreview(draft)` = `addEmailComplianceFooter(renderEmailCampaignMessage(selectedEmailStrategy(draft), env.EMAIL_DEFAULT_CTA_URL), 'https://exemplo.invalid/descadastro-previa', safeHttpsUrl(`${env.APP_BASE_URL}/privacy/email-marketing`))`); Test `src/__tests__/integration/aiCampaignsWrite.test.ts`.
- [ ] **Step 1: testes (supertest, mocks de `campaignService`/métricas):**
  - `POST /crm-api/ai/campaigns/email` sem sessão admin → 401; sessão `read` → 403; admin sem Origin → 403; admin com Origin → 201.
  - `POST /campaigns` (IA), `/select`, `/approve`, `/schedule`, `/cancel` passam a usar `centralAdminWrite` (401 só com `x-crm-read-secret`).
  - `GET /campaigns/:id/preview` → `{ subject, html, text }` com link de descadastro e privacidade no html.
  - `GET /campaigns/:id/metrics` → `{ sends: {…}, events: {…}, ordersAfterClick: n }`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `emailCampaignMetrics.ts`:
```ts
import { prisma } from '../config/prisma'
import { trackingCampaignKey } from './emailCampaignExecutor'

export async function emailCampaignMetrics(draftId: string) {
  const campaignKey = trackingCampaignKey(draftId)
  const [sends, events, purchases] = await Promise.all([
    prisma.emailSend.groupBy({ by: ['status'], where: { campaignKey }, _count: { _all: true } }),
    prisma.emailEventLog.groupBy({ by: ['type'], where: { campaignKey }, _count: { _all: true } }),
    prisma.emailEventLog.count({ where: { campaignKey, type: 'PURCHASE', attributionModel: 'LAST_CLICK_7D' } }),
  ])
  return {
    sends: Object.fromEntries(sends.map((s) => [s.status, s._count._all])),
    events: Object.fromEntries(events.map((e) => [e.type, e._count._all])),
    ordersAfterClick: purchases,
  }
}
```
Rotas: trocar `adminAuth` por `centralAdminWrite` em approve/schedule/cancel e adicioná-lo em `POST /campaigns` e `/select`; `approvedBy` = e-mail da sessão quando houver (`verifySessionToken(...)?.email ?? req.body.approvedBy`); `schedule` lê `req.body.scheduledAt` (ISO opcional); novo `POST /campaigns/email` (`opportunityId`, `campaignKey`, `copy`, `idempotencyKey`) → `createEmailFromCopy`; `GET /campaigns/:id/preview` e `/metrics` (leitura, `crmAuth` já aplicado).
- [ ] **Step 4:** PASS → `git commit -m "feat(campaigns): rotas de escrita admin, preview e métricas"`

### Tarefa 15: `apiSend` no frontend

**Files:** Modify `frontend/src/lib/api.ts`; Test `frontend/src/lib/__tests__/api.test.ts`.
- [ ] teste: `apiSend('ai/campaigns/x/approve', {a:1})` faz `fetch('/crm-api/ai/campaigns/x/approve', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:'{"a":1}' })`; 403 → `ApiError(status 403)`.
- [ ] implementação: mesma lógica de `apiGet` com `method: 'POST'` e body JSON (o navegador envia `Origin` sozinho). Commit.

### Tarefa 16: `EmailCampaignsTab`

**Files:** Create `frontend/src/routes/campaigns/EmailCampaignsTab.tsx`; Modify `CampaignsPage.tsx` (aba `campaigns` → `<EmailCampaignsTab />`); Test `frontend/src/routes/campaigns/__tests__/EmailCampaignsTab.test.tsx`.
- [ ] **Step 1: testes**
  - lista drafts de `GET ai/campaigns` filtrando `channel==='EMAIL'`, com status traduzido (DRAFT→Rascunho bloqueado, AWAITING_HUMAN_APPROVAL→Aguardando aprovação, APPROVED→Aprovada, SCHEDULED→Agendada, RUNNING→Enviando, COMPLETED→Concluída, CANCELLED→Cancelada).
  - usuário `read` (via `useAuth`) não vê botões Criar/Aprovar/Agendar/Cancelar.
  - admin: formulário "Nova campanha" (oportunidade de e-mail de `ai/opportunities?channel=email`, `campaignKey` da oportunidade, assunto, preheader, título, corpo, CTA) → `apiSend('ai/campaigns/email', {..., idempotencyKey})` uma vez por clique.
  - detalhe: botão "Pré-visualizar" renderiza `GET …/preview` num `<iframe sandbox="" srcDoc>`; findings de compliance listados quando BLOCKED.
  - "Aprovar" exige `window.confirm`; "Agendar" com campo data/hora opcional; "Cancelar" só em SCHEDULED/RUNNING.
  - métricas de `GET …/metrics`: Enviados, Entregues, Bounce (SOFT+HARD), Reclamações, Descadastros, Aberturas, Cliques, "Pedidos após clique (7 dias)".
  - 503 `AI_DATABASE_NOT_CONFIGURED` → `Notice` neutro (QueryView existente).
- [ ] **Step 2:** FAIL. **Step 3:** implementar com componentes existentes (`DataTable`, `Drawer`, `KpiCard`, `StatusBadge`, `QueryView`, `Notice`), `useMutation` + `invalidateQueries(['ai/campaigns'])`; `idempotencyKey = crypto.randomUUID()` gerado ao abrir o formulário. **Step 4:** PASS. **Step 5:** commit.

### Tarefa 17: gates FASE 4 + deploy

- [ ] Gates completos (backend+frontend+build+secret scan). PR "P0B". **GATE HUMANO H8: merge.**
- [ ] Build do `main`, revisão 0% com `AI_DATABASE_URL` e flags ainda `false`; smoke + `GET /crm-api/ai/campaigns` 200 + escrita com sessão admin (criar rascunho de teste, cancelar). 100%. Rollback: revisão anterior.

## FASE 5 — P0B canário

### Tarefa 18: ligar execução com limite 50

- [ ] Pré-condição: H6 (DNS) e H7 (A–D) concluídos.
- [ ] Revisão 0% com `EMAIL_TRANSFER_MECHANISM_APPROVED=true`, `EMAIL_LEGAL_REVIEW_APPROVED=true`, `EMAIL_SEND_ENABLED=true`, `EMAIL_CAMPAIGN_EXECUTOR_ENABLED=true`, `EMAIL_CAMPAIGN_MAX_TOTAL_SENDS=50`, `EMAIL_CAMPAIGN_BATCH_SIZE=20` → smoke → `POST /jobs/process-email-campaigns` sem draft agendado retorna `enabled:true, processedDrafts:0, blockedBy` vazio.
- [ ] Criar rascunho real pela Central e aprovar (sem agendar). Exibir:
```
EMAIL CANARY READY
Eligible recipients: N   Suppressed: N   Excluded: N
Batch: <=50   From: no-reply@mail.drosamoda.com.br
Domain: verified/not verified   Legal gates: A–D status
Unsubscribe: verified (GET /unsubscribe/email com token de teste)   Executor: enabled
```
- [ ] **GATE HUMANO H9: "Autoriza o canário real?"**
- [ ] Agendar pela Central; criar Scheduler `drosa-process-email-campaigns` (`*/5 * * * *`, POST `/jobs/process-email-campaigns`, header do novo JOBS_SECRET, `--max-retry-attempts 0`).
- [ ] Após envio: métricas da campanha; critério: 0 falha sistêmica, bounce < 5%, 0 spam complaint.
- [ ] **GATE HUMANO H10: cada ampliação** (250 → 1.000 → restante) = nova revisão com `EMAIL_CAMPAIGN_MAX_TOTAL_SENDS` maior, mesmo critério. Rollback: `EMAIL_CAMPAIGN_EXECUTOR_ENABLED=false` (nova revisão) ou cancelar pela Central.

## FASE 6 — P0C contagem na Central

### Tarefa 19: contador de consentidos

**Files:** Modify `src/services/crmReadService.ts` (novo `whatsappConsentSummary()`), `src/routes/crm.routes.ts` (`GET /whatsapp-consents/summary`), `frontend/src/routes/campaigns/CampaignsPage.tsx` (aba Oportunidades: `KpiCard` "Consentimento de marketing no WhatsApp"); Tests correspondentes.
- [ ] teste backend: retorna `{ marketing: { granted, revoked }, transactional: { granted, revoked } }` a partir de `whatsappConsent.groupBy({ by: ['scope','consented'] })` considerando `revokedAt` nulo como ativo.
- [ ] implementação + teste frontend (card mostra os números da API) + commit.
- [ ] Critério: remarketing continua `eligibleCount` só com consentidos (sem mudança de código; conferir em `remarketing_runs`).

## FASE 7 — verificação completa

### Tarefa 20: verification-before-completion
- [ ] Backend `npx vitest run --no-file-parallelism`, typecheck; frontend tsc/lint/vitest/build; secret scan; smoke da URL canônica; `/health/deep` 200; Schedulers listados (sem headers: `--format="value(name.basename(),schedule,state)"`); fila sem item > 15 min; métricas do canário.

## FASE 8 — integração

### Tarefa 21: code review e fechamento
- [ ] superpowers:requesting-code-review no diff total; corrigir achados.
- [ ] superpowers:finishing-a-development-branch; PRs pendentes mesclados pelo dono; handoff curto em `docs/handoff/REVENUE_ACTIVATION_2026-09-29.md` (revisões, Schedulers, versões de secret, rollback, gates abertos).

---

## Gates humanos (resumo)

H1 merge P0A · H2 instalar extensão de consentimento (se ausente) · H3 pedido de teste · H4 canário WhatsApp ≤ 5 · H5 dono roda script do role do banco de campanhas · H6 DNS (se pendente) · H7 registro A–D · H8 merge P0B · H9 canário e-mail 50 · H10 cada ampliação.
