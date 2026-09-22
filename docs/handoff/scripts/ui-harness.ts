// Harness de verificação visual (FORA do repositório). Sobe o Express REAL em modo Preview
// read-only e troca só os pontos de banco por dados sintéticos — o motor de segmentação, a
// biblioteca, as recomendações, as rotas e a UI são os reais.
const REPO = 'C:/Users/peter/OneDrive/Peter/particular/Documentos/desafio pai e filho/drosa-recovery-crm-ops'
process.env.NODE_ENV = 'development'
process.env.PORT = '3457'
process.env.CRM_PREVIEW_READONLY = 'true'
process.env.CRM_READ_SECRET = 'harness-secret'
process.env.DATABASE_URL = 'postgresql://harness:harness@localhost:5432/harness'
process.env.DIRECT_URL = 'postgresql://harness:harness@localhost:5432/harness'
process.env.WHATSAPP_DRY_RUN = 'true'
process.env.AUTOMATION_SEND_ENABLED = 'false'
process.env.REMARKETING_ENABLED = 'false'
process.env.ENABLE_INTERNAL_CRON = 'false'
process.chdir(REPO)

// eslint-disable-next-line @typescript-eslint/no-var-requires
const engine = require(REPO + '/src/services/emailAudienceEngine')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const campaignServiceModule = require(REPO + '/src/services/ai/campaignService')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const compliance = require(REPO + '/src/services/ai/complianceService')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const distance = require(REPO + '/src/services/ai/strategyDistanceService')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rubric = require(REPO + '/src/services/ai/strategyQualityRubric')

const NOW = new Date()
const DAY = 86_400_000
// Distribuição sintética de ~50 mil identidades (só para a verificação visual).
let seed = 42
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const rows: unknown[] = []
const push = (n: number, make: () => unknown) => { for (let i = 0; i < n; i++) rows.push(make()) }
const base = { validEmail: true, paidOrderCount: 0, paidTotal: 0, lastPaidAt: null, undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false }
const ago = (min: number, max: number) => new Date(NOW.getTime() - (min + rnd() * (max - min)) * DAY)
push(4200, () => ({ ...base, paidOrderCount: 1, paidTotal: 90 + rnd() * 200, lastPaidAt: ago(0, 30) }))
push(3100, () => ({ ...base, paidOrderCount: 1, paidTotal: 90 + rnd() * 200, lastPaidAt: ago(31, 60) }))
push(2431, () => ({ ...base, paidOrderCount: 1, paidTotal: 90 + rnd() * 200, lastPaidAt: ago(61, 90) }))
push(6800, () => ({ ...base, paidOrderCount: 1, paidTotal: 90 + rnd() * 200, lastPaidAt: ago(91, 180), whatsappOptOut: rnd() < 0.02 }))
push(9100, () => ({ ...base, paidOrderCount: 1, paidTotal: 90 + rnd() * 200, lastPaidAt: ago(181, 365) }))
push(11800, () => ({ ...base, paidOrderCount: 1, paidTotal: 90 + rnd() * 200, lastPaidAt: ago(366, 1200) }))
push(2600, () => ({ ...base, paidOrderCount: 2, paidTotal: 220 + rnd() * 250, lastPaidAt: ago(0, 60) }))
push(1900, () => ({ ...base, paidOrderCount: 2 + Math.floor(rnd() * 2), paidTotal: 300 + rnd() * 400, lastPaidAt: ago(61, 500) }))
push(640, () => ({ ...base, paidOrderCount: 3 + Math.floor(rnd() * 3), paidTotal: 520 + rnd() * 900, lastPaidAt: ago(0, 60) }))
push(410, () => ({ ...base, paidOrderCount: 4, paidTotal: 700 + rnd() * 600, lastPaidAt: ago(61, 400) }))
push(3300, () => ({ ...base }))
push(210, () => ({ ...base, recentAbandonedCart: true }))
push(940, () => ({ ...base, validEmail: false, paidOrderCount: 1, paidTotal: 100, lastPaidAt: ago(20, 700) }))
push(380, () => ({ ...base, paidOrderCount: 1, paidTotal: 100, lastPaidAt: null, undatedPaidOrders: 1 }))
const quality = { totalCustomers: 61240, customersWithoutEmail: 10310, paidOrders: 44900, paidOrdersWithoutEmail: 1830, paidOrdersWithoutDate: 421 }
const t0 = Date.now()
const snapshot = engine.buildEmailAudienceSnapshot(rows, quality, NOW)
console.log(`[harness] snapshot de ${rows.length} identidades em ${Date.now() - t0}ms`)
engine.getEmailAudienceSnapshot = async () => snapshot

// Rascunho de e-mail de exemplo, auditado pelos MESMOS auditores reais.
const strategies = [
  { direction: 'A', name: 'Reconexão sem pressão', angle: 'Reabrir o contato com leveza', audience: 'Clientes sem comprar há 61–90 dias', productId: null,
    subject: 'Sentimos a sua falta por aqui', preheader: 'Passe quando tiver um tempinho para conferir o catálogo',
    headline: 'Que bom ter você por perto',
    body: 'Faz um tempinho que não nos falamos e queríamos dizer que estamos por aqui.\nSe quiser conhecer o catálogo atual, ele está a um clique de você — sem pressa nenhuma e sem compromisso.\nSe precisar de ajuda para escolher, é só responder este e-mail que a nossa equipe conversa com você.',
    cta: 'Conhecer o catálogo', creativeBrief: 'Tom acolhedor e sem pressão comercial; foto de ambiente, sem produto.', warnings: ['Direção degradada: nenhuma evidência comprovada de novidade — a variação evita afirmar que há novidades.'] },
  { direction: 'B', name: 'Reforço da marca', angle: 'Reforçar quem é a D\'Rosa', audience: 'Clientes sem comprar há 61–90 dias', productId: null,
    subject: 'Um pouco sobre quem faz a D\'Rosa', preheader: 'Bastidores de uma marca feita com carinho',
    headline: 'Nosso jeito de fazer moda',
    body: 'Somos uma marca pensada com carinho para mulheres reais, e cada detalhe é escolhido pelo nosso time com muito cuidado.\nQueremos que você se sinta bem em cada ocasião da sua rotina, sem exageros e sem modismos passageiros.',
    cta: 'Ver nossa história', creativeBrief: 'Institucional caloroso.', warnings: [] },
  { direction: 'C', name: 'Conversa com a equipe', angle: 'Abrir uma conversa sobre o que a cliente procura', audience: 'Clientes sem comprar há 61–90 dias', productId: null,
    subject: 'Podemos ajudar você a escolher?', preheader: 'Conte o que procura e a equipe responde',
    headline: 'Conte o que você procura',
    body: 'Conte para nós o que você procura ultimamente e a equipe responde com atenção, ajudando a encontrar exatamente o que faz sentido para o seu momento e o seu estilo pessoal de vestir. Última chance de participar? Não — aqui não existe pressa.',
    cta: 'Falar com a equipe', creativeBrief: 'Pergunta direta e empática.', warnings: [] },
]
const complianceFindings = compliance.auditAllStrategies(strategies, [null, null, null])
const distanceFindings = distance.evaluateCreativeDistance(strategies)
const withStatus = strategies.map((s, index) => {
  const own = complianceFindings.filter((f: { strategyIndex: number }) => f.strategyIndex === index)
  return { ...s, status: own.length ? 'BLOCKED' : 'OK', findings: own, qualityRubric: rubric.evaluateStrategyQuality(s, { product: null, complianceFindings, distanceFindings, strategyIndex: index }) }
})
const draft = {
  id: 'cmuharness0001', opportunityId: 'opp_email_lapsed_61_90d_' + NOW.toISOString().slice(0, 10), opportunityType: 'EMAIL_LAPSED_61_90',
  opportunityTitle: '2431 clientes: Sem comprar há 61–90 dias', channel: 'EMAIL', status: 'AWAITING_HUMAN_APPROVAL', strategies: withStatus, complianceFindings,
  audienceSnapshot: { channel: 'email', segmentKey: 'LAPSED_61_90D', segmentName: 'Sem comprar há 61–90 dias', campaignKey: 'WINBACK_61_90', campaignName: 'Reativação: novidades desde a última compra', audienceCount: 2431, withValidEmailCount: 2431, sendEligibleCount: null, eligibilityStatus: 'EMAIL_CONSENT_SOURCE_NOT_CONFIGURED' },
  selectedStrategy: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
}
const whatsappDraft = { id: 'cmuharness0002', opportunityType: 'RECENT_CUSTOMER', opportunityTitle: '10 clientes recentes', channel: 'WHATSAPP', status: 'AWAITING_HUMAN_APPROVAL', strategies: [], complianceFindings: [], audienceSnapshot: {}, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }
const svc = campaignServiceModule.campaignService
svc.list = async () => [draft, whatsappDraft]
svc.createFromOpportunity = async (...args: unknown[]) => { console.log('[harness] createFromOpportunity', JSON.stringify(args)); return { id: draft.id, status: draft.status, strategies: withStatus, complianceFindings } }

// eslint-disable-next-line @typescript-eslint/no-var-requires
require(REPO + '/src/index')
console.log('[harness] pronto em http://localhost:3457/crm-v2  (segredo: harness-secret)')
