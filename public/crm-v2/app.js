/* D'Rosa CRM v2 — operação somente leitura sobre /crm-api (backend intocado nesta missão).
   Zero dependências externas, zero build step — mesma filosofia de public/crm e public/inbox.
   Nenhum dado é inventado: onde o /crm-api real retorna null/NOT_AVAILABLE, a tela mostra isso
   honestamente (nunca um zero ou um número calculado à parte no cliente). */

// ── Navegação: grupos + telas ────────────────────────────────────────────────────────────────
const GROUPS = [
  { key: 'overview', label: 'Visão Geral', views: [['dashboard', 'Dashboard']] },
  { key: 'crm', label: 'CRM', views: [['customers', 'Clientes'], ['conversations', 'Conversas']] },
  { key: 'messaging', label: 'Mensageria', views: [['messages', 'Envios'], ['templates', 'Templates'], ['consents', 'Consentimentos']] },
  { key: 'recovery', label: 'Recuperação', views: [['checkouts', 'Carrinho'], ['pix', 'Pix'], ['boleto', 'Boleto'], ['remarketing', 'Remarketing']] },
  { key: 'ops', label: 'Operação', views: [['automations', 'Automações'], ['health', 'Saúde'], ['audit', 'Auditoria']] },
]
const VIEW_INDEX = {}
const VIEW_TO_GROUP = {}
GROUPS.forEach(g => g.views.forEach(([key, label]) => { VIEW_INDEX[key] = label; VIEW_TO_GROUP[key] = g.key }))
const VIEW_META = {
  dashboard: 'O que está acontecendo agora.',
  customers: 'Identidade, pedidos e políticas de contato.',
  conversations: 'Inbox operacional em modo somente leitura.',
  messages: 'Central de mensagens e estados reais do provedor.',
  checkouts: 'Elegibilidade calculada pelas regras já existentes.',
  pix: 'Pedidos Pix e falhas de mensagem observadas.',
  boleto: 'Pedidos por boleto e falhas de mensagem observadas.',
  remarketing: 'Execuções, públicos e bloqueios já existentes.',
  automations: 'Regra configurada versus liberação real em runtime.',
  templates: 'Contratos locais de template e uso observado.',
  consents: 'Consentimento, opt-out e suppression são conceitos distintos.',
  health: 'Evidência real e freshness das integrações.',
  audit: 'Eventos técnicos comprovados — nunca um ledger completo fingido.',
}

// ── Humanização (nunca expor enum cru na UI principal) ──────────────────────────────────────
const MESSAGE_STATUS = { pending: ['Pendente', 'neutral'], processing: ['Processando', 'neutral'], sent: ['Enviada', 'brand'], delivered: ['Entregue', 'success'], read: ['Lida', 'success'], failed: ['Falhou', 'danger'], skipped: ['Ignorada', 'neutral'], unknown: ['Status incerto', 'warning'] }
const FAILURE_CATEGORY = { TEMPLATE_CONFIGURATION: 'Erro de configuração do template', PROVIDER_REJECTION: 'Rejeitado pelo provedor (Meta)', RETRY_EXHAUSTED: 'Tentativas esgotadas', CONSENT_BLOCK: 'Sem consentimento WhatsApp', SUPPRESSION_BLOCK: 'Contato suprimido', DATA_QUALITY: 'Dado inválido ou incompleto', NETWORK_TRANSIENT: 'Falha de rede temporária', DELIVERY_UNKNOWN: 'Entrega não confirmada', INTERNAL_ERROR: 'Erro interno', UNKNOWN_REASON: 'Motivo não identificado' }
const CHECKOUT_BLOCKERS = { missing_phone: 'Sem telefone cadastrado', invalid_phone: 'Telefone inválido', missing_recovery_url: 'Sem link de recuperação', invalid_recovery_url: 'Link de recuperação inválido', converted: 'Já convertido em pedido', skipped: 'Marcado para pular', already_sent: 'Mensagem já enviada para este carrinho', cooldown_active: 'Cliente em período de espera (cooldown)', order_after_checkout: 'Pedido já realizado após o carrinho', order_timing_uncertain: 'Momento do pedido incerto', opt_out: 'Cliente optou por não receber mensagens', consent_unproven: 'Sem consentimento WhatsApp comprovado', too_recent: 'Ainda dentro da janela de espera', too_old: 'Fora da janela de recuperação', invalid_template: 'Template de mensagem indisponível', invalid_template_data: 'Dados insuficientes para montar a mensagem', invalid_encoding: 'Erro de formatação na mensagem', unknown_checkout_state: 'Estado do carrinho não reconhecido', evaluation_unavailable: 'Avaliação de elegibilidade indisponível' }
const CONSENT_STATUS = { GRANTED: ['Concedido', 'success'], REVOKED: ['Revogado', 'danger'], UNKNOWN: ['Desconhecido', 'neutral'] }
const CHECKOUT_STATUS = { abandoned: ['Abandonado', 'warning'], converted: ['Convertido', 'success'], skipped: ['Ignorado', 'neutral'] }
const CONVERSATION_STATUS = { open: ['Aberta', 'brand'], pending: ['Pendente', 'warning'], closed: ['Encerrada', 'neutral'] }
const REMARKETING_SEGMENT = { abandoned_cart: 'Carrinho abandonado', pix_pending: 'Pix pendente', boleto_pending: 'Boleto pendente', recent_customer: 'Cliente recente', inactive_customer: 'Cliente inativo', vip_customer: 'VIP', engaged_no_purchase: 'Engajado sem compra' }
const REMARKETING_MODE = { preview: 'Simulação', send: 'Envio' }
const REMARKETING_RUN_STATUS = { running: ['Em execução', 'brand'], completed: ['Concluído', 'success'], failed: ['Falhou', 'danger'] }
const REMARKETING_RECIPIENT_STATUS = { eligible: 'Elegível', suppressed: 'Suprimido', queued: 'Na fila', sent: 'Enviado', failed: 'Falhou' }
const TEMPLATE_CATEGORY = { utility: 'Utilidade', marketing: 'Marketing', authentication: 'Autenticação' }
const EVENT_TYPE = { order_created: 'Pedido criado', abandoned_checkout: 'Carrinho abandonado' }
const ENTITY_TYPE = { order: 'Pedido', abandoned_checkout: 'Carrinho abandonado' }
const MIRROR_STATUS = { pending: ['Pendente', 'neutral'], processing: ['Processando', 'neutral'], mirrored: ['Espelhado', 'success'], failed: ['Falhou', 'danger'] }

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
function fmtValue(v) { if (v === null || v === undefined || v === '') return '—'; if (typeof v === 'object') return '<span class="cell-muted">Ver dados técnicos</span>'; return esc(v) }
function num(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR') }
function money(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function dt(v) { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function dOnly(v) { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR') }
function timeOnly(v) { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }
function pill(label, tone) { return `<span class="pill ${tone}"><span class="dot"></span>${esc(label)}</span>` }
function statusPill(status, dict) { const [label, tone] = dict[status] || [status || '—', 'neutral']; return pill(label, tone) }
function boolLabel(v) { return v === true ? 'Sim' : v === false ? 'Não' : '—' }
function initials(name) { if (!name) return '?'; const parts = String(name).trim().split(/\s+/); return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?' }

// ── Estado + autenticação ────────────────────────────────────────────────────────────────────
const state = { group: 'overview', view: 'dashboard', page: 1, secret: sessionStorage.getItem('crmV2Secret') || '', search: '', period: 'today', sub: null }
$('secret').value = state.secret
$('connect').onclick = () => { state.secret = $('secret').value.trim(); sessionStorage.setItem('crmV2Secret', state.secret); render() }
$('disconnect').onclick = () => { state.secret = ''; sessionStorage.removeItem('crmV2Secret'); $('secret').value = ''; state.search = ''; state.page = 1; closePanel(); render() }
$('closePanel').onclick = $('backdrop').onclick = closePanel
function closePanel() { $('panel').classList.add('hidden'); $('backdrop').classList.add('hidden') }
function openPanel(html) { $('panelContent').innerHTML = html; $('panel').classList.remove('hidden'); $('backdrop').classList.remove('hidden') }

async function api(path) {
  const r = await fetch('/crm-api/' + path, { headers: { 'x-crm-read-secret': state.secret } })
  if (r.status === 401) throw new Error('Segredo de leitura inválido ou ausente.')
  if (!r.ok) throw new Error('Falha ao carregar dados reais desta tela.')
  return r.json()
}

// ── Navegação: render dos dois níveis ────────────────────────────────────────────────────────
function renderNav() {
  $('groupNav').innerHTML = GROUPS.map(g => `<button data-group="${g.key}" class="${g.key === state.group ? 'active' : ''}">${esc(g.label)}</button>`).join('')
  const group = GROUPS.find(g => g.key === state.group)
  const showSub = group.views.length > 1
  $('subNav').classList.toggle('empty', !showSub)
  $('subNav').innerHTML = showSub ? group.views.map(([key, label]) => `<button data-view="${key}" class="${key === state.view ? 'active' : ''}">${esc(label)}</button>`).join('') : ''
  $('pageTitle').textContent = VIEW_INDEX[state.view]
  $('pageSubtitle').textContent = VIEW_META[state.view]
  $('connection').textContent = state.secret ? 'Autenticado (somente leitura)' : 'Desconectado'
}
$('groupNav').onclick = e => { const b = e.target.closest('[data-group]'); if (!b) return; state.group = b.dataset.group; state.view = GROUPS.find(g => g.key === state.group).views[0][0]; state.page = 1; state.sub = null; render() }
$('subNav').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; state.view = b.dataset.view; state.page = 1; state.sub = null; render() }

// ── Router ───────────────────────────────────────────────────────────────────────────────────
async function render() {
  renderNav()
  if (!state.secret) { $('toolbar').innerHTML = ''; $('content').innerHTML = `<div class="gate"><h2>Conectar ao CRM</h2><p>Informe o segredo de leitura para consultar os dados operacionais. Este acesso é somente leitura — nenhuma ação de envio ou alteração fica disponível aqui.</p></div>`; return }
  await load()
}
async function load() {
  renderToolbar()
  $('content').innerHTML = '<div class="skeleton">' + Array.from({ length: 6 }).map(() => '<div class="sk-row"></div>').join('') + '</div>'
  try {
    const loaders = { dashboard: renderDashboard, customers: () => state.sub ? renderCustomer360(state.sub) : renderCustomers(), conversations: renderConversations, messages: renderMessages, checkouts: renderCheckouts, pix: () => renderPayments('pix'), boleto: () => renderPayments('boleto'), remarketing: renderRemarketing, automations: renderAutomations, templates: renderTemplates, consents: renderConsents, health: renderHealth, audit: renderAudit }
    await loaders[state.view]()
  } catch (e) {
    $('content').innerHTML = `<div class="error-state"><h3>Não foi possível carregar esta tela</h3><p>${esc(e.message)}</p><button class="btn btn-ghost" id="retryBtn">Tentar de novo</button></div>`
    const btn = $('retryBtn'); if (btn) btn.onclick = load
  }
}
function renderToolbar() {
  if (state.view === 'dashboard') { $('toolbar').innerHTML = `<div class="seg" id="periodSeg">${[['today', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias']].map(([k, l]) => `<button data-p="${k}" class="${state.period === k ? 'active' : ''}">${l}</button>`).join('')}</div>`; $('periodSeg').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; state.period = b.dataset.p; load() }; return }
  if (['customers', 'conversations', 'messages'].includes(state.view) && !state.sub) { $('toolbar').innerHTML = `<input type="search" id="searchInput" placeholder="Buscar por nome ou telefone" value="${esc(state.search)}"><button class="btn btn-ghost btn-sm" id="searchBtn">Buscar</button>`; $('searchBtn').onclick = () => { state.search = $('searchInput').value.trim(); state.page = 1; load() }; $('searchInput').onkeydown = e => { if (e.key === 'Enter') $('searchBtn').click() }; return }
  $('toolbar').innerHTML = ''
}

// ── Tabela genérica reutilizável ─────────────────────────────────────────────────────────────
function renderTable({ rows, columns, pagination, onRowClick, rowClass }) {
  const cols = columns
  const body = rows.length ? rows.map(r => `<tr class="${rowClass ? rowClass(r) : ''}" data-id="${esc(r.id)}">${cols.map(c => `<td>${c.render ? c.render(r) : fmtValue(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="cell-muted">Nenhum registro encontrado.</td></tr>`
  const html = `<div class="panel"><div class="panel-head"><b>${rows.length} nesta página</b><span>${pagination ? num(pagination.total) + ' no total' : ''}</span></div><div class="table-wrap"><table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>${pager(pagination)}</div>`
  return { html, wire: (container) => { if (onRowClick) container.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => onRowClick(tr.dataset.id)); wirePager() } }
}
function pager(p) { return p ? `<div class="pagination"><span>Página ${p.page} de ${p.pages || 1}</span><button id="prevPage" ${p.page <= 1 ? 'disabled' : ''}>Anterior</button><button id="nextPage" ${p.page >= p.pages ? 'disabled' : ''}>Próxima</button></div>` : '' }
function wirePager() { const prev = $('prevPage'), next = $('nextPage'); if (prev) prev.onclick = () => { state.page--; load() }; if (next) next.onclick = () => { state.page++; load() } }

// ── DASHBOARD ────────────────────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const [d, health] = await Promise.all([api('dashboard?period=' + state.period), api('health').catch(() => null)])
  const m = d.messages || {}
  const otherStatuses = Object.keys(m).filter(k => !['total', 'sent', 'delivered', 'read'].includes(k))

  const hero = `
    <div class="kpi-hero">
      <div class="kpi-hero-figure"><span class="n">${num(m.total)}</span><span class="l">Mensagens criadas no período</span></div>
      <div class="kpi-chain">
        <div class="kpi-chain-row"><span class="arrow">↳</span> Enviadas <b>${num(m.sent)}</b></div>
        <div class="kpi-chain-row muted"><span class="arrow">↳</span> Entregues <b>${fmtValue(m.delivered)}</b><span style="font-size:11px">(sem agregação disponível nesta janela)</span></div>
        <div class="kpi-chain-row muted"><span class="arrow">↳</span> Lidas <b>${fmtValue(m.read)}</b><span style="font-size:11px">(sem agregação disponível nesta janela)</span></div>
      </div>
    </div>
    <div class="status-chip-row">${otherStatuses.map(k => `<span class="status-chip">${statusPill(k, MESSAGE_STATUS)}<span class="n">${num(m[k])}</span></span>`).join('') || '<span class="cell-muted">Sem outros status registrados no período.</span>'}</div>
    <div class="status-chip-row">
      <span class="status-chip">Clientes contatados <span class="n">${num(d.contactedCustomers)}</span></span>
      <span class="status-chip">Mensagens recebidas <span class="n">${num(d.inboundMessages)}</span></span>
      <span class="status-chip">Conversas com retorno <span class="n">${num(d.inboundConversations)}</span></span>
    </div>`

  const funnels = `
    <div class="section-block"><div class="section-block-head"><h2>Funis de recuperação</h2><span class="hint">Somente dados reais desta janela</span></div>
      <div class="funnel-grid">
        <div class="funnel-card"><h3>Carrinho abandonado</h3><div class="funnel-steps">
          <div class="funnel-step"><span class="l">Detectados</span><span class="v">${num(d.abandonedCheckouts)}</span></div>
          <div class="funnel-step"><span class="l">Elegíveis (agregado)</span><span class="v cell-muted">${fmtValue(d.eligibleCheckouts)}</span></div>
          <div class="funnel-step"><span class="l">Convertidos</span><span class="v">${num(d.convertedCheckouts)}</span></div>
        </div><p class="hint" style="margin-top:10px">Elegibilidade por item real em Carrinho →</p></div>
        <div class="funnel-card"><h3>Pix pendente</h3><div class="funnel-steps"><div class="funnel-step"><span class="l">Pedidos pendentes</span><span class="v">${num(d.pixPending)}</span></div></div><p class="hint" style="margin-top:10px">Detalhamento por pedido em Pix →</p></div>
        <div class="funnel-card"><h3>Boleto pendente</h3><div class="funnel-steps"><div class="funnel-step"><span class="l">Pedidos pendentes</span><span class="v">${num(d.boletoPending)}</span></div></div><p class="hint" style="margin-top:10px">Detalhamento por pedido em Boleto →</p></div>
      </div>
    </div>`

  const alerts = health ? buildAlerts(health) : '<div class="alert-ok"><span class="dot"></span>Não foi possível carregar a Saúde para checar alertas agora.</div>'

  let activity = ''
  try {
    const recent = await api('messages?page=1&pageSize=12')
    activity = `<div class="section-block"><div class="section-block-head"><h2>Atividade recente</h2><span class="hint">Últimas mensagens criadas, com o status atual real</span></div>
      <div class="timeline-feed">${(recent.data || []).map(r => `<div class="timeline-feed-row"><time>${timeOnly(r.createdAt)}</time><div class="event"><b>${esc(r.template || 'Mensagem')}</b> para ${esc(r.customer || 'contato sem nome')} · ${statusPill(r.status, MESSAGE_STATUS)}</div></div>`).join('') || '<p class="cell-muted">Nenhuma mensagem criada ainda.</p>'}</div></div>`
  } catch { /* atividade recente é complementar — uma falha aqui não derruba o resto do dashboard */ }

  $('content').innerHTML = hero + `<div class="section-block"><div class="section-block-head"><h2>Alertas</h2></div>${alerts}</div>` + funnels + activity
}

function buildAlerts(h) {
  const rows = []
  if (!h.meta.configured) rows.push(['warning', 'Meta não está totalmente configurada'])
  if (h.meta.latestEvidence?.error) rows.push(['danger', 'Última evidência do webhook Meta veio com erro', h.meta.latestEvidence.error])
  if (h.meta.latestEvidence && isStale(h.meta.latestEvidence.createdAt)) rows.push(['warning', 'Webhook Meta sem evento novo há mais de 24h'])
  if (!h.nuvemshop.configured) rows.push(['warning', 'Nuvemshop não está totalmente configurada'])
  if (h.nuvemshop.latestEvidence?.error) rows.push(['danger', 'Última evidência do webhook Nuvemshop veio com erro', h.nuvemshop.latestEvidence.error])
  if (h.nuvemshop.latestEvidence && isStale(h.nuvemshop.latestEvidence.createdAt)) rows.push(['warning', 'Webhook Nuvemshop sem evento novo há mais de 24h'])
  if (h.recoveryEngine.failed > 0) rows.push(['danger', 'Mensagens com falha aguardando revisão', null, h.recoveryEngine.failed])
  if (h.recoveryEngine.unknown > 0) rows.push(['warning', 'Mensagens com status desconhecido (unknown)', null, h.recoveryEngine.unknown])
  if (h.inboxMirror.failed > 0) rows.push(['warning', 'Mensagens não espelhadas no inbox', null, h.inboxMirror.failed])
  if (!rows.length) return '<div class="alert-ok"><span class="dot"></span>Operação normal — nenhuma anomalia crítica encontrada.</div>'
  return '<div class="alerts-list">' + rows.map(([tone, label, detail, count]) => `<div class="alert-row ${tone === 'warning' ? 'warning' : ''}"><span class="dot"></span><b>${esc(label)}</b>${detail ? `<span class="cell-muted">· ${esc(detail)}</span>` : ''}${count !== undefined ? `<span class="count">${num(count)}</span>` : ''}</div>`).join('') + '</div>'
}
function isStale(createdAt) { if (!createdAt) return false; return (Date.now() - new Date(createdAt).getTime()) > 24 * 3600 * 1000 }

// ── CLIENTES + 360 ───────────────────────────────────────────────────────────────────────────
async function renderCustomers() {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' }); if (state.search) qs.set('search', state.search)
  const d = await api('customers?' + qs)
  const columns = [
    { label: 'Cliente', render: r => `<b>${esc(r.name || 'Sem nome')}</b>` },
    { label: 'Telefone', render: r => `<span class="cell-mono">${fmtValue(r.phone)}</span>` },
    { label: 'Última compra', render: r => dOnly(r.lastOrder) },
    { label: 'Último contato', render: r => dOnly(r.lastContact) },
    { label: 'Mensagens', render: r => num(r.messages) },
    { label: 'Consentimento', render: r => statusPill(r.consent, CONSENT_STATUS) },
    { label: 'Status', render: r => r.optOut ? pill('Opt-out', 'danger') : r.suppressed ? pill('Suprimido', 'danger') : pill('Normal', 'success') },
  ]
  const { html, wire } = renderTable({ rows: d.data, columns, pagination: d.pagination, onRowClick: id => { state.sub = id; state.page = 1; load() }, rowClass: () => 'clickable' })
  $('content').innerHTML = html; wire($('content'))
}

async function renderCustomer360(id) {
  const d = await api('customers/' + id)
  const tab = state.customerTab || 'overview'
  const tabs = [['overview', 'Visão geral'], ['orders', 'Pedidos'], ['messages', 'Mensagens'], ['conversations', 'Conversas'], ['checkouts', 'Carrinhos'], ['privacy', 'Privacidade']]
  const head = `
    <button class="btn btn-ghost btn-sm" id="backToList" style="margin-bottom:14px">← Clientes</button>
    <div class="c360-head"><div>
      <p class="eyebrow">CLIENTE</p>
      <h1>${esc(d.name || 'Sem nome')}</h1>
      <div class="c360-meta">
        <span>Telefone <b>${fmtValue(d.phone)}</b></span>
        <span>E-mail <b>${fmtValue(d.email)}</b></span>
        <span>Opt-out <b>${boolLabel(d.optOut)}</b></span>
        <span>Pedidos <b>${num(d.orders.length)}</b></span>
        <span>Mensagens <b>${num(d.messages.length)}</b></span>
        <span>Conversas <b>${num(d.conversations.length)}</b></span>
      </div>
    </div></div>
    <div class="c360-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="c360Body"></div>`
  $('content').innerHTML = head
  $('backToList').onclick = () => { state.sub = null; load() }
  $('.c360-tabs')
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.customerTab = b.dataset.tab; load() })
  $('c360Body').innerHTML = renderCustomer360Tab(tab, d)
}
function renderCustomer360Tab(tab, d) {
  if (tab === 'overview') return `<div class="kv-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kv"><span>Última compra</span><b>${d.orders[0] ? dOnly(d.orders[0].date) : '—'}</b></div>
      <div class="kv"><span>Último contato</span><b>${d.messages[0] ? dOnly(d.messages[0].createdAt) : '—'}</b></div>
      <div class="kv"><span>Suprimido</span><b>${d.suppression ? 'Sim — ' + esc(d.suppression.reason || 'motivo não informado') : 'Não'}</b></div>
      <div class="kv"><span>Consentimentos ativos</span><b>${num(d.consents.filter(c => c.consented && !c.revokedAt).length)}</b></div>
      <div class="kv"><span>Carrinhos abandonados</span><b>${num(d.checkouts.length)}</b></div>
      <div class="kv"><span>Opt-out</span><b>${boolLabel(d.optOut)}</b></div>
    </div>`
  if (tab === 'orders') return simpleList(d.orders, o => `<div class="row"><b>${esc(o.orderNumber || o.id)}</b><span>${money(o.total)}</span><span>${esc(o.paymentMethod || '—')}</span>${pill(o.paymentStatus || '—', 'neutral')}<time>${dOnly(o.date)}</time></div>`)
  if (tab === 'messages') return simpleList(d.messages, m => `<div class="row"><b>${esc(m.templateName || 'Mensagem')}</b>${statusPill(m.status, MESSAGE_STATUS)}<span class="cell-muted">${esc(ENTITY_TYPE[m.entityType] || m.entityType || '')}</span><time>${dt(m.createdAt)}</time></div>`)
  if (tab === 'conversations') return simpleList(d.conversations, c => `<div class="row">${statusPill(c.status, CONVERSATION_STATUS)}<time>Última mensagem: ${dt(c.lastMessageAt)}</time></div>`)
  if (tab === 'checkouts') return simpleList(d.checkouts, c => `<div class="row"><b>${esc(c.checkout || c.id)}</b><span>${money(c.total)}</span>${statusPill(c.status, CHECKOUT_STATUS)}<time>${dOnly(c.date)}</time></div>`)
  if (tab === 'privacy') return `<div class="section-block"><h2 style="font-size:13.5px;margin-bottom:10px">Consentimentos</h2>${simpleList(d.consents, c => `<div class="row"><b>${esc(c.scope)}</b>${pill(c.consented && !c.revokedAt ? 'Concedido' : 'Revogado', c.consented && !c.revokedAt ? 'success' : 'danger')}<span class="cell-muted">${esc(c.source || '—')}</span><time>${dOnly(c.consentedAt)}</time></div>`)}</div>
    <div class="section-block"><h2 style="font-size:13.5px;margin-bottom:10px">Suppression</h2>${d.suppression ? `<div class="kv"><span>Motivo</span><b>${fmtValue(d.suppression.reason)}</b></div>` : '<p class="cell-muted">Nenhuma suppression registrada para este contato.</p>'}</div>`
  return ''
}
function simpleList(rows, renderRow) { return `<div class="panel"><div class="table-wrap" style="padding:4px 0">${rows.length ? rows.map(r => `<div style="padding:10px 15px;border-bottom:1px solid var(--line);display:flex;gap:14px;align-items:center;font-size:12.5px">${renderRow(r)}</div>`).join('') : '<div style="padding:24px;text-align:center" class="cell-muted">Nenhum registro.</div>'}</div></div>` }

// ── CONVERSAS (inbox 3 colunas) ──────────────────────────────────────────────────────────────
async function renderConversations() {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' }); if (state.search) qs.set('search', state.search)
  const d = await api('conversations?' + qs)
  const activeId = state.sub
  const listHtml = (d.data || []).map(r => `<div class="inbox-list-row ${r.id === activeId ? 'active' : ''}" data-id="${esc(r.id)}"><div class="top"><span>${esc(r.contact || 'Sem nome')}</span><time>${dt(r.lastMessageAt)}</time></div><div class="preview">${esc(r.preview || '')}</div><div>${statusPill(r.status, CONVERSATION_STATUS)}</div></div>`).join('') || '<div class="inbox-empty">Nenhuma conversa encontrada.</div>'
  $('content').innerHTML = `<div class="inbox-grid"><div class="inbox-list">${listHtml}</div><div class="inbox-thread" id="thread"><div class="inbox-empty">Selecione uma conversa</div></div><div class="inbox-context" id="threadContext"></div></div>`
  document.querySelectorAll('.inbox-list-row[data-id]').forEach(row => row.onclick = () => { state.sub = row.dataset.id; loadConversationThread(row.dataset.id) })
  if (activeId) loadConversationThread(activeId)
}
async function loadConversationThread(id) {
  document.querySelectorAll('.inbox-list-row').forEach(r => r.classList.toggle('active', r.dataset.id === id))
  $('thread').innerHTML = '<div class="skeleton" style="padding:16px"><div class="sk-row"></div><div class="sk-row"></div></div>'
  try {
    const c = await api('conversations/' + id)
    const bubbles = (c.messages || []).map(m => `<div class="bubble ${m.direction === 'inbound' ? 'in' : 'out'}">${esc(m.body || `[${m.type}]`)}<time>${dt(m.timestamp || m.createdAt)}</time></div>`).join('') || '<div class="inbox-empty">Sem mensagens nesta conversa.</div>'
    $('thread').innerHTML = `<div class="inbox-thread-head">${esc(c.contact?.name || 'Sem nome')} · ${statusPill(c.status, CONVERSATION_STATUS)}</div><div class="inbox-thread-body">${bubbles}</div>`
    $('threadContext').innerHTML = `<p class="eyebrow">CONTATO</p><div class="kv" style="margin-bottom:10px"><span>Telefone</span><b>${fmtValue(c.contact?.phone)}</b></div><p class="cell-muted" style="font-size:11.5px">Painel somente leitura — sem opções de envio ou alteração de status a partir daqui.</p>`
  } catch (e) { $('thread').innerHTML = `<div class="inbox-empty">${esc(e.message)}</div>` }
}

// ── ENVIOS (mensagens) ───────────────────────────────────────────────────────────────────────
async function renderMessages() {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' }); if (state.search) qs.set('search', state.search)
  const d = await api('messages?' + qs)
  const columns = [
    { label: 'Hora', render: r => dt(r.createdAt) },
    { label: 'Cliente', render: r => esc(r.customer || 'Sem nome') },
    { label: 'Fluxo', render: r => esc(ENTITY_TYPE[r.entityType] || r.entityType || '—') },
    { label: 'Template', render: r => `<span class="cell-mono">${fmtValue(r.template)}</span>` },
    { label: 'Status', render: r => statusPill(r.status, MESSAGE_STATUS) },
    { label: 'Tentativas', render: r => num(r.attempts) },
    { label: 'Motivo', render: r => r.failureCategory ? FAILURE_CATEGORY[r.failureCategory] || r.failureCategory : '<span class="cell-muted">—</span>' },
  ]
  const { html, wire } = renderTable({ rows: d.data, columns, pagination: d.pagination, onRowClick: id => openMessageDetail(id), rowClass: () => 'clickable' })
  $('content').innerHTML = html; wire($('content'))
}
async function openMessageDetail(id) {
  try {
    const m = await api('messages/' + id)
    const steps = (m.timeline || []).map((s, i) => ({ criada: 'Criada', scheduled: 'Agendada', accepted: 'Meta aceitou', sent: 'Enviada', delivered: 'Entregue', read: 'Lida' }[s.stage] || s.stage)).map((label, i) => ({ label, at: m.timeline[i].at }))
    const failedAtEnd = m.status === 'failed' || m.status === 'unknown'
    const stepperHtml = steps.map((s, i) => `<div class="step ${i === steps.length - 1 ? (failedAtEnd ? 'failed' : 'current') : 'done'}"><span class="node"></span><div><div class="label">${esc(s.label)}</div><div class="time">${dt(s.at)}</div></div></div>`).join('')
    openPanel(`
      <p class="eyebrow">DETALHE DA MENSAGEM · SOMENTE LEITURA</p>
      <div class="panel-block"><h2>${esc(m.customer?.name || 'Cliente sem nome')}</h2><div class="kv-grid"><div class="kv"><span>Telefone</span><b>${fmtValue(m.phone)}</b></div><div class="kv"><span>Origem</span><b>${esc(ENTITY_TYPE[m.entityType] || m.entityType || '—')}</b></div></div></div>
      <div class="panel-block"><p class="eyebrow">MENSAGEM</p><div class="kv-grid"><div class="kv"><span>Template</span><b class="cell-mono">${fmtValue(m.templateName)}</b></div><div class="kv"><span>Idioma</span><b>${fmtValue(m.templateLanguage)}</b></div></div>${m.renderedPreview ? `<div class="kv" style="margin-top:8px"><span>Prévia</span><b>${esc(m.renderedPreview)}</b></div>` : ''}</div>
      <div class="panel-block"><p class="eyebrow">STATUS</p><div class="stepper">${stepperHtml}</div>${m.failureCategory ? `<div class="notice" style="margin-top:10px">${esc(FAILURE_CATEGORY[m.failureCategory] || m.failureCategory)}</div>` : ''}</div>
      <details class="tech-toggle"><summary>Dados técnicos</summary><div class="tech-kv">
        <span>Meta Message ID</span><b>${fmtValue(m.metaMessageId)}</b>
        <span>Entity ID</span><b>${fmtValue(m.entityId)}</b>
        <span>Retry count</span><b>${fmtValue(m.retryCount)}</b>
        <span>Error code</span><b>${fmtValue(m.errorCode)}</b>
        <span>Reason (bruto)</span><b>${fmtValue(m.reason)}</b>
        <span>Mirror status</span><b>${fmtValue(m.mirrorStatus)}</b>
        <span>Mirrored at</span><b>${dt(m.mirroredAt)}</b>
      </div></details>`)
  } catch (e) { alert(e.message) }
}

// ── CARRINHO (pipeline) ──────────────────────────────────────────────────────────────────────
async function renderCheckouts() {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' })
  const d = await api('checkouts?' + qs)
  const rows = d.data || []
  const detected = rows.length, eligible = rows.filter(r => r.eligible === true).length, withMsg = rows.filter(r => r.message).length, converted = rows.filter(r => r.status === 'converted').length
  const pipeline = `<div class="pipeline">
    <div class="pipeline-step"><div class="n">${num(detected)}</div><div class="l">Abandonados (nesta página)</div></div>
    <div class="pipeline-step"><div class="n">${num(eligible)}</div><div class="l">Elegíveis agora</div></div>
    <div class="pipeline-step"><div class="n">${num(withMsg)}</div><div class="l">Com mensagem registrada</div></div>
    <div class="pipeline-step"><div class="n">${num(converted)}</div><div class="l">Convertidos</div></div>
  </div>`
  const columns = [
    { label: 'Cliente', render: r => `<b>${esc(r.customer || 'Sem nome')}</b>` },
    { label: 'Itens', render: r => `<span title="${esc(r.products || '')}">${fmtValue(r.products)}</span>` },
    { label: 'Valor', render: r => money(r.total) },
    { label: 'Abandono', render: r => dt(r.date) },
    { label: 'Elegibilidade', render: r => r.eligible === true ? pill('Elegível agora', 'success') : r.eligible === false ? pill(((r.blockers || [])[0] && (CHECKOUT_BLOCKERS[r.blockers[0]] || r.blockers[0])) || 'Bloqueado', 'warning') : pill('Não avaliado', 'neutral') },
    { label: 'Mensagem', render: r => r.message ? statusPill(r.message.status, MESSAGE_STATUS) : '<span class="cell-muted">Nenhuma ainda</span>' },
    { label: 'Status', render: r => statusPill(r.status, CHECKOUT_STATUS) },
  ]
  const { html, wire } = renderTable({ rows, columns, pagination: d.pagination, onRowClick: id => openCheckoutDetail(rows.find(r => r.id === id)), rowClass: () => 'clickable' })
  $('content').innerHTML = pipeline + html; wire($('content'))
}
function openCheckoutDetail(r) {
  if (!r) return
  const blockers = (r.blockers || []).filter(b => b !== null)
  openPanel(`<p class="eyebrow">CARRINHO ABANDONADO · SOMENTE LEITURA</p>
    <div class="panel-block"><h2>${esc(r.customer || 'Sem nome')}</h2><div class="kv-grid"><div class="kv"><span>Telefone</span><b>${fmtValue(r.phone)}</b></div><div class="kv"><span>Valor</span><b>${money(r.total)}</b></div></div><div class="kv" style="margin-top:8px"><span>Itens</span><b>${fmtValue(r.products)}</b></div></div>
    <div class="panel-block"><p class="eyebrow">ELEGIBILIDADE</p>${r.eligible ? '<div class="alert-ok"><span class="dot"></span>Elegível para mensagem agora</div>' : `<div class="alerts-list">${blockers.length ? blockers.map(b => `<div class="alert-row warning"><span class="dot"></span>${esc(CHECKOUT_BLOCKERS[b] || b)}</div>`).join('') : '<p class="cell-muted">Sem motivo de bloqueio informado.</p>'}</div>`}</div>
    ${r.message ? `<div class="panel-block"><p class="eyebrow">MENSAGEM</p><div class="kv-grid"><div class="kv"><span>Template</span><b class="cell-mono">${fmtValue(r.message.template)}</b></div><div class="kv"><span>Status</span><b>${statusPill(r.message.status, MESSAGE_STATUS)}</b></div></div></div>` : ''}
    <details class="tech-toggle"><summary>Dados técnicos</summary><div class="tech-kv"><span>Checkout ID</span><b>${fmtValue(r.checkout)}</b><span>Converted order</span><b>${fmtValue(r.convertedOrderId)}</b><span>Converted at</span><b>${dt(r.convertedAt)}</b></div></details>`)
}

// ── PIX / BOLETO ─────────────────────────────────────────────────────────────────────────────
async function renderPayments(method) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' })
  const d = await api('payments/' + method + '?' + qs)
  const rows = d.data || []
  const pending = rows.filter(r => !['paid', 'confirmed', 'authorized', 'refunded'].includes(String(r.paymentStatus))).length
  const withMsg = rows.filter(r => r.template).length
  const failed = rows.filter(r => r.error).length
  const summary = `<div class="pipeline"><div class="pipeline-step"><div class="n">${num(rows.length)}</div><div class="l">Nesta página</div></div><div class="pipeline-step"><div class="n">${num(pending)}</div><div class="l">Pagamento pendente</div></div><div class="pipeline-step"><div class="n">${num(withMsg)}</div><div class="l">Mensagem criada</div></div><div class="pipeline-step"><div class="n">${num(failed)}</div><div class="l">Falhas de mensagem</div></div></div>`
  const columns = [
    { label: 'Pedido', render: r => `<b>${esc(r.order || r.id)}</b>` },
    { label: 'Cliente', render: r => esc(r.customer || 'Sem nome') },
    { label: 'Valor', render: r => money(r.total) },
    { label: 'Data', render: r => dt(r.date) },
    { label: 'Pagamento', render: r => pill(r.paymentStatus || '—', ['paid', 'confirmed', 'authorized'].includes(String(r.paymentStatus)) ? 'success' : 'warning') },
    { label: 'Template', render: r => `<span class="cell-mono">${fmtValue(r.template)}</span>` },
    { label: 'Mensagem', render: r => r.messageStatus ? statusPill(r.messageStatus, MESSAGE_STATUS) : '<span class="cell-muted">—</span>' },
    { label: 'Falha', render: r => r.error ? esc(FAILURE_CATEGORY[r.error.category] || r.error.category || '—') : '<span class="cell-muted">—</span>' },
  ]
  const { html, wire } = renderTable({ rows, columns, pagination: d.pagination })
  $('content').innerHTML = summary + html; wire($('content'))
}

// ── REMARKETING ──────────────────────────────────────────────────────────────────────────────
async function renderRemarketing() {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' })
  const d = await api('remarketing?' + qs)
  const rows = d.data || []
  const bySegment = {}
  rows.forEach(r => { (bySegment[r.segment] = bySegment[r.segment] || []).push(r) })
  const segCards = Object.keys(REMARKETING_SEGMENT).map(seg => {
    const runs = bySegment[seg] || []
    const candidates = runs.reduce((a, r) => a + (r.candidateCount || 0), 0)
    const eligible = runs.reduce((a, r) => a + (r.eligibleCount || 0), 0)
    const failed = runs.reduce((a, r) => a + (r.failedCount || 0), 0)
    return `<div class="segment-card"><h3>${REMARKETING_SEGMENT[seg]}</h3>
      <div class="row"><span>Execuções (página)</span><b>${num(runs.length)}</b></div>
      <div class="row"><span>Candidatos</span><b>${num(candidates)}</b></div>
      <div class="row"><span>Elegíveis</span><b>${num(eligible)}</b></div>
      <div class="row"><span>Bloqueados</span><b>${num(failed)}</b></div>
    </div>`
  }).join('')
  const runtime = `<div class="notice">Runtime: envio automático de remarketing <b>${boolLabel(d.runtime?.automationSendEnabled)}</b> · módulo <b>${boolLabel(d.runtime?.enabled)}</b> · modo dry-run <b>${boolLabel(d.runtime?.dryRun)}</b>. Regra configurada não significa envio liberado — nenhuma execução parte desta tela.</div>`
  const columns = [
    { label: 'Segmento', render: r => esc(REMARKETING_SEGMENT[r.segment] || r.segment) },
    { label: 'Modo', render: r => esc(REMARKETING_MODE[r.mode] || r.mode) },
    { label: 'Status', render: r => statusPill(r.status, REMARKETING_RUN_STATUS) },
    { label: 'Candidatos', render: r => num(r.candidateCount) },
    { label: 'Elegíveis', render: r => num(r.eligibleCount) },
    { label: 'Enviados', render: r => num(r.sentCount) },
    { label: 'Bloqueados', render: r => num(r.skippedCount) },
    { label: 'Falhas', render: r => num(r.failedCount) },
    { label: 'Início', render: r => dt(r.startedAt) },
  ]
  const { html, wire } = renderTable({ rows, columns, pagination: d.pagination })
  $('content').innerHTML = runtime + `<div class="segment-row">${segCards}</div>` + html; wire($('content'))
}

// ── AUTOMAÇÕES (fluxo) ───────────────────────────────────────────────────────────────────────
async function renderAutomations() {
  const d = await api('automations')
  const cards = (d.data || []).map(r => {
    const nodes = [`Trigger — ${EVENT_TYPE[r.eventType] || r.eventType}`, r.delayMinutes ? `Esperar ${r.delayMinutes} min` : null, r.stopIfOrderExists ? 'Verificar se já existe pedido' : null, `Template — ${r.templateName}`, 'WhatsApp'].filter(Boolean)
    const flowMismatch = r.active && !r.runtime.automationSendEnabled
    return `<div class="flow-card"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h3>${esc(r.name)}</h3><p class="sub">${esc(EVENT_TYPE[r.eventType] || r.eventType)}</p></div>${pill(r.active ? 'Regra ativa' : 'Regra inativa', r.active ? 'success' : 'neutral')}</div>
      <div class="flow-grid">
        <div class="flow-steps">${nodes.map((n, i) => `<div class="flow-node">${n}</div>${i < nodes.length - 1 ? '<div class="flow-arrow">↓</div>' : ''}`).join('')}</div>
        <div class="flow-side">
          <div class="kv"><span>Máx. envios por entidade</span><b>${num(r.maxSendsPerEntity)}</b></div>
          <div class="rule-vs-runtime">
            <div class="row"><span>Regra</span>${pill(r.active ? 'Ativa' : 'Inativa', r.active ? 'success' : 'neutral')}</div>
            <div class="row ${flowMismatch ? 'mismatch' : ''}"><span>Runtime</span>${pill(r.runtime.automationSendEnabled ? 'Envio liberado' : 'Envio bloqueado', r.runtime.automationSendEnabled ? 'success' : 'danger')}</div>
            ${r.eventType === 'abandoned_checkout' ? `<div class="row"><span>Fluxo carrinho</span>${pill(r.runtime.flowEnabled ? 'Habilitado' : 'Desabilitado', r.runtime.flowEnabled ? 'success' : 'neutral')}</div>` : ''}
            <div class="row"><span>Modo</span>${pill(r.runtime.whatsappDryRun ? 'Dry-run (simulado)' : 'Envio real', r.runtime.whatsappDryRun ? 'warning' : 'brand')}</div>
          </div>
        </div>
      </div></div>`
  }).join('')
  $('content').innerHTML = cards || '<div class="empty-state"><h3>Nenhuma automação configurada</h3></div>'
}

// ── TEMPLATES ────────────────────────────────────────────────────────────────────────────────
async function renderTemplates() {
  const d = await api('templates')
  const rows = (d.data || []).map(r => `<div class="template-row">
    <div><div class="name">${esc(r.metaTemplateName)}</div><div class="preview">${esc(r.messagePreview || '')}</div></div>
    <div>${pill(TEMPLATE_CATEGORY[r.category] || r.category, 'neutral')} <span class="cell-muted" style="font-size:11px">${esc(r.languageCode)}</span></div>
    <div>${pill(r.active ? 'Ativo' : 'Inativo', r.active ? 'success' : 'neutral')} <span class="cell-muted" style="font-size:11px">Status Meta: ${fmtValue(r.metaStatus)}</span></div>
    <div class="stat"><b>${num(r.usageCount)}</b>usos<div style="margin-top:6px">${dOnly(r.lastUsedAt)}</div></div>
  </div>`).join('')
  $('content').innerHTML = `<div class="template-list">${rows || '<div class="empty-state"><h3>Nenhum template cadastrado</h3></div>'}</div>`
}

// ── CONSENTIMENTOS ───────────────────────────────────────────────────────────────────────────
async function renderConsents() {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' })
  const d = await api('consents?' + qs)
  const columns = [
    { label: 'Telefone', render: r => `<span class="cell-mono">${fmtValue(r.phone)}</span>` },
    { label: 'Escopo', render: r => esc(r.scope) },
    { label: 'Status', render: r => statusPill(r.status, CONSENT_STATUS) },
    { label: 'Origem', render: r => esc(r.source || '—') },
    { label: 'Concedido em', render: r => dOnly(r.consentedAt) },
    { label: 'Revogado em', render: r => dOnly(r.revokedAt) },
  ]
  const { html, wire } = renderTable({ rows: d.data, columns, pagination: d.pagination })
  $('content').innerHTML = `<div class="notice">Consentimento, opt-out e suppression são conceitos distintos: consentimento é a permissão explícita de contato por escopo; opt-out e suppression (ver Clientes) bloqueiam o contato independentemente do consentimento.</div>` + html; wire($('content'))
}

// ── SAÚDE ────────────────────────────────────────────────────────────────────────────────────
async function renderHealth() {
  const h = await api('health')
  function tile(name, ok, note) { return `<div class="health-tile"><div class="name">${esc(name)}</div>${pill(ok ? 'Operacional' : 'Sem evidência recente', ok ? 'success' : 'warning')}<p class="cell-muted" style="margin-top:8px;font-size:11.5px">${note}</p></div>` }
  const metaOk = h.meta.configured && h.meta.latestEvidence && !h.meta.latestEvidence.error && !isStale(h.meta.latestEvidence.createdAt)
  const nuvemOk = h.nuvemshop.configured && h.nuvemshop.latestEvidence && !h.nuvemshop.latestEvidence.error && !isStale(h.nuvemshop.latestEvidence.createdAt)
  const recoveryOk = h.recoveryEngine.failed === 0 && h.recoveryEngine.unknown === 0
  const mirrorOk = h.inboxMirror.failed === 0
  const board = `<div class="health-board">
    ${tile('Meta', metaOk, h.meta.latestEvidence ? `Última evidência: ${dt(h.meta.latestEvidence.createdAt)}` : 'Nenhuma evidência registrada')}
    ${tile('Nuvemshop', nuvemOk, h.nuvemshop.latestEvidence ? `Última evidência: ${dt(h.nuvemshop.latestEvidence.createdAt)}` : 'Nenhuma evidência registrada')}
    ${tile('Recovery Engine', recoveryOk, `${num(h.recoveryEngine.pending)} pendentes · ${num(h.recoveryEngine.processing)} processando`)}
    ${tile('Inbox Mirror', mirrorOk, h.inboxMirror.latestSuccess ? `Último espelhamento: ${dt(h.inboxMirror.latestSuccess)}` : 'Nenhum espelhamento bem-sucedido registrado')}
  </div>`
  const details = `<div class="health-detail-grid">
    <div class="panel"><div class="panel-head"><b>Recovery Engine</b></div><div style="padding:14px 16px"><div class="kv-grid"><div class="kv"><span>Pendentes</span><b>${num(h.recoveryEngine.pending)}</b></div><div class="kv"><span>Processando</span><b>${num(h.recoveryEngine.processing)}</b></div><div class="kv"><span>Falhas</span><b>${num(h.recoveryEngine.failed)}</b></div><div class="kv"><span>Unknown</span><b>${num(h.recoveryEngine.unknown)}</b></div></div><div class="kv" style="margin-top:8px"><span>Pendente mais antigo</span><b>${dt(h.recoveryEngine.oldestPending)}</b></div></div></div>
    <div class="panel"><div class="panel-head"><b>Inbox Mirror</b></div><div style="padding:14px 16px"><div class="kv-grid"><div class="kv"><span>Falhas</span><b>${num(h.inboxMirror.failed)}</b></div><div class="kv"><span>Último sucesso</span><b>${dt(h.inboxMirror.latestSuccess)}</b></div></div></div></div>
    <div class="panel"><div class="panel-head"><b>Runtime</b></div><div style="padding:14px 16px" class="kv-grid">
      <div class="kv"><span>Cron interno</span><b>${boolLabel(h.runtime.cron)}</b></div>
      <div class="kv"><span>Envio de automação</span><b>${boolLabel(h.runtime.automationSend)}</b></div>
      <div class="kv"><span>Carrinho abandonado</span><b>${boolLabel(h.runtime.abandonedCart)}</b></div>
      <div class="kv"><span>Remarketing</span><b>${boolLabel(h.runtime.remarketing)}</b></div>
      <div class="kv"><span>WhatsApp dry-run</span><b>${boolLabel(h.runtime.whatsappDryRun)}</b></div>
      <div class="kv"><span>Inbox dry-run</span><b>${boolLabel(h.runtime.inboxDryRun)}</b></div>
    </div></div>
  </div>`
  $('content').innerHTML = board + details
}

// ── AUDITORIA ────────────────────────────────────────────────────────────────────────────────
async function renderAudit() {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' })
  const d = await api('audit?' + qs)
  const notice = d.fullAuditLog?.status === 'NOT_AVAILABLE' ? `<div class="notice">Ledger de auditoria completo indisponível — faltam ator, estado anterior, estado posterior e motivo (${(d.fullAuditLog.missing || []).join(', ')}). Os eventos técnicos abaixo são reais e comprovados, mas não substituem um ledger completo.</div>` : ''
  const columns = [
    { label: 'Data', render: r => dt(r.createdAt) },
    { label: 'Sistema', render: r => esc(r.provider) },
    { label: 'Evento', render: r => esc(r.topic) },
    { label: 'Assinatura', render: r => pill(r.hmacValid ? 'Válida' : 'Inválida', r.hmacValid ? 'success' : 'danger') },
    { label: 'Resultado', render: r => r.processed ? pill('Processado', 'success') : pill('Não processado', 'warning') },
    { label: 'Erro', render: r => r.error ? esc(r.error) : '<span class="cell-muted">—</span>' },
  ]
  const { html, wire } = renderTable({ rows: d.data, columns, pagination: d.pagination })
  $('content').innerHTML = notice + html; wire($('content'))
}

render()
