/* D'Rosa CRM v2 — central operacional somente-leitura sobre /crm-api (backend intocado nesta
   missão). Zero dependências externas, zero build step — mesma filosofia de public/crm e
   public/inbox. Nenhum dado é inventado: onde o /crm-api real retorna null/NOT_AVAILABLE, a tela
   mostra isso honestamente (nunca um zero ou um número calculado à parte no cliente).

   Arquitetura de navegação: 7 áreas operacionais principais (Dashboard, Envios, Cliente 360,
   Conversas, Carrinho, Campanhas & IA, Saúde). Áreas de apoio (Templates, Consentimentos, Pix,
   Boleto, Remarketing, Auditoria) deixam de competir como destinos de primeiro nível e viram
   abas locais dentro da área correspondente — mesmos endpoints, mesmos dados, sem nenhuma
   remoção de contrato de API.

   Campanhas & IA (antiga "Automações") reúne 4 abas locais: Oportunidades (audiências reais
   calculadas pelo backend), Campanhas (estratégias geradas por IA sobre /crm-api/ai/*, sempre
   com aprovação humana explícita antes de qualquer agendamento — a IA nunca aprova a si mesma),
   Automações (conteúdo já existente de regra-vs-runtime, inalterado) e Aprendizados (métricas
   comprovadas; envio real está desligado nesta fase, então a ausência de dados é um estado
   honesto, não um zero fabricado). */

// ── Ícones (SVG inline, sem dependência de ícone externo) ──────────────────────────────────────
const ICONS = {
  dashboard: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  messages: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>',
  customers: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
  conversations: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4A8.6 8.6 0 0 1 8 19l-5 1 1-4.4A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
  checkouts: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  automations: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 3v3M19 4.5h1.5M5 17v3M3.5 18.5H6.5"/></svg>',
  flow: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
  health: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
  back: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m6-7-7 7 7 7"/></svg>',
  order: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  send: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>',
  chat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4A8.6 8.6 0 0 1 8 19l-5 1 1-4.4A8.4 8.4 0 1 1 21 11.5Z"/></svg>',
  shield: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  alert: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
}

// ── Navegação: 7 áreas principais + abas locais (áreas de apoio reaproveitam os mesmos dados) ──
const NAV = [
  { key: 'dashboard', label: 'Dashboard', mobile: 'Painel', tabs: [['dashboard', 'Dashboard']] },
  { key: 'messages', label: 'Envios', mobile: 'Envios', tabs: [['messages', 'Mensagens'], ['templates', 'Templates']] },
  { key: 'customers', label: 'Cliente 360', mobile: 'Clientes', tabs: [['customers', 'Clientes'], ['consents', 'Consentimentos']] },
  { key: 'conversations', label: 'Conversas', mobile: 'Conversas', tabs: [['conversations', 'Conversas']] },
  { key: 'checkouts', label: 'Carrinho', mobile: 'Carrinho', tabs: [['checkouts', 'Abandonados'], ['pix', 'Pix'], ['boleto', 'Boleto'], ['remarketing', 'Remarketing']] },
  { key: 'automations', label: 'Campanhas & IA', mobile: 'IA', tabs: [['opportunities', 'Oportunidades'], ['campaigns', 'Campanhas'], ['automation-rules', 'Automações'], ['learning', 'Aprendizados']] },
  { key: 'health', label: 'Saúde', mobile: 'Saúde', tabs: [['health', 'Visão geral'], ['audit', 'Auditoria']] },
]
const TAB_META = {
  dashboard: 'O que está acontecendo agora.',
  messages: 'Central operacional das mensagens e seus estados reais no provedor.',
  templates: 'Contratos locais de template e uso observado.',
  customers: 'Identidade, pedidos e políticas de contato.',
  consents: 'Consentimento é distinto de opt-out e de suppression.',
  conversations: 'Inbox operacional em modo somente leitura.',
  checkouts: 'Elegibilidade calculada pelas regras já existentes — nunca recalculada aqui.',
  pix: 'Pedidos Pix pendentes e falhas de mensagem observadas.',
  boleto: 'Pedidos por boleto pendentes e falhas de mensagem observadas.',
  remarketing: 'Execuções, públicos e bloqueios já existentes.',
  opportunities: 'Oportunidades reais de contato, calculadas a partir de dados já existentes.',
  campaigns: 'Estratégias geradas por IA — aprovação humana explícita é sempre obrigatória.',
  'automation-rules': 'Regra configurada versus liberação real em runtime.',
  learning: 'Métricas comprovadas de campanhas — envio real ainda desligado nesta fase.',
  health: 'Evidência real e freshness das integrações.',
  audit: 'Eventos técnicos comprovados — nunca um ledger completo fingido.',
}
const TAB_TO_SECTION = {}
NAV.forEach(s => s.tabs.forEach(([k]) => { TAB_TO_SECTION[k] = s.key }))

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
const TEMPLATE_CATEGORY = { utility: 'Utilidade', marketing: 'Marketing', authentication: 'Autenticação' }
const EVENT_TYPE = { order_created: 'Pedido criado', abandoned_checkout: 'Carrinho abandonado' }
const ENTITY_TYPE = { order: 'Pedido', abandoned_checkout: 'Carrinho abandonado' }
const OPPORTUNITY_TYPE = { ABANDONED_CART: 'Carrinho abandonado', PIX_PENDING: 'Pix pendente', BOLETO_PENDING: 'Boleto pendente', REPEAT_PURCHASE: 'Compra recorrente', WINBACK: 'Reconquista', VIP: 'Cliente VIP', RECENT_CUSTOMER: 'Cliente recente', ENGAGED_NO_PURCHASE: 'Engajado sem compra' }
const OPPORTUNITY_CONFIDENCE = { low: ['Confiança baixa', 'neutral'], medium: ['Confiança média', 'warning'], high: ['Confiança alta', 'success'] }
// Máquina de estados de campanha — ordem e nomes fixos pelo contrato do backend. A aprovação
// humana (AWAITING_HUMAN_APPROVAL → APPROVED) nunca é automática: só avança por um POST
// .../approve disparado por um clique humano explícito, com approvedBy preenchido nesta tela.
const CAMPAIGN_STATUS_ORDER = ['DRAFT', 'AI_READY', 'PRODUCT_TRUTH_APPROVED', 'COMPLIANCE_APPROVED', 'AWAITING_HUMAN_APPROVAL', 'APPROVED', 'SCHEDULED', 'RUNNING', 'COMPLETED']
const CAMPAIGN_STATUS = {
  DRAFT: ['Rascunho', 'neutral'],
  AI_READY: ['IA gerou estratégias', 'brand'],
  PRODUCT_TRUTH_APPROVED: ['Produto confirmado', 'brand'],
  COMPLIANCE_APPROVED: ['Compliance aprovado', 'brand'],
  AWAITING_HUMAN_APPROVAL: ['Aguardando aprovação humana', 'warning'],
  APPROVED: ['Aprovada', 'success'],
  SCHEDULED: ['Agendada (simulada)', 'success'],
  RUNNING: ['Em execução', 'brand'],
  COMPLETED: ['Concluída', 'success'],
  CANCELLED: ['Cancelada', 'neutral'],
}

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
function statusPill(status, dict) { const entry = dict[status]; if (!entry) return pill(status || 'Status incerto', 'warning'); const [label, tone] = entry; return pill(label, tone) }
function boolLabel(v) { return v === true ? 'Sim' : v === false ? 'Não' : '—' }
function initials(name) { if (!name) return '?'; const parts = String(name).trim().split(/\s+/); return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?' }
function emptyState(title, hint) { return `<div class="empty-state"><div class="glyph">${ICONS.checkouts}</div><h3>${esc(title)}</h3><p>${esc(hint || '')}</p></div>` }

// ── Estado + autenticação ────────────────────────────────────────────────────────────────────
// connStatus é a verdade real da conexão (nunca apenas "existe um segredo salvo"): idle (sem
// segredo) → checking (testando contra o backend agora) → online (última chamada real teve
// sucesso) → offline (última chamada real falhou, mesmo com segredo válido salvo).
const state = { section: 'dashboard', tab: 'dashboard', page: 1, secret: sessionStorage.getItem('crmV2Secret') || '', search: '', period: 'today', msgStatus: '', customerId: null, customerTab: 'overview', convoId: null, mobileThreadOpen: false, connStatus: 'idle', campaignId: null, selectedStrategy: {} }

// Token monotônico de renderização: cada load() incrementa e captura sua própria geração.
// Uma resposta só pode escrever no DOM se sua geração ainda for a atual — isso é o que impede
// uma tela lenta (ex.: Carrinho) de sobrescrever uma tela mais nova (ex.: Automações) quando
// finalmente resolve depois que o usuário já navegou para outro lugar.
let renderGen = 0
let activeController = null

function openAuthModal() { $('secret').value = state.secret; $('authModal').classList.remove('hidden'); $('backdrop').classList.remove('hidden'); $('secret').focus() }
function closeAuthModal() { $('authModal').classList.add('hidden'); $('backdrop').classList.add('hidden') }
$('connToggle').onclick = () => { if (state.secret) { disconnect() } else { openAuthModal() } }
$('mtAuthBtn').onclick = () => { if (state.secret) { disconnect() } else { openAuthModal() } }
$('cancelAuth').onclick = closeAuthModal
$('connect').onclick = () => { state.secret = $('secret').value.trim(); sessionStorage.setItem('crmV2Secret', state.secret); closeAuthModal(); render() }
$('secret').onkeydown = e => { if (e.key === 'Enter') $('connect').click() }
function disconnect() { state.secret = ''; state.connStatus = 'idle'; sessionStorage.removeItem('crmV2Secret'); state.search = ''; state.page = 1; state.customerId = null; closePanel(); render() }
$('closePanel').onclick = closePanel
function closePanel() { $('panel').classList.add('hidden'); if ($('authModal').classList.contains('hidden')) $('backdrop').classList.add('hidden') }
function openPanel(html) { $('panelContent').innerHTML = html; $('panel').classList.remove('hidden'); $('backdrop').classList.remove('hidden') }
$('backdrop').onclick = () => { closePanel(); closeAuthModal(); closeAdminModal(false) }

// Modal de confirmação administrativa (aprovar/agendar campanha). O segredo digitado nunca é
// gravado em nenhum armazenamento persistente do navegador nem em estado global — vive só no input enquanto o modal está
// aberto e é apagado do DOM assim que o modal fecha, em qualquer caminho (confirmar ou cancelar).
let adminModalResolve = null
function openAdminModal() {
  return new Promise(resolve => {
    adminModalResolve = resolve
    $('adminSecretInput').value = ''
    $('adminModalError').innerHTML = ''
    $('adminModal').classList.remove('hidden'); $('backdrop').classList.remove('hidden')
    $('adminSecretInput').focus()
  })
}
function closeAdminModal(confirmed) {
  const secret = $('adminSecretInput').value
  $('adminSecretInput').value = ''
  $('adminModal').classList.add('hidden')
  if ($('authModal').classList.contains('hidden') && $('panel').classList.contains('hidden')) $('backdrop').classList.add('hidden')
  if (adminModalResolve) { const resolve = adminModalResolve; adminModalResolve = null; resolve(confirmed ? secret : null) }
}
$('adminConfirmBtn').onclick = () => closeAdminModal(true)
$('adminCancelBtn').onclick = () => closeAdminModal(false)
$('adminSecretInput').onkeydown = e => { if (e.key === 'Enter') closeAdminModal(true) }

class ApiError extends Error {
  constructor(message, meta) { super(message); this.name = 'ApiError'; this.status = meta.status; this.endpoint = meta.endpoint; this.code = meta.code }
}
async function api(path, signal) {
  const endpoint = '/crm-api/' + path
  let r
  try {
    r = await fetch(endpoint, { headers: { 'x-crm-read-secret': state.secret }, signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new ApiError(`Falha de rede · ${endpoint}`, { status: 0, endpoint })
  }
  const requestId = r.headers.get('x-vercel-id')
  if (r.status === 401) throw new ApiError('Segredo de leitura inválido ou ausente.', { status: 401, endpoint })
  if (!r.ok) throw new ApiError(`Falha ao carregar · HTTP ${r.status} · ${endpoint}${requestId ? ' · ID: ' + requestId.split('::').pop() : ''}`, { status: r.status, endpoint })
  return r.json()
}
// Mutações reais (gerar campanha, selecionar estratégia, aprovar, agendar) — mesma convenção de
// diagnóstico do api(): nunca engolir o erro, sempre expor status/endpoint/ID de requisição. O
// corpo de erro é lido quando possível para extrair um código estruturado (ex.:
// AI_PROVIDER_NOT_CONFIGURED) e permitir uma mensagem de produto melhor em describeAiIssue().
async function apiPost(path, body) {
  const endpoint = '/crm-api/' + path
  let r
  try {
    r = await fetch(endpoint, { method: 'POST', headers: { 'x-crm-read-secret': state.secret, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  } catch (e) {
    throw new ApiError(`Falha de rede · ${endpoint}`, { status: 0, endpoint })
  }
  const requestId = r.headers.get('x-vercel-id')
  let payload = null
  try { payload = await r.json() } catch (e) { /* corpo vazio ou não-JSON — segue com payload nulo, nunca falha silenciosamente na leitura do status HTTP */ }
  if (r.status === 401) throw new ApiError('Segredo de leitura inválido ou ausente.', { status: 401, endpoint })
  if (!r.ok) throw new ApiError(`Falha ao executar ação · HTTP ${r.status} · ${endpoint}${requestId ? ' · ID: ' + requestId.split('::').pop() : ''}`, { status: r.status, endpoint, code: payload && payload.error })
  return payload
}
// Ações administrativas (aprovar, agendar) exigem x-admin-secret além do x-crm-read-secret —
// mesmo adminAuth já usado por /admin. O segredo chega aqui só como parâmetro de função (nunca
// lido de armazenamento persistente do navegador nem de estado global) e o chamador é responsável por limpá-lo da
// UI logo após esta chamada resolver, com sucesso ou erro.
async function apiPostAdmin(path, body, adminSecret) {
  const endpoint = '/crm-api/' + path
  let r
  try {
    r = await fetch(endpoint, { method: 'POST', headers: { 'x-crm-read-secret': state.secret, 'x-admin-secret': adminSecret, 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  } catch (e) {
    throw new ApiError(`Falha de rede · ${endpoint}`, { status: 0, endpoint })
  }
  const requestId = r.headers.get('x-vercel-id')
  let payload = null
  try { payload = await r.json() } catch (e) { /* corpo vazio ou não-JSON — segue com payload nulo */ }
  if (r.status === 401 || r.status === 403) throw new ApiError('Segredo administrativo inválido ou ausente.', { status: r.status, endpoint })
  if (!r.ok) throw new ApiError(`Falha ao executar ação · HTTP ${r.status} · ${endpoint}${requestId ? ' · ID: ' + requestId.split('::').pop() : ''}`, { status: r.status, endpoint, code: payload && payload.error })
  return payload
}
// Traduz falhas conhecidas da camada de IA em linguagem de produto, sem nunca esconder o
// diagnóstico técnico bruto (sempre exibido junto, em texto menor, por quem chama esta função).
function describeAiIssue(e) {
  const code = e.code || ''
  const msg = (e.message || '').toLowerCase()
  if (e.status === 503 || code === 'AI_PROVIDER_NOT_CONFIGURED' || msg.includes('not_configured')) return { title: 'IA indisponível nesta fase', body: 'O provedor de geração de campanhas ainda não está configurado neste ambiente. Nenhuma estratégia pode ser gerada até a chave de API ser configurada fora desta tela.' }
  if (code === 'AI_TIMEOUT' || msg.includes('timeout')) return { title: 'O provedor de IA não respondeu a tempo', body: 'A geração foi interrompida por demora na resposta do provedor. Tente novamente em alguns instantes.' }
  if (code === 'AI_MALFORMED_OUTPUT' || msg.includes('malformed')) return { title: 'A IA retornou um conteúdo inesperado', body: 'A resposta não pôde ser interpretada com segurança, então nenhuma campanha foi criada a partir dela.' }
  return { title: 'Não foi possível concluir esta ação', body: e.message }
}

// ── Navegação: sidebar (desktop) + tabs de seção + barra inferior (mobile) ─────────────────────
function renderNav() {
  const section = NAV.find(s => s.key === state.section)
  $('sideNav').innerHTML = NAV.map(s => `<button data-section="${s.key}" class="${s.key === state.section ? 'active' : ''}">${ICONS[s.key]}<span>${esc(s.label)}</span></button>`).join('')
  $('bottomTabs').innerHTML = NAV.map(s => `<button data-section="${s.key}" class="${s.key === state.section ? 'active' : ''}">${ICONS[s.key]}<span>${esc(s.mobile)}</span></button>`).join('')

  const showTabs = section.tabs.length > 1 && !(state.section === 'customers' && state.customerId)
  $('sectionTabs').classList.toggle('empty', !showTabs)
  $('sectionTabs').innerHTML = showTabs ? section.tabs.map(([key, label]) => `<button data-tab="${key}" class="${key === state.tab ? 'active' : ''}">${esc(label)}</button>`).join('') : ''

  const titleLabel = (state.section === 'customers' && state.customerId) ? 'Cliente 360' : section.label
  $('pageTitle').textContent = titleLabel
  $('pageSubtitle').textContent = TAB_META[state.tab] || ''
  $('mtTitle').textContent = titleLabel

  // "Conectado" só é exibido depois de uma chamada real bem-sucedida ao backend (state.connStatus),
  // nunca apenas por existir um segredo salvo — ver api() e load().
  const hasSecret = Boolean(state.secret)
  const online = hasSecret && state.connStatus === 'online'
  const errored = hasSecret && state.connStatus === 'offline'
  const checking = hasSecret && state.connStatus === 'checking'
  const label = !hasSecret ? 'Não conectado' : checking ? 'Conectando…' : online ? 'Conectado' : errored ? 'Erro de conexão' : 'Conectando…'
  $('connPill').classList.toggle('on', online)
  $('connPill').classList.toggle('error', errored)
  $('connPill').classList.toggle('checking', checking)
  $('connLabel').textContent = label
  $('connToggle').textContent = hasSecret ? 'Sair' : 'Conectar'
  $('mtConn').classList.toggle('on', online)
  $('mtConn').classList.toggle('error', errored)
  $('mtConn').classList.toggle('checking', checking)
}
$('sideNav').onclick = e => { const b = e.target.closest('[data-section]'); if (!b) return; selectSection(b.dataset.section) }
$('bottomTabs').onclick = e => { const b = e.target.closest('[data-section]'); if (!b) return; selectSection(b.dataset.section) }
$('sectionTabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; state.tab = b.dataset.tab; state.page = 1; state.campaignId = null; load() }
function selectSection(key) {
  state.section = key
  state.tab = NAV.find(s => s.key === key).tabs[0][0]
  state.page = 1
  if (key !== 'customers') state.customerId = null
  state.campaignId = null
  render()
}

// ── Router ───────────────────────────────────────────────────────────────────────────────────
async function render() {
  renderNav()
  if (!state.secret) {
    $('toolbar').innerHTML = ''
    $('content').innerHTML = `<div class="gate-wrap"><div class="gate"><div class="gate-mark">DR</div><h2>Conectar ao CRM</h2><p>Acesso somente leitura aos dados operacionais da D&rsquo;Rosa. Nenhuma ação de envio ou alteração fica disponível aqui.</p><button class="btn btn-primary" id="gateConnect">Conectar</button></div></div>`
    $('gateConnect').onclick = openAuthModal
    return
  }
  await load()
}
async function load() {
  // Nova geração de render: aborta qualquer chamada anterior ainda em voo e assume o direito
  // exclusivo de escrever em #content — uma resposta tardia de uma navegação anterior (ex.:
  // Carrinho lento) nunca mais consegue pintar por cima da tela atual (ex.: Automações).
  const myGen = ++renderGen
  if (activeController) activeController.abort()
  const controller = new AbortController()
  activeController = controller
  state.connStatus = 'checking'
  renderNav()
  renderToolbar()
  $('content').innerHTML = '<div class="skeleton">' + Array.from({ length: 6 }).map(() => '<div class="sk-row"></div>').join('') + '</div>'
  try {
    if (state.section === 'customers' && state.customerId) { await renderCustomer360(state.customerId, myGen, controller.signal) }
    else { await AREAS[state.tab](myGen, controller.signal) }
    if (myGen !== renderGen) return
    state.connStatus = 'online'
    renderNav()
  } catch (e) {
    if (e.name === 'AbortError' || myGen !== renderGen) return
    state.connStatus = 'offline'
    renderNav()
    $('content').innerHTML = `<div class="error-state"><div class="glyph">${ICONS.alert}</div><h3>Não foi possível carregar esta tela</h3><p>${esc(e.message)}</p><button class="btn btn-ghost" id="retryBtn">Tentar de novo</button></div>`
    const btn = $('retryBtn'); if (btn) btn.onclick = load
  }
}
function renderToolbar() {
  if (state.tab === 'dashboard') { $('toolbar').innerHTML = `<div class="seg" id="periodSeg">${[['today', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias']].map(([k, l]) => `<button data-p="${k}" class="${state.period === k ? 'active' : ''}">${l}</button>`).join('')}</div>`; $('periodSeg').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; state.period = b.dataset.p; load() }; return }
  if (state.tab === 'messages') {
    $('toolbar').innerHTML = `<select id="statusFilter"><option value="">Todos os status</option>${Object.entries(MESSAGE_STATUS).map(([k, [l]]) => `<option value="${k}" ${state.msgStatus === k ? 'selected' : ''}>${l}</option>`).join('')}</select><input type="search" id="searchInput" placeholder="Buscar por nome ou telefone" value="${esc(state.search)}"><button class="btn btn-ghost btn-sm" id="searchBtn">Buscar</button>`
    $('statusFilter').onchange = () => { state.msgStatus = $('statusFilter').value; state.page = 1; load() }
    $('searchBtn').onclick = () => { state.search = $('searchInput').value.trim(); state.page = 1; load() }
    $('searchInput').onkeydown = e => { if (e.key === 'Enter') $('searchBtn').click() }
    return
  }
  if (['customers', 'conversations'].includes(state.tab) && !state.customerId) { $('toolbar').innerHTML = `<input type="search" id="searchInput" placeholder="Buscar por nome ou telefone" value="${esc(state.search)}"><button class="btn btn-ghost btn-sm" id="searchBtn">Buscar</button>`; $('searchBtn').onclick = () => { state.search = $('searchInput').value.trim(); state.page = 1; load() }; $('searchInput').onkeydown = e => { if (e.key === 'Enter') $('searchBtn').click() }; return }
  $('toolbar').innerHTML = ''
}

// ── Tabela genérica reutilizável ─────────────────────────────────────────────────────────────
function renderTable({ rows, columns, pagination, onRowClick, rowClass, cardTitle, cardMeta }) {
  const cols = columns
  const cls = c => c.hideMobile ? ' class="col-hide-mobile"' : ''
  const body = rows.length ? rows.map(r => `<tr class="${rowClass ? rowClass(r) : ''}" data-id="${esc(r.id)}">${cols.map(c => `<td${cls(c)}>${c.render ? c.render(r) : fmtValue(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="cell-muted">Nenhum registro encontrado.</td></tr>`
  const table = `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th${cls(c)}>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`
  const cards = cardTitle ? renderMobileCards(rows, columns, cardTitle, cardMeta, rowClass) : ''
  const html = `<div class="panel"><div class="panel-head"><b>${rows.length} nesta página</b><span>${pagination ? num(pagination.total) + ' no total' : ''}</span></div>${table}${cards}${pager(pagination)}</div>`
  return { html, wire: (container) => { if (onRowClick) container.querySelectorAll('[data-id]').forEach(el => el.onclick = () => onRowClick(el.dataset.id)); wirePager() } }
}
function renderMobileCards(rows, columns, titleCol, metaCol, rowClass) {
  if (!rows.length) return ''
  const lineCols = columns.filter(c => c !== titleCol && c !== metaCol && !c.hideMobile)
  return `<div class="mobile-cards">${rows.map(r => `<div class="mcard ${rowClass ? rowClass(r) : ''}" data-id="${esc(r.id)}">
    <div class="mcard-top"><span class="mcard-title">${titleCol.render ? titleCol.render(r) : fmtValue(r[titleCol.key])}</span>${metaCol ? `<span class="mcard-meta">${metaCol.render ? metaCol.render(r) : fmtValue(r[metaCol.key])}</span>` : ''}</div>
    <div class="mcard-lines">${lineCols.map(c => `<span class="mcard-line"><span class="mcard-label">${esc(c.label)}</span>${c.render ? c.render(r) : fmtValue(r[c.key])}</span>`).join('')}</div>
  </div>`).join('')}</div>`
}
function pager(p) { return p ? `<div class="pagination"><span>Página ${p.page} de ${p.pages || 1}</span><button id="prevPage" ${p.page <= 1 ? 'disabled' : ''}>Anterior</button><button id="nextPage" ${p.page >= p.pages ? 'disabled' : ''}>Próxima</button></div>` : '' }
function wirePager() { const prev = $('prevPage'), next = $('nextPage'); if (prev) prev.onclick = () => { state.page--; load() }; if (next) next.onclick = () => { state.page++; load() } }
function narrativeList(rows, mapRow, emptyLabel) {
  if (!rows.length) return `<div class="panel"><div style="padding:32px;text-align:center" class="cell-muted">${esc(emptyLabel || 'Nenhum registro.')}</div></div>`
  return `<div class="panel">${rows.map(r => { const v = mapRow(r); return `<div class="narrative-row"><span class="icon">${ICONS[v.icon] || ICONS.order}</span><div class="body"><div><b>${v.title}</b>${v.badge ? ' ' + v.badge : ''}</div>${v.sub ? `<div class="sub">${v.sub}</div>` : ''}</div>${v.time ? `<time>${v.time}</time>` : ''}</div>` }).join('')}</div>`
}

// ── ÁREA: DASHBOARD ──────────────────────────────────────────────────────────────────────────
async function renderDashboard(gen, signal) {
  const [d, health] = await Promise.all([api('dashboard?period=' + state.period, signal), api('health', signal).catch(() => null)])
  const m = d.messages || {}
  const otherStatuses = Object.keys(m).filter(k => !['total', 'sent', 'delivered', 'read'].includes(k))

  const hero = `
    <div class="kpi-hero">
      <div class="kpi-hero-figure"><span class="n">${num(m.total)}</span><span class="l">Mensagens criadas no período</span></div>
      <div class="kpi-chain">
        <div class="kpi-chain-row"><span class="arrow">↳</span> Enviadas <b>${num(m.sent)}</b></div>
        <div class="kpi-chain-row muted"><span class="arrow">↳</span> Entregues <b>${fmtValue(m.delivered)}</b><span class="note">sem agregação disponível nesta janela</span></div>
        <div class="kpi-chain-row muted"><span class="arrow">↳</span> Lidas <b>${fmtValue(m.read)}</b><span class="note">sem agregação disponível nesta janela</span></div>
      </div>
    </div>`
  const alertsBody = health ? buildAlerts(health) : '<div class="alert-ok"><span class="dot"></span>Não foi possível carregar a Saúde para checar alertas agora.</div>'
  const attn = `<div class="attn-card"><h2>Precisa de atenção</h2>${alertsBody}</div>`

  const chips = `<div class="status-chip-row">${otherStatuses.map(k => `<span class="status-chip">${statusPill(k, MESSAGE_STATUS)}<span class="n">${num(m[k])}</span></span>`).join('') || '<span class="cell-muted">Sem outros status registrados no período.</span>'}
    <span class="status-chip">Clientes contatados <span class="n">${num(d.contactedCustomers)}</span></span>
    <span class="status-chip">Mensagens recebidas <span class="n">${num(d.inboundMessages)}</span></span>
    <span class="status-chip">Conversas com retorno <span class="n">${num(d.inboundConversations)}</span></span></div>`

  const funnels = `
    <div class="section-block"><div class="section-block-head"><h2>Funis de recuperação</h2><span class="hint">Somente dados reais desta janela</span></div>
      <div class="funnel-grid">
        <div class="funnel-card"><h3>Carrinho abandonado</h3><div class="funnel-steps">
          <div class="funnel-step"><span class="l">Detectados</span><span class="v">${num(d.abandonedCheckouts)}</span></div>
          <div class="funnel-step"><span class="l">Elegíveis (agregado)</span><span class="v cell-muted">${fmtValue(d.eligibleCheckouts)}</span></div>
          <div class="funnel-step"><span class="l">Convertidos</span><span class="v">${num(d.convertedCheckouts)}</span></div>
        </div><p class="funnel-hint">Elegibilidade por item real em Carrinho →</p></div>
        <div class="funnel-card"><h3>Pix pendente</h3><div class="funnel-steps"><div class="funnel-step"><span class="l">Pedidos pendentes</span><span class="v">${num(d.pixPending)}</span></div></div><p class="funnel-hint">Detalhamento por pedido em Carrinho → Pix</p></div>
        <div class="funnel-card"><h3>Boleto pendente</h3><div class="funnel-steps"><div class="funnel-step"><span class="l">Pedidos pendentes</span><span class="v">${num(d.boletoPending)}</span></div></div><p class="funnel-hint">Detalhamento por pedido em Carrinho → Boleto</p></div>
      </div>
    </div>`

  let activity = ''
  try {
    const recent = await api('messages?page=1&pageSize=12', signal)
    activity = `<div class="section-block"><div class="section-block-head"><h2>Atividade recente</h2><span class="hint">Últimas mensagens criadas, com o status atual real</span></div>
      <div class="timeline-feed">${(recent.data || []).map(r => `<div class="timeline-feed-row"><time>${timeOnly(r.createdAt)}</time><div class="event"><b>${esc(r.template || 'Mensagem')}</b> <span class="who">para ${esc(r.customer || 'contato sem nome')}</span></div>${statusPill(r.status, MESSAGE_STATUS)}</div>`).join('') || '<div style="padding:20px" class="cell-muted">Nenhuma mensagem criada ainda.</div>'}</div></div>`
  } catch (e) { if (e.name === 'AbortError') throw e /* atividade recente é complementar — uma falha aqui não derruba o resto do dashboard */ }

  if (gen !== renderGen) return
  $('content').innerHTML = `<div class="dash-top">${hero}${attn}</div>` + chips + funnels + activity
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
  if (h.recoveryEngine.unknown > 0) rows.push(['warning', 'Mensagens com status desconhecido', null, h.recoveryEngine.unknown])
  if (h.inboxMirror.failed > 0) rows.push(['warning', 'Mensagens não espelhadas no inbox', null, h.inboxMirror.failed])
  if (!rows.length) return `<div class="alert-ok"><span class="icon">${ICONS.check}</span>Nenhuma anomalia crítica encontrada agora.</div>`
  return '<div class="alerts-list">' + rows.map(([tone, label, detail, count]) => `<div class="alert-row ${tone === 'warning' ? 'warning' : ''}"><span class="icon">${ICONS.alert}</span><b>${esc(label)}</b>${detail ? `<span class="cell-muted"> · ${esc(detail)}</span>` : ''}${count !== undefined ? `<span class="count">${num(count)}</span>` : ''}</div>`).join('') + '</div>'
}
function isStale(createdAt) { if (!createdAt) return false; return (Date.now() - new Date(createdAt).getTime()) > 24 * 3600 * 1000 }

// ── ÁREA: ENVIOS (mensagens) ─────────────────────────────────────────────────────────────────
async function renderMessagesArea(gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' }); if (state.search) qs.set('search', state.search); if (state.msgStatus) qs.set('status', state.msgStatus)
  const d = await api('messages?' + qs, signal)
  const columns = [
    { label: 'Hora', render: r => dt(r.createdAt) },
    { label: 'Cliente', render: r => esc(r.customer || 'Sem nome') },
    { label: 'Fluxo', hideMobile: true, render: r => esc(ENTITY_TYPE[r.entityType] || r.entityType || '—') },
    { label: 'Template', hideMobile: true, render: r => `<span class="cell-mono">${fmtValue(r.template)}</span>` },
    { label: 'Status', render: r => statusPill(r.status, MESSAGE_STATUS) },
    { label: 'Tentativas', hideMobile: true, render: r => num(r.attempts) },
    { label: 'Motivo', hideMobile: true, render: r => r.failureCategory ? esc(FAILURE_CATEGORY[r.failureCategory] || r.failureCategory) : '<span class="cell-muted">—</span>' },
  ]
  const { html, wire } = renderTable({ rows: d.data, columns, pagination: d.pagination, onRowClick: id => openMessageDetail(id), rowClass: () => 'clickable', cardTitle: columns[1], cardMeta: columns[0] })
  if (gen !== renderGen) return
  $('content').innerHTML = d.data.length ? html : emptyState('Nenhuma mensagem encontrada', 'Ajuste o filtro de status ou a busca para ver outros registros.')
  if (d.data.length) wire($('content'))
}
async function openMessageDetail(id) {
  const myGen = renderGen
  try {
    const m = await api('messages/' + id)
    if (myGen !== renderGen) return
    const stageLabels = { created: 'Criada', scheduled: 'Agendada', accepted: 'Meta aceitou', sent: 'Enviada', delivered: 'Entregue', read: 'Lida' }
    const steps = (m.timeline || []).map(s => ({ label: stageLabels[s.stage] || s.stage, at: s.at }))
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

// ── ÁREA: TEMPLATES (aba local de Envios) ────────────────────────────────────────────────────
async function renderTemplatesArea(gen, signal) {
  const d = await api('templates', signal)
  const rows = (d.data || []).map(r => `<div class="template-row">
    <div><div class="name">${esc(r.metaTemplateName)}</div><div class="preview">${esc(r.messagePreview || '')}</div></div>
    <div>${pill(TEMPLATE_CATEGORY[r.category] || r.category, 'neutral')} <span class="cell-muted" style="font-size:11px">${esc(r.languageCode)}</span></div>
    <div>${pill(r.active ? 'Ativo' : 'Inativo', r.active ? 'success' : 'neutral')} <span class="cell-muted" style="font-size:11px">Status Meta: ${fmtValue(r.metaStatus)}</span></div>
    <div class="stat"><b>${num(r.usageCount)}</b>usos<div style="margin-top:6px">${dOnly(r.lastUsedAt)}</div></div>
  </div>`).join('')
  if (gen !== renderGen) return
  $('content').innerHTML = rows ? `<div class="template-list">${rows}</div>` : emptyState('Nenhum template cadastrado')
}

// ── ÁREA: CLIENTES + CLIENTE 360 ─────────────────────────────────────────────────────────────
async function renderCustomersArea(gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' }); if (state.search) qs.set('search', state.search)
  const d = await api('customers?' + qs, signal)
  const columns = [
    { label: 'Cliente', render: r => `<div style="display:flex;align-items:center;gap:9px"><span class="c360-avatar" style="width:26px;height:26px;font-size:10px">${esc(initials(r.name))}</span><b>${esc(r.name || 'Sem nome')}</b></div>` },
    { label: 'Telefone', hideMobile: true, render: r => `<span class="cell-mono">${fmtValue(r.phone)}</span>` },
    { label: 'Última compra', hideMobile: true, render: r => dOnly(r.lastOrder) },
    { label: 'Último contato', hideMobile: true, render: r => dOnly(r.lastContact) },
    { label: 'Mensagens', hideMobile: true, render: r => num(r.messages) },
    { label: 'Consentimento', render: r => statusPill(r.consent, CONSENT_STATUS) },
    { label: 'Status', render: r => r.optOut ? pill('Opt-out', 'danger') : r.suppressed ? pill('Suprimido', 'danger') : pill('Normal', 'success') },
  ]
  const { html, wire } = renderTable({ rows: d.data, columns, pagination: d.pagination, onRowClick: id => { state.customerId = id; state.customerTab = 'overview'; state.page = 1; load() }, rowClass: () => 'clickable', cardTitle: columns[0], cardMeta: columns[6] })
  if (gen !== renderGen) return
  $('content').innerHTML = d.data.length ? html : emptyState('Nenhum cliente encontrado', 'Ajuste a busca para ver outros registros.')
  if (d.data.length) wire($('content'))
}
async function renderCustomer360(id, gen, signal) {
  const d = await api('customers/' + id, signal)
  if (gen !== renderGen) return
  const tab = state.customerTab || 'overview'
  const tabs = [['overview', 'Visão geral'], ['orders', 'Pedidos'], ['messages', 'Mensagens'], ['conversations', 'Conversas'], ['checkouts', 'Carrinhos'], ['privacy', 'Privacidade']]
  const flags = []
  if (d.optOut) flags.push(pill('Opt-out', 'danger'))
  if (d.suppression) flags.push(pill('Suprimido', 'danger'))
  if (!flags.length) flags.push(pill('Contato normal', 'success'))
  $('content').innerHTML = `
    <button class="btn btn-ghost btn-sm" id="backToList" style="margin-bottom:15px">${ICONS.back} Clientes</button>
    <div class="c360-head"><div class="c360-avatar-row">
      <span class="c360-avatar">${esc(initials(d.name))}</span>
      <div><h1>${esc(d.name || 'Sem nome')}</h1>
        <div class="c360-meta"><span>Telefone <b>${fmtValue(d.phone)}</b></span><span>E-mail <b>${fmtValue(d.email)}</b></span><span>Pedidos <b>${num(d.orders.length)}</b></span><span>Mensagens <b>${num(d.messages.length)}</b></span><span>Conversas <b>${num(d.conversations.length)}</b></span></div>
      </div>
    </div><div class="c360-flags">${flags.join('')}</div></div>
    <div class="c360-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="c360Body"></div>`
  $('backToList').onclick = () => { state.customerId = null; load() }
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.customerTab = b.dataset.tab; load() })
  $('c360Body').innerHTML = renderCustomer360Tab(tab, d)
}
function renderCustomer360Tab(tab, d) {
  if (tab === 'overview') {
    const lastOrder = d.orders[0], lastMsg = d.messages[0]
    const summary = [
      lastOrder ? `Última compra em <b>${dOnly(lastOrder.date)}</b> — ${money(lastOrder.total)} via ${esc(lastOrder.paymentMethod || 'método não informado')}.` : 'Nenhuma compra registrada para este cliente.',
      lastMsg ? `Último contato via WhatsApp em <b>${dOnly(lastMsg.createdAt)}</b> — ${esc(lastMsg.templateName || 'mensagem')}, ${statusPill(lastMsg.status, MESSAGE_STATUS)}.` : 'Nenhuma mensagem registrada para este cliente.',
      d.checkouts.length ? `${num(d.checkouts.length)} carrinho(s) abandonado(s) no histórico.` : 'Nenhum carrinho abandonado no histórico.',
      d.suppression ? `Contato suprimido — ${esc(d.suppression.reason || 'motivo não informado')}.` : 'Sem suppression registrada para este contato.',
    ]
    return `<div class="panel" style="padding:4px 0 4px">${summary.map(s => `<div class="narrative-row"><span class="icon">${ICONS.chat}</span><div class="body">${s}</div></div>`).join('')}</div>
      <div class="kv-grid" style="grid-template-columns:repeat(3,1fr);margin-top:16px">
        <div class="kv"><span>Consentimentos ativos</span><b>${num(d.consents.filter(c => c.consented && !c.revokedAt).length)}</b></div>
        <div class="kv"><span>Opt-out</span><b>${boolLabel(d.optOut)}</b></div>
        <div class="kv"><span>Carrinhos no histórico</span><b>${num(d.checkouts.length)}</b></div>
      </div>`
  }
  if (tab === 'orders') return narrativeList(d.orders, o => ({ icon: 'order', title: `${esc(o.orderNumber || o.id)} · ${money(o.total)}`, sub: `${esc(o.paymentMethod || 'método não informado')} · ${statusPill(o.paymentStatus || '—', { [o.paymentStatus]: [o.paymentStatus, ['paid', 'confirmed', 'authorized'].includes(String(o.paymentStatus)) ? 'success' : 'warning'] })}`, time: dOnly(o.date) }), 'Nenhum pedido registrado.')
  if (tab === 'messages') return narrativeList(d.messages, m => ({ icon: 'send', title: esc(m.templateName || 'Mensagem'), sub: `${esc(ENTITY_TYPE[m.entityType] || m.entityType || '')} · ${statusPill(m.status, MESSAGE_STATUS)}`, time: dt(m.createdAt) }), 'Nenhuma mensagem registrada.')
  if (tab === 'conversations') return narrativeList(d.conversations, c => ({ icon: 'chat', title: statusPill(c.status, CONVERSATION_STATUS), sub: `Última mensagem em ${dt(c.lastMessageAt)}` }), 'Nenhuma conversa registrada.')
  if (tab === 'checkouts') return narrativeList(d.checkouts, c => ({ icon: 'order', title: `${esc(c.checkout || c.id)} · ${money(c.total)}`, sub: statusPill(c.status, CHECKOUT_STATUS), time: dOnly(c.date) }), 'Nenhum carrinho abandonado registrado.')
  if (tab === 'privacy') return `<div class="section-block"><div class="section-block-head"><h2>Consentimentos</h2></div>${narrativeList(d.consents, c => ({ icon: 'shield', title: esc(c.scope), sub: pill(c.consented && !c.revokedAt ? 'Concedido' : 'Revogado', c.consented && !c.revokedAt ? 'success' : 'danger') + ' · ' + esc(c.source || 'origem não informada'), time: dOnly(c.consentedAt) }), 'Nenhum consentimento registrado.')}</div>
    <div class="section-block"><div class="section-block-head"><h2>Suppression</h2></div>${d.suppression ? `<div class="kv"><span>Motivo</span><b>${fmtValue(d.suppression.reason)}</b></div>` : '<p class="cell-muted">Nenhuma suppression registrada para este contato.</p>'}</div>`
  return ''
}

// ── ÁREA: CONSENTIMENTOS (aba local de Cliente 360) ──────────────────────────────────────────
async function renderConsentsArea(gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' })
  const d = await api('consents?' + qs, signal)
  const columns = [
    { label: 'Telefone', render: r => `<span class="cell-mono">${fmtValue(r.phone)}</span>` },
    { label: 'Escopo', render: r => esc(r.scope) },
    { label: 'Status', render: r => statusPill(r.status, CONSENT_STATUS) },
    { label: 'Origem', render: r => esc(r.source || '—') },
    { label: 'Concedido em', render: r => dOnly(r.consentedAt) },
    { label: 'Revogado em', render: r => dOnly(r.revokedAt) },
  ]
  const { html, wire } = renderTable({ rows: d.data, columns, pagination: d.pagination })
  if (gen !== renderGen) return
  $('content').innerHTML = `<div class="notice">Consentimento, opt-out e suppression são conceitos distintos: consentimento é a permissão explícita de contato por escopo; opt-out e suppression (ver Cliente 360) bloqueiam o contato independentemente do consentimento.</div>` + (d.data.length ? html : emptyState('Nenhum consentimento registrado')); if (d.data.length) wire($('content'))
}

// ── ÁREA: CONVERSAS (inbox 3 colunas) ────────────────────────────────────────────────────────
async function renderConversationsArea(gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' }); if (state.search) qs.set('search', state.search)
  const d = await api('conversations?' + qs, signal)
  if (gen !== renderGen) return
  const activeId = state.convoId
  const listHtml = (d.data || []).map(r => `<div class="inbox-list-row ${r.id === activeId ? 'active' : ''}" data-id="${esc(r.id)}"><div class="top"><span>${esc(r.contact || 'Sem nome')}</span><time>${dt(r.lastMessageAt)}</time></div><div class="preview">${esc(r.preview || '')}</div><div>${statusPill(r.status, CONVERSATION_STATUS)}</div></div>`).join('') || '<div class="inbox-empty">Nenhuma conversa encontrada.</div>'
  $('content').innerHTML = `<div class="inbox-grid ${state.mobileThreadOpen ? 'inbox-view-thread' : 'inbox-view-list'}"><div class="inbox-list">${listHtml}</div><div class="inbox-thread" id="thread"><div class="inbox-empty">Selecione uma conversa para ver o histórico.</div></div><div class="inbox-context" id="threadContext"></div></div>`
  document.querySelectorAll('.inbox-list-row[data-id]').forEach(row => row.onclick = () => { state.convoId = row.dataset.id; state.mobileThreadOpen = true; document.querySelector('.inbox-grid').classList.add('inbox-view-thread'); document.querySelector('.inbox-grid').classList.remove('inbox-view-list'); loadConversationThread(row.dataset.id, gen) })
  if (activeId) loadConversationThread(activeId, gen)
}
async function loadConversationThread(id, gen) {
  document.querySelectorAll('.inbox-list-row').forEach(r => r.classList.toggle('active', r.dataset.id === id))
  const threadEl = $('thread'); if (threadEl) threadEl.innerHTML = '<div class="skeleton" style="padding:18px"><div class="sk-row"></div><div class="sk-row"></div></div>'
  try {
    const c = await api('conversations/' + id)
    if (gen !== renderGen || !$('thread')) return
    const bubbles = (c.messages || []).map(m => `<div class="bubble ${m.direction === 'inbound' ? 'in' : 'out'}">${esc(m.body || `[${m.type}]`)}<time>${dt(m.timestamp || m.createdAt)}</time></div>`).join('') || '<div class="inbox-empty">Sem mensagens nesta conversa.</div>'
    $('thread').innerHTML = `<div class="inbox-thread-head"><button class="inbox-thread-back" id="threadBack">${ICONS.back}</button><span>${esc(c.contact?.name || 'Sem nome')}</span>${statusPill(c.status, CONVERSATION_STATUS)}</div><div class="inbox-thread-body">${bubbles}</div>`
    $('threadBack').onclick = () => { state.mobileThreadOpen = false; document.querySelector('.inbox-grid').classList.add('inbox-view-list'); document.querySelector('.inbox-grid').classList.remove('inbox-view-thread') }
    $('threadContext').innerHTML = `<p class="eyebrow">CONTATO</p><div class="kv" style="margin-bottom:11px"><span>Telefone</span><b>${fmtValue(c.contact?.phone)}</b></div><p class="cell-muted" style="font-size:11.5px;line-height:1.6">Painel somente leitura — sem opções de envio ou alteração de status a partir daqui.</p>`
  } catch (e) { if (gen === renderGen && $('thread')) $('thread').innerHTML = `<div class="inbox-empty">${esc(e.message)}</div>` }
}

// ── ÁREA: CARRINHO (pipeline) ─────────────────────────────────────────────────────────────────
async function renderCheckoutsArea(gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' })
  const d = await api('checkouts?' + qs, signal)
  if (gen !== renderGen) return
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
    { label: 'Itens', hideMobile: true, render: r => `<span title="${esc(r.products || '')}">${fmtValue(r.products)}</span>` },
    { label: 'Valor', render: r => money(r.total) },
    { label: 'Abandono', hideMobile: true, render: r => dt(r.date) },
    { label: 'Elegibilidade', render: r => r.eligible === true ? pill('Elegível agora', 'success') : r.eligible === false ? pill(((r.blockers || [])[0] && (CHECKOUT_BLOCKERS[r.blockers[0]] || r.blockers[0])) || 'Bloqueado', 'warning') : pill('Não avaliado', 'neutral') },
    { label: 'Mensagem', hideMobile: true, render: r => r.message ? statusPill(r.message.status, MESSAGE_STATUS) : '<span class="cell-muted">Nenhuma ainda</span>' },
    { label: 'Status', render: r => statusPill(r.status, CHECKOUT_STATUS) },
  ]
  const { html, wire } = renderTable({ rows, columns, pagination: d.pagination, onRowClick: id => openCheckoutDetail(rows.find(r => r.id === id)), rowClass: () => 'clickable', cardTitle: columns[0], cardMeta: columns[2] })
  $('content').innerHTML = pipeline + (rows.length ? html : emptyState('Nenhum carrinho abandonado nesta página')); if (rows.length) wire($('content'))
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

// ── ÁREAS: PIX / BOLETO (abas locais de Carrinho) ────────────────────────────────────────────
async function renderPaymentsArea(method, gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' })
  const d = await api('payments/' + method + '?' + qs, signal)
  if (gen !== renderGen) return
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
  $('content').innerHTML = summary + (rows.length ? html : emptyState('Nenhum pedido pendente encontrado')); if (rows.length) wire($('content'))
}

// ── ÁREA: REMARKETING (aba local de Carrinho) ────────────────────────────────────────────────
async function renderRemarketingArea(gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '25' })
  const d = await api('remarketing?' + qs, signal)
  if (gen !== renderGen) return
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
  $('content').innerHTML = runtime + `<div class="segment-row">${segCards}</div>` + (rows.length ? html : emptyState('Nenhuma execução de remarketing registrada')); if (rows.length) wire($('content'))
}

// ── ÁREA: CAMPANHAS & IA · ABA OPORTUNIDADES ─────────────────────────────────────────────────
// Oportunidades são calculadas pelo backend a partir de dados já existentes (nunca estimadas
// aqui). recommendedProduct hoje é sempre null — não existe catálogo de produto por pedido
// ainda — e a tela precisa dizer isso honestamente em vez de inventar um nome de produto.
async function renderOpportunitiesArea(gen, signal) {
  const d = await api('ai/opportunities', signal)
  if (gen !== renderGen) return
  const rows = d.data || []
  if (!rows.length) { $('content').innerHTML = emptyState('Nenhuma oportunidade real hoje', 'Quando houver audiência elegível para contato, ela aparece aqui automaticamente — nenhuma oportunidade é criada artificialmente.'); return }
  $('content').innerHTML = `<div class="opp-grid">${rows.map(renderOpportunityCard).join('')}</div>`
  document.querySelectorAll('[data-gen-opp]').forEach(btn => btn.onclick = () => generateCampaignFromOpportunity(btn.dataset.genOpp, btn))
}
function renderOpportunityCard(o) {
  const [confLabel, confTone] = OPPORTUNITY_CONFIDENCE[o.confidence] || ['Confiança não informada', 'neutral']
  const noAudience = o.eligibleCount === 0
  const blockers = (o.evidence?.topBlockers || []).slice(0, 3)
  const dq = o.evidence?.dataQuality || {}
  const dqFlags = [dq.historyTruncated ? pill('Histórico truncado', 'warning') : '', dq.consentSourceConfigured === false ? pill('Origem de consentimento não configurada', 'warning') : '', dq.metaTemplatesVerified === false ? pill('Templates Meta não verificados', 'warning') : ''].filter(Boolean)
  return `<div class="opp-card">
    <div class="opp-card-head"><span class="opp-type">${esc(OPPORTUNITY_TYPE[o.type] || o.type)}</span>${pill(confLabel, confTone)}</div>
    <h3>${esc(o.title)}</h3>
    <p class="opp-reason">${esc(o.reason)}</p>
    <div class="opp-audience">
      <div class="opp-audience-stat"><b>${num(o.audienceCount)}</b><span>Audiência total</span></div>
      <div class="opp-audience-stat good"><b>${num(o.eligibleCount)}</b><span>Elegíveis agora</span></div>
      <div class="opp-audience-stat warn"><b>${num(o.blockedCount)}</b><span>Bloqueados</span></div>
    </div>
    ${noAudience ? `<div class="ai-banner warning"><span class="icon">${ICONS.alert}</span><div><b>Nenhuma audiência elegível agora</b><p>Gerar uma campanha não teria a quem enviar — resolva os bloqueios abaixo primeiro.</p></div></div>` : ''}
    ${blockers.length ? `<div class="opp-blockers"><span class="label">Principais bloqueios</span>${blockers.map(b => `<span class="opp-blocker-chip">${esc(CHECKOUT_BLOCKERS[b.reason] || b.reason)}<b>${num(b.count)}</b></span>`).join('')}</div>` : ''}
    <div class="opp-meta-row">
      <span>Horário recomendado <b>${fmtValue(o.recommendedTiming)}</b></span>
      <span>Canal <b>WhatsApp</b></span>
      <span>Produto <b class="cell-muted">Produto ainda não recomendado</b></span>
    </div>
    ${dqFlags.length ? `<div class="opp-dq">${dqFlags.join('')}</div>` : ''}
    <div class="opp-card-foot">
      <span class="cell-muted" style="font-size:11px">Gerado em ${dt(o.generatedAt)} · Template sugerido <b class="cell-mono">${fmtValue(o.evidence?.template)}</b></span>
      <button class="btn btn-primary btn-sm" data-gen-opp="${esc(o.id)}" ${noAudience ? 'disabled' : ''}>Gerar campanha</button>
    </div>
    <div class="opp-error" id="oppErr-${esc(o.id)}"></div>
  </div>`
}
async function generateCampaignFromOpportunity(opportunityId, btn) {
  const errEl = $('oppErr-' + opportunityId)
  const originalLabel = btn.textContent
  btn.disabled = true; btn.textContent = 'Gerando…'
  if (errEl) errEl.innerHTML = ''
  try {
    const draft = await apiPost('ai/campaigns', { opportunityId })
    state.tab = 'campaigns'; state.campaignId = draft.id; state.page = 1
    load()
  } catch (e) {
    btn.disabled = false; btn.textContent = originalLabel
    if (errEl) { const info = describeAiIssue(e); errEl.innerHTML = `<div class="ai-banner danger"><span class="icon">${ICONS.alert}</span><div><b>${esc(info.title)}</b><p>${esc(info.body)}</p><p class="cell-muted" style="margin-top:4px;font-size:10.5px">${esc(e.message)}</p></div></div>` }
  }
}

// ── ÁREA: CAMPANHAS & IA · ABA CAMPANHAS ─────────────────────────────────────────────────────
// Não existe endpoint de leitura de uma única campanha no contrato — a lista completa
// (GET ai/campaigns) já traz strategies e complianceFindings por item, então o detalhe é
// resolvido buscando o id dentro da mesma lista, sem inventar um endpoint extra.
async function renderCampaignsArea(gen, signal) {
  const d = await api('ai/campaigns', signal)
  if (gen !== renderGen) return
  const rows = d.data || []
  if (state.campaignId) {
    const draft = rows.find(c => c.id === state.campaignId)
    if (!draft) { $('content').innerHTML = `<button class="btn btn-ghost btn-sm" id="campBack" style="margin-bottom:15px">${ICONS.back} Campanhas</button>` + emptyState('Campanha não encontrada', 'Ela pode ter sido removida ou o identificador não é mais válido.'); $('campBack').onclick = () => { state.campaignId = null; load() }; return }
    renderCampaignDetail(draft)
    return
  }
  if (!rows.length) { $('content').innerHTML = emptyState('Nenhuma campanha criada ainda', 'Gere uma campanha a partir de uma oportunidade real na aba Oportunidades.'); return }
  $('content').innerHTML = `<div class="campaign-list">${rows.map(renderCampaignRow).join('')}</div>`
  document.querySelectorAll('[data-campaign-id]').forEach(el => el.onclick = () => { state.campaignId = el.dataset.campaignId; load() })
}
function renderCampaignRow(c) {
  const [label, tone] = CAMPAIGN_STATUS[c.status] || [c.status || 'Status incerto', 'warning']
  const title = c.opportunityTitle || (OPPORTUNITY_TYPE[c.opportunityType] ? `${OPPORTUNITY_TYPE[c.opportunityType]} · Campanha ${String(c.id).slice(0, 6)}` : `Campanha ${String(c.id).slice(0, 6)}`)
  return `<div class="campaign-row clickable" data-campaign-id="${esc(c.id)}">
    <div class="campaign-row-main"><b>${esc(title)}</b><span class="cell-muted">${num((c.strategies || []).length)} estratégia(s)</span></div>
    ${pill(label, tone)}
    <span class="cell-muted" style="font-size:11px;white-space:nowrap">${dt(c.updatedAt || c.createdAt)}</span>
  </div>`
}
function campaignStepper(status) {
  if (status === 'CANCELLED') return `<div class="campaign-stepper">${pill('Campanha cancelada', 'neutral')}</div>`
  const idx = CAMPAIGN_STATUS_ORDER.indexOf(status)
  const dots = CAMPAIGN_STATUS_ORDER.map((s, i) => `<span class="cs-dot ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}" title="${esc((CAMPAIGN_STATUS[s] || [s])[0])}"></span>`).join('')
  const label = (CAMPAIGN_STATUS[status] || [status])[0]
  return `<div class="campaign-stepper"><div class="cs-dots">${dots}</div><span class="cs-current-label">${esc(label)}</span></div>`
}
function renderCampaignDetail(draft) {
  const strategies = draft.strategies || []
  const findings = draft.complianceFindings || []
  const strategiesHtml = strategies.length
    ? `<p class="strategy-swipe-hint">Arraste para comparar A · B · C</p><div class="strategy-grid">${strategies.map((s, i) => renderStrategyCard(draft.id, s, i)).join('')}</div>`
    : `<div class="ai-banner warning"><span class="icon">${ICONS.alert}</span><div><b>A IA ainda não retornou estratégias</b><p>Esta campanha está registrada, mas nenhuma estratégia foi gerada ainda para ela.</p></div></div>`
  const complianceBlock = findings.length ? `<div class="section-block"><div class="section-block-head"><h2>Achados de compliance</h2></div><div class="panel">${findings.map(f => `<div class="narrative-row"><span class="icon">${ICONS.shield}</span><div class="body"><b>${esc(f.claim)}</b><div class="sub">${esc(f.reason)}</div></div></div>`).join('')}</div></div>` : ''
  $('content').innerHTML = `
    <button class="btn btn-ghost btn-sm" id="campBack" style="margin-bottom:15px">${ICONS.back} Campanhas</button>
    <div class="campaign-head"><div><p class="eyebrow">CAMPANHA GERADA POR IA · APROVAÇÃO HUMANA OBRIGATÓRIA</p><h1>${esc(draft.opportunityTitle || `Campanha ${String(draft.id).slice(0, 6)}`)}</h1></div>${campaignStepper(draft.status)}</div>
    <div class="section-block"><div class="section-block-head"><h2>Estratégias (A · B · C)</h2><span class="hint">Product Truth e compliance avaliados por estratégia</span></div>${strategiesHtml}</div>
    ${complianceBlock}
    ${renderCampaignActionBlock(draft)}`
  $('campBack').onclick = () => { state.campaignId = null; load() }
  wireCampaignActions(draft)
}
function renderStrategyCard(campaignId, s, i) {
  const letter = ['A', 'B', 'C'][i] || String(i + 1)
  const blocked = s.status === 'BLOCKED'
  const selected = state.selectedStrategy[campaignId] === i
  return `<div class="strategy-card ${blocked ? 'blocked' : ''} ${selected ? 'selected' : ''}">
    <div class="strategy-head"><span class="strategy-letter">${letter}</span><h3>${esc(s.name)}</h3>${pill(blocked ? 'Bloqueada' : 'Liberada', blocked ? 'danger' : 'success')}</div>
    <p class="strategy-angle">${esc(s.angle)}</p>
    <div class="strategy-field"><span class="label">Público</span><p>${esc(s.audience)}</p></div>
    <div class="strategy-field"><span class="label">Produto</span><p>${s.productId ? `<span class="cell-mono">${esc(s.productId)}</span>` : '<span class="cell-muted">Produto ainda não confirmado pela IA</span>'}</p></div>
    <div class="strategy-field"><span class="label">Mensagem</span><blockquote class="strategy-message">${esc(s.message)}</blockquote></div>
    <div class="strategy-field"><span class="label">CTA</span><p>${esc(s.cta)}</p></div>
    <div class="strategy-field"><span class="label">Brief criativo</span><p>${esc(s.creativeBrief)}</p></div>
    ${(s.warnings || []).length ? `<div class="strategy-warnings">${s.warnings.map(w => `<span class="strategy-warning"><span class="icon">${ICONS.alert}</span>${esc(w)}</span>`).join('')}</div>` : ''}
    ${blocked && (s.findings || []).length ? `<div class="strategy-findings">${s.findings.map(f => `<div class="ai-banner danger"><span class="icon">${ICONS.alert}</span><div><b>${esc(f.claim)}</b><p>${esc(f.reason)}</p></div></div>`).join('')}</div>` : ''}
    <button class="btn ${selected ? 'btn-primary' : 'btn-ghost'} btn-sm btn-block" data-select-strategy="${i}" data-campaign-id="${esc(campaignId)}" ${blocked ? 'disabled' : ''}>${selected ? 'Selecionada — salva como rascunho' : 'Usar esta estratégia'}</button>
  </div>`
}
function renderCampaignActionBlock(draft) {
  if (draft.status === 'AWAITING_HUMAN_APPROVAL') {
    return `<div class="section-block approval-box">
      <p class="eyebrow">AÇÃO HUMANA OBRIGATÓRIA</p>
      <h2>Esta campanha aguarda aprovação humana</h2>
      <p class="approval-copy">A IA nunca aprova uma campanha por conta própria. Um humano precisa confirmar explicitamente, com o próprio nome, antes de qualquer agendamento.</p>
      <div id="approvalStart" class="approval-row"><input id="approverName" type="text" placeholder="Seu nome" autocomplete="off"><button class="btn btn-primary" id="approveBtn">Aprovar campanha</button></div>
      <p id="approvalNameHint" class="approval-hint"></p>
      <div id="approvalConfirm" class="approval-row hidden"><span id="approvalConfirmLabel" class="approval-confirm-label"></span><button class="btn btn-primary" id="confirmApproveBtn">Confirmar aprovação</button><button class="btn btn-ghost" id="cancelApproveBtn">Cancelar</button></div>
      <div id="approvalError"></div>
    </div>`
  }
  if (draft.status === 'APPROVED') {
    return `<div class="section-block approval-box approved">
      <p class="eyebrow">APROVADA</p>
      <h2>Pronta para agendar</h2>
      <p class="approval-copy">O agendamento roda em modo simulado (dry-run) nesta fase. Não existe disparo real a partir desta tela.</p>
      <button class="btn btn-primary" id="scheduleBtn">Agendar (modo simulado)</button>
      <div id="scheduleError"></div>
    </div>`
  }
  if (['SCHEDULED', 'RUNNING', 'COMPLETED'].includes(draft.status)) {
    const [label, tone] = CAMPAIGN_STATUS[draft.status] || [draft.status, 'neutral']
    return `<div class="notice">${pill(label, tone)} — envio real está desligado nesta fase; qualquer execução aqui é simulada (dry-run).</div>`
  }
  if (draft.status === 'CANCELLED') return `<div class="notice">Esta campanha foi cancelada.</div>`
  return `<div class="notice">Esta campanha ainda está em preparação. A aprovação humana fica disponível quando o status avançar para <b>Aguardando aprovação humana</b>.</div>`
}
function wireCampaignActions(draft) {
  document.querySelectorAll('[data-select-strategy]').forEach(btn => btn.onclick = () => selectStrategy(draft.id, Number(btn.dataset.selectStrategy)))
  if ($('approveBtn')) $('approveBtn').onclick = () => {
    const name = $('approverName').value.trim()
    if (!name) { $('approvalNameHint').textContent = 'Informe quem está aprovando.'; return }
    $('approvalNameHint').textContent = ''
    $('approvalConfirmLabel').textContent = `Confirmar que ${name} aprova esta campanha?`
    $('approvalStart').classList.add('hidden'); $('approvalConfirm').classList.remove('hidden')
  }
  if ($('cancelApproveBtn')) $('cancelApproveBtn').onclick = () => { $('approvalConfirm').classList.add('hidden'); $('approvalStart').classList.remove('hidden') }
  if ($('confirmApproveBtn')) $('confirmApproveBtn').onclick = () => confirmApproval(draft.id)
  if ($('scheduleBtn')) $('scheduleBtn').onclick = () => scheduleCampaign(draft.id)
}
async function selectStrategy(campaignId, index) {
  try { await apiPost(`ai/campaigns/${campaignId}/select`, { strategyIndex: index }); state.selectedStrategy[campaignId] = index; load() }
  catch (e) { alert(e.message) }
}
async function confirmApproval(campaignId) {
  const name = $('approverName').value.trim()
  const btn = $('confirmApproveBtn'); btn.disabled = true; btn.textContent = 'Aprovando…'
  const adminSecret = await openAdminModal()
  if (adminSecret === null) { btn.disabled = false; btn.textContent = 'Confirmar aprovação'; return }
  try { await apiPostAdmin(`ai/campaigns/${campaignId}/approve`, { approvedBy: name }, adminSecret); load() }
  catch (e) {
    btn.disabled = false; btn.textContent = 'Confirmar aprovação'
    const info = describeAiIssue(e)
    $('approvalError').innerHTML = `<div class="ai-banner danger" style="margin-top:10px"><span class="icon">${ICONS.alert}</span><div><b>${esc(info.title)}</b><p>${esc(info.body)}</p></div></div>`
  }
}
async function scheduleCampaign(campaignId) {
  const btn = $('scheduleBtn'); btn.disabled = true; btn.textContent = 'Agendando…'
  const adminSecret = await openAdminModal()
  if (adminSecret === null) { btn.disabled = false; btn.textContent = 'Agendar (modo simulado)'; return }
  try { await apiPostAdmin(`ai/campaigns/${campaignId}/schedule`, {}, adminSecret); load() }
  catch (e) {
    btn.disabled = false; btn.textContent = 'Agendar (modo simulado)'
    const info = describeAiIssue(e)
    $('scheduleError').innerHTML = `<div class="ai-banner danger" style="margin-top:10px"><span class="icon">${ICONS.alert}</span><div><b>${esc(info.title)}</b><p>${esc(info.body)}</p></div></div>`
  }
}

// ── ÁREA: CAMPANHAS & IA · ABA APRENDIZADOS ──────────────────────────────────────────────────
// Só métricas comprovadas de entrega/engajamento. "Pedidos após exposição" nunca é chamado de
// conversão — não há atribuição causal automática. Envio real desligado nesta fase é um estado
// honesto de "sem dados ainda", nunca um zero fabricado ao lado de métricas reais.
async function renderLearningArea(gen, signal) {
  const d = await api('ai/learning', signal)
  if (gen !== renderGen) return
  const byStatus = d.campaignsByStatus || {}
  const statusRows = Object.keys(byStatus).length
    ? `<div class="section-block"><div class="section-block-head"><h2>Campanhas por status</h2></div><div class="learning-grid">${Object.entries(byStatus).map(([s, n]) => `<div class="learning-metric"><span class="n">${num(n)}</span><span class="l">${esc((CAMPAIGN_STATUS[s] || [s])[0])}</span></div>`).join('')}</div></div>`
    : ''
  if (!d.metricsAvailable) {
    $('content').innerHTML = statusRows + emptyState('Sem métricas de envio ainda', fmtValue(d.reason) || 'O envio real de campanhas está desligado nesta fase — não há mensagens enviadas para medir.')
    return
  }
  // Reservado para quando metricsAvailable=true: o backend ainda não expõe sent/delivered/read/
  // replies/orders_after_campaign por campanha (exigiria MessageLog.campaignDraftId, fora do
  // escopo desta fase) — nunca inventar esses números enquanto o campo não existir de verdade.
  const metrics = [['Enviadas', d.sent], ['Entregues', d.delivered], ['Lidas', d.read], ['Respostas', d.replies], ['Pedidos após exposição', d.orders_after_campaign]].filter(([, v]) => v !== undefined && v !== null)
  $('content').innerHTML = statusRows + `<div class="notice">Métricas comprovadas de entrega e engajamento. "Pedidos após exposição" indica pedidos observados depois do contato — não é uma conversão atribuída automaticamente à campanha.</div>
    ${metrics.length ? `<div class="learning-grid">${metrics.map(([l, v]) => `<div class="learning-metric"><span class="n">${num(v)}</span><span class="l">${esc(l)}</span></div>`).join('')}</div>` : ''}`
}

// ── ÁREA: CAMPANHAS & IA · ABA AUTOMAÇÕES (regra vs. runtime, conteúdo já existente) ─────────
async function renderAutomationsArea(gen, signal) {
  const d = await api('automations', signal)
  if (gen !== renderGen) return
  const cards = (d.data || []).map(r => {
    const nodes = [`Trigger — ${EVENT_TYPE[r.eventType] || r.eventType}`, r.delayMinutes ? `Esperar ${r.delayMinutes} min` : null, r.stopIfOrderExists ? 'Verificar se já existe pedido' : null, `Template — ${r.templateName}`, 'WhatsApp'].filter(Boolean)
    const flowMismatch = r.active && !r.runtime.automationSendEnabled
    return `<div class="flow-card"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div><h3>${esc(r.name)}</h3><p class="sub">${esc(EVENT_TYPE[r.eventType] || r.eventType)}</p></div>${pill(r.active ? 'Regra ativa' : 'Regra inativa', r.active ? 'success' : 'neutral')}</div>
      <div class="flow-grid">
        <div class="flow-steps">${nodes.map((n, i) => `<div class="flow-node">${n}</div>${i < nodes.length - 1 ? '<div class="flow-arrow">↓</div>' : ''}`).join('')}</div>
        <div class="flow-side">
          <div class="kv"><span>Máx. envios por entidade</span><b>${num(r.maxSendsPerEntity)}</b></div>
          <p class="rvr-label">Regra configurada <span class="arrow">→</span> Runtime real</p>
          <div class="rule-vs-runtime">
            <div class="row"><span>Regra</span>${pill(r.active ? 'Ativa' : 'Inativa', r.active ? 'success' : 'neutral')}</div>
            <div class="row ${flowMismatch ? 'mismatch' : ''}"><span>Runtime</span>${pill(r.runtime.automationSendEnabled ? 'Envio liberado' : 'Envio bloqueado', r.runtime.automationSendEnabled ? 'success' : 'danger')}</div>
            ${r.eventType === 'abandoned_checkout' ? `<div class="row"><span>Fluxo carrinho</span>${pill(r.runtime.flowEnabled ? 'Habilitado' : 'Desabilitado', r.runtime.flowEnabled ? 'success' : 'neutral')}</div>` : ''}
            <div class="row"><span>Modo</span>${pill(r.runtime.whatsappDryRun ? 'Dry-run (simulado)' : 'Envio real', r.runtime.whatsappDryRun ? 'warning' : 'brand')}</div>
            ${flowMismatch ? `<div class="rvr-flag"><span class="icon">${ICONS.alert}</span>Regra ativa, mas o envio está bloqueado em runtime</div>` : ''}
          </div>
        </div>
      </div></div>`
  }).join('')
  $('content').innerHTML = cards || emptyState('Nenhuma automação configurada')
}

// ── ÁREA: SAÚDE ──────────────────────────────────────────────────────────────────────────────
async function renderHealthArea(gen, signal) {
  const h = await api('health', signal)
  if (gen !== renderGen) return
  function tile(name, ok, note) { return `<div class="health-tile"><div class="health-tile-top"><span class="health-tile-icon ${ok ? 'ok' : 'warn'}">${ok ? ICONS.check : ICONS.alert}</span><div class="name">${esc(name)}</div></div>${pill(ok ? 'Última verificação bem-sucedida' : 'Sem confirmação recente', ok ? 'success' : 'warning')}<p class="cell-muted" style="margin-top:9px;font-size:11.5px">${note}</p></div>` }
  const metaOk = h.meta.configured && h.meta.latestEvidence && !h.meta.latestEvidence.error && !isStale(h.meta.latestEvidence.createdAt)
  const nuvemOk = h.nuvemshop.configured && h.nuvemshop.latestEvidence && !h.nuvemshop.latestEvidence.error && !isStale(h.nuvemshop.latestEvidence.createdAt)
  const recoveryOk = h.recoveryEngine.failed === 0 && h.recoveryEngine.unknown === 0
  const mirrorOk = h.inboxMirror.failed === 0
  const board = `<div class="health-board">
    ${tile('Meta / WhatsApp', metaOk, h.meta.latestEvidence ? `Última evidência: ${dt(h.meta.latestEvidence.createdAt)}` : 'Nenhuma evidência registrada')}
    ${tile('Nuvemshop', nuvemOk, h.nuvemshop.latestEvidence ? `Última evidência: ${dt(h.nuvemshop.latestEvidence.createdAt)}` : 'Nenhuma evidência registrada')}
    ${tile('Motor de recuperação', recoveryOk, `${num(h.recoveryEngine.pending)} pendentes · ${num(h.recoveryEngine.processing)} processando`)}
    ${tile('Espelhamento no inbox', mirrorOk, h.inboxMirror.latestSuccess ? `Último espelhamento: ${dt(h.inboxMirror.latestSuccess)}` : 'Nenhum espelhamento bem-sucedido registrado')}
  </div>`
  const details = `<div class="health-detail-grid">
    <div class="panel"><div class="panel-head"><b>Motor de recuperação</b></div><div style="padding:15px 17px"><div class="kv-grid"><div class="kv"><span>Pendentes</span><b>${num(h.recoveryEngine.pending)}</b></div><div class="kv"><span>Processando</span><b>${num(h.recoveryEngine.processing)}</b></div><div class="kv"><span>Falhas</span><b>${num(h.recoveryEngine.failed)}</b></div><div class="kv"><span>Status incerto</span><b>${num(h.recoveryEngine.unknown)}</b></div></div><div class="kv" style="margin-top:8px"><span>Pendente mais antigo</span><b>${dt(h.recoveryEngine.oldestPending)}</b></div></div></div>
    <div class="panel"><div class="panel-head"><b>Espelhamento no inbox</b></div><div style="padding:15px 17px"><div class="kv-grid"><div class="kv"><span>Falhas</span><b>${num(h.inboxMirror.failed)}</b></div><div class="kv"><span>Último sucesso</span><b>${dt(h.inboxMirror.latestSuccess)}</b></div></div></div></div>
    <div class="panel"><div class="panel-head"><b>Runtime</b></div><div style="padding:15px 17px" class="kv-grid">
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

// ── ÁREA: AUDITORIA (aba local de Saúde) ─────────────────────────────────────────────────────
async function renderAuditArea(gen, signal) {
  const qs = new URLSearchParams({ page: String(state.page), pageSize: '30' })
  const d = await api('audit?' + qs, signal)
  if (gen !== renderGen) return
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
  $('content').innerHTML = notice + (d.data.length ? html : emptyState('Nenhum evento técnico registrado')); if (d.data.length) wire($('content'))
}

// ── Registro de áreas (mesmo dado, 16 áreas reais mapeadas para 7 destinos principais) ───────
const AREAS = {
  dashboard: renderDashboard,
  messages: renderMessagesArea,
  templates: renderTemplatesArea,
  customers: renderCustomersArea,
  consents: renderConsentsArea,
  conversations: renderConversationsArea,
  checkouts: renderCheckoutsArea,
  pix: (gen, signal) => renderPaymentsArea('pix', gen, signal),
  boleto: (gen, signal) => renderPaymentsArea('boleto', gen, signal),
  remarketing: renderRemarketingArea,
  opportunities: renderOpportunitiesArea,
  campaigns: renderCampaignsArea,
  'automation-rules': renderAutomationsArea,
  learning: renderLearningArea,
  health: renderHealthArea,
  audit: renderAuditArea,
}

render()
