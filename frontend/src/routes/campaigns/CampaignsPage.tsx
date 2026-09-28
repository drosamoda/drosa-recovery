import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../components/shell/PageHeader'
import { Tabs } from '../../components/overlay/Tabs'
import { DataTable, type DataTableColumn } from '../../components/data/DataTable'
import { QueryView } from '../../components/data/QueryView'
import { CodeBadge } from '../../components/data/CodeBadge'
import { FlagBadge } from '../../components/data/FlagBadge'
import { StatCard } from '../../components/data/StatCard'
import { Field } from '../../components/data/Field'
import { Notice } from '../../components/feedback/Notice'
import { SelectFilter } from '../../components/data/FilterBar'
import { apiGet } from '../../lib/api'
import { ELIGIBILITY_REASON, EMAIL_STATUS, OPPORTUNITY_TYPE, humanize, lookup, titleContradictsCounters } from '../../lib/labels'
import type { AutomationRule, EmailAudiences, EmailLibrary, EmailRecommendation, EmailRecommendations, EmailSegment, Opportunity } from '../../lib/types'

const TABS = [
  { key: 'opportunities', label: 'Oportunidades' },
  { key: 'email', label: 'E-mail' },
  { key: 'campaigns', label: 'Campanhas' },
  { key: 'automations', label: 'Automações' },
  { key: 'learning', label: 'Aprendizados' },
]

const count = (n: number | null | undefined) => (n === null || n === undefined ? 'Não calculado' : n.toLocaleString('pt-BR'))

// Somente leitura: nenhuma acao de criar/aprovar/agendar campanha nesta tela
// (os POSTs existentes da API nao sao chamados pelo frontend novo).
export function CampaignsPage() {
  const [tab, setTab] = useState('opportunities')
  return (
    <div>
      <PageHeader title="Campanhas & IA" subtitle="Oportunidades, e-mail, automações e aprendizados. Somente leitura." />
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === 'opportunities' && <OpportunitiesTab />}
      {tab === 'email' && <EmailTab />}
      {tab === 'campaigns' && <UnavailableAware path="ai/campaigns" noun="campanhas" />}
      {tab === 'automations' && <AutomationsTab />}
      {tab === 'learning' && <UnavailableAware path="ai/learning" noun="aprendizados" />}
    </div>
  )
}

function OpportunitiesTab() {
  const [channel, setChannel] = useState('all')
  const query = useQuery({ queryKey: ['opportunities', channel], queryFn: ({ signal }) => apiGet<{ data: Opportunity[] }>(`ai/opportunities?channel=${channel}`, signal) })
  return (
    <>
      <div className="mb-4">
        <SelectFilter
          label="Canal"
          value={channel === 'all' ? '' : channel}
          options={[
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'email', label: 'E-mail' },
          ]}
          onChange={(v) => setChannel(v || 'all')}
        />
      </div>
      <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhuma oportunidade no momento." fallbackError="Falha de rede ao consultar /crm-api/ai/opportunities.">
        {(d) => (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {d.data.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} />
            ))}
          </div>
        )}
      </QueryView>
    </>
  )
}

function OpportunityCard({ opportunity: o }: { opportunity: Opportunity }) {
  const blockers = o.evidence?.topBlockers ?? []
  const contradictory = titleContradictsCounters(o.title, o.eligibleCount)
  const headline = contradictory ? (OPPORTUNITY_TYPE[o.type] ?? humanize(o.type)) : o.title
  return (
    <article className="panel enter p-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint" title={o.type}>
        {o.channel} · {humanize(o.type)}
      </p>
      <h3 className="mt-1 text-sm font-semibold text-ink" title={o.title}>
        {headline}
      </h3>
      {contradictory && (
        <p className="mt-1 rounded-md bg-status-warning/10 px-2 py-1 text-xs text-ink" data-quality-warning="title-counter-mismatch">
          DATA_QUALITY_WARNING: o título do backend (“{o.title}”) não corresponde ao contador real de elegíveis. Valem os contadores abaixo.
        </p>
      )}
      <p className="mt-1 text-sm text-ink-muted">{o.reason}</p>
      <dl className="mt-3">
        <Field label="População">{count(o.audienceCount)}</Field>
        <Field label="Elegíveis">{count(o.eligibleCount)}</Field>
        <Field label="Bloqueados">{count(o.blockedCount)}</Field>
        {o.eligibilityStatus && <Field label="Status">{humanize(o.eligibilityStatus)}</Field>}
        <Field label="Canal recomendado">{o.recommendedChannel ?? '—'}</Field>
        <Field label="Template">{o.evidence?.template ?? '—'}</Field>
        <Field label="Recomendação">{[o.recommendedTiming, o.confidence && `confiança ${o.confidence}`].filter(Boolean).join(' · ') || '—'}</Field>
      </dl>
      {blockers.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-ink-faint">Principais motivos de bloqueio</p>
          <ul className="flex flex-wrap gap-1">
            {blockers.map((b) => (
              <li key={b.reason} className="flex items-center gap-1 text-xs text-ink-muted">
                <CodeBadge code={b.reason} map={ELIGIBILITY_REASON} /> {b.count}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

function EmailTab() {
  const audiences = useQuery({ queryKey: ['email', 'audiences'], queryFn: ({ signal }) => apiGet<EmailAudiences>('email/audiences', signal) })
  const recs = useQuery({ queryKey: ['email', 'recommendations'], queryFn: ({ signal }) => apiGet<EmailRecommendations>('email/recommendations', signal) })
  const library = useQuery({ queryKey: ['email', 'library'], queryFn: ({ signal }) => apiGet<EmailLibrary>('email/campaign-library', signal) })

  const segmentColumns: DataTableColumn<EmailSegment>[] = [
    { key: 'name', label: 'Segmento', render: (s) => <span title={s.segmentKey}>{s.name}</span> },
    { key: 'audience', label: 'População', render: (s) => count(s.audienceCount) },
    { key: 'valid', label: 'Com e-mail válido', render: (s) => count(s.withValidEmailCount), hideOnMobile: true },
    { key: 'eligible', label: 'Elegíveis p/ envio', render: (s) => count(s.sendEligibleCount) },
    { key: 'blocked', label: 'Bloqueados', render: (s) => count(s.blockedCount), hideOnMobile: true },
    { key: 'status', label: 'Status', render: (s) => <span title={s.eligibilityStatus}>{lookup(EMAIL_STATUS, s.eligibilityStatus)?.label}</span>, hideOnMobile: true },
  ]
  const recColumns: DataTableColumn<EmailRecommendation>[] = [
    { key: 'priority', label: '#', render: (r) => r.priority },
    { key: 'name', label: 'Campanha recomendada', render: (r) => <span title={r.campaignKey}>{r.campaignName}</span> },
    { key: 'segment', label: 'Segmento', render: (r) => r.segmentName, hideOnMobile: true },
    { key: 'audience', label: 'População', render: (r) => count(r.audienceCount), hideOnMobile: true },
    { key: 'requirements', label: 'Requisitos', render: (r) => <span title={r.requirementsStatus}>{lookup(EMAIL_STATUS, r.requirementsStatus)?.label}</span> },
    { key: 'blockers', label: 'Bloqueios de envio', render: (r) => (r.sendBlockers.length ? r.sendBlockers.map(humanize).join(', ') : '—'), hideOnMobile: true },
  ]

  return (
    <div className="space-y-6">
      <Notice>
        Métricas de abertura, clique, bounce e descadastro não são expostas pela API atual <span className="text-ink-faint">(NOT_AVAILABLE_FROM_CURRENT_API)</span>. Esta aba não altera envio, credenciais, domínios, webhooks, templates ou filas.
      </Notice>
      <QueryView query={library} emptyTitle="" fallbackError="Falha ao consultar /crm-api/email/campaign-library.">
        {(l) => (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Campanhas na biblioteca" value={l.total} hint={`versão ${l.libraryVersion}`} />
            <StatCard label="Prontas" value={l.ready} />
            <StatCard label="Precisam de dados" value={l.needsData} />
            <StatCard label="Gate de envio" value={l.sendGate.allowed ? 'Liberado' : 'Bloqueado'} hint={l.sendGate.missing.length ? `Falta: ${l.sendGate.missing.join(', ')}` : undefined} />
          </div>
        )}
      </QueryView>
      <QueryView query={audiences} emptyTitle="" fallbackError="Falha ao consultar /crm-api/email/audiences.">
        {(a) => (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <StatCard label="Clientes" value={a.base.totalCustomers.toLocaleString('pt-BR')} />
              <StatCard label="E-mail conhecido" value={a.base.emailKnown.toLocaleString('pt-BR')} />
              <StatCard label="E-mail válido" value={a.base.emailValid.toLocaleString('pt-BR')} />
              <StatCard label="E-mail inválido" value={a.base.emailInvalid.toLocaleString('pt-BR')} />
              <StatCard label="Supressões excluídas" value={a.suppression.excludedCount.toLocaleString('pt-BR')} hint={lookup(EMAIL_STATUS, a.suppression.status)?.label} />
            </div>
            <h3 className="mb-2 mt-6 text-sm font-semibold text-ink">Segmentos</h3>
            <DataTable columns={segmentColumns} rows={a.segments} rowKey={(s) => s.segmentKey} />
          </>
        )}
      </QueryView>
      <QueryView query={recs} emptyTitle="" fallbackError="Falha ao consultar /crm-api/email/recommendations.">
        {(r) => (
          <>
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Recomendações ({r.summary.actionable} acionáveis de {r.summary.total})
            </h3>
            <DataTable columns={recColumns} rows={r.plan} rowKey={(x) => x.campaignKey} />
          </>
        )}
      </QueryView>
    </div>
  )
}

function AutomationsTab() {
  const query = useQuery({ queryKey: ['automations'], queryFn: ({ signal }) => apiGet<{ data: AutomationRule[] }>('automations', signal) })
  const columns: DataTableColumn<AutomationRule>[] = [
    { key: 'name', label: 'Automação', render: (a) => a.name },
    { key: 'event', label: 'Evento', render: (a) => a.eventType, hideOnMobile: true },
    { key: 'template', label: 'Template', render: (a) => a.templateName, hideOnMobile: true },
    { key: 'delay', label: 'Atraso', render: (a) => `${a.delayMinutes} min` },
    { key: 'active', label: 'Regra', render: (a) => (a.active ? 'Ativa' : 'Inativa') },
    { key: 'flow', label: 'Fluxo', render: (a) => <FlagBadge name="flowEnabled" label="Fluxo" value={a.runtime.flowEnabled} />, hideOnMobile: true },
  ]
  return (
    <QueryView query={query} isEmpty={(d) => d.data.length === 0} emptyTitle="Nenhuma automação cadastrada." fallbackError="Falha de rede ao consultar /crm-api/automations.">
      {(d) => (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <FlagBadge name="ENABLE_INTERNAL_CRON" label="Cron" value={d.data[0]?.runtime.cronEnabled} />
            <FlagBadge name="AUTOMATION_SEND_ENABLED" label="Envio automático" value={d.data[0]?.runtime.automationSendEnabled} />
            <FlagBadge name="WHATSAPP_DRY_RUN" label="Dry-run WhatsApp" value={d.data[0]?.runtime.whatsappDryRun} />
          </div>
          <DataTable columns={columns} rows={d.data} rowKey={(a) => a.id} />
        </>
      )}
    </QueryView>
  )
}

// Campanhas/Aprendizados dependem de AI_DATABASE_URL; em producao a API
// responde 503 AI_DATABASE_NOT_CONFIGURED e o QueryView mostra aviso neutro.
function UnavailableAware({ path, noun }: { path: string; noun: string }) {
  const query = useQuery({ queryKey: [path], queryFn: ({ signal }) => apiGet<{ data?: unknown[] }>(path, signal) })
  return (
    <QueryView query={query} isEmpty={(d) => !d.data || d.data.length === 0} emptyTitle={`Nenhum registro de ${noun}.`} fallbackError={`Falha de rede ao consultar /crm-api/${path}.`}>
      {(d) => <Notice>{d.data?.length ?? 0} registros de {noun} disponíveis; visualização detalhada fica para quando o recurso for ativado.</Notice>}
    </QueryView>
  )
}
