import { beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import vm from 'vm'
import request from 'supertest'
import { env } from '../../config/env'

// A aba E-mail é JS puro de navegador. Em vez de reimplementar a renderização no teste, executamos o
// TRECHO REAL de public/crm-v2/app.js num vm isolado, alimentado com o JSON REAL que as rotas
// /crm-api/email/* devolvem (mesmo motor de audiência, mesma biblioteca, mesmo ranking) — um teste
// de contrato backend → UI. Nenhum banco, IA ou rede real.
const mocks = vi.hoisted(() => ({ getSnapshot: vi.fn() }))
vi.mock('../../services/emailAudienceEngine', async () => {
  const actual = await vi.importActual<typeof import('../../services/emailAudienceEngine')>('../../services/emailAudienceEngine')
  return { ...actual, getEmailAudienceSnapshot: mocks.getSnapshot }
})

import { EmailBaseQuality, EmailIdentityRow, buildEmailAudienceSnapshot } from '../../services/emailAudienceEngine'

const NOW = new Date('2026-09-19T12:00:00.000Z')
const DAY = 86_400_000
const QUALITY: EmailBaseQuality = { totalCustomers: 60000, customersWithoutEmail: 10000, paidOrders: 45000, paidOrdersWithoutEmail: 1000, paidOrdersWithoutDate: 400 }
const base = { validEmail: true, paidOrderCount: 0, paidTotal: 0, lastPaidAt: null, undatedPaidOrders: 0, recentAbandonedCart: false, whatsappOptOut: false }
const rows: EmailIdentityRow[] = []
const add = (n: number, make: () => EmailIdentityRow) => { for (let i = 0; i < n; i++) rows.push(make()) }
const buyer = (age: number, extra: Partial<EmailIdentityRow> = {}): EmailIdentityRow => ({ ...base, paidOrderCount: 1, paidTotal: 100, lastPaidAt: new Date(NOW.getTime() - age * DAY), ...extra })
add(120, () => buyer(10)); add(90, () => buyer(45)); add(60, () => buyer(75)); add(50, () => buyer(120, { whatsappOptOut: true })); add(40, () => buyer(250)); add(30, () => buyer(500))
add(20, () => ({ ...base, paidOrderCount: 2, paidTotal: 200, lastPaidAt: new Date(NOW.getTime() - 20 * DAY) }))
add(8, () => ({ ...base, paidOrderCount: 4, paidTotal: 900, lastPaidAt: new Date(NOW.getTime() - 20 * DAY) }))
add(70, () => ({ ...base })); add(6, () => ({ ...base, recentAbandonedCart: true })); add(5, () => ({ ...base, validEmail: false }))
const snapshot = buildEmailAudienceSnapshot(rows, QUALITY, NOW)

const source = fs.readFileSync(path.join(process.cwd(), 'public/crm-v2/app.js'), 'utf8')
function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  if (start === -1 || end === -1 || end <= start) throw new Error(`marcadores não encontrados em app.js: ${startMarker} → ${endMarker}`)
  return source.slice(start, end)
}

const constantsSnippet = between('// ── Humanização', '// ── Helpers ─')
const helpersSnippet = between('// ── Helpers ─', '// ── Estado + autenticação')
// ABA CAMPANHAS (detalhe/estratégia/ação) + ABA E-MAIL, exatamente como estão em app.js.
const campaignsAndEmailSnippet = between('// ── ÁREA: CAMPANHAS & IA · ABA CAMPANHAS', '// ── ÁREA: CAMPANHAS & IA · ABA APRENDIZADOS')
const emailSnippet = between('// ── ÁREA: CAMPANHAS & IA · ABA E-MAIL', '// ── ÁREA: CAMPANHAS & IA · ABA APRENDIZADOS')

interface SegmentJson { segmentKey: string; audienceCount: number | null }
interface AudiencesJson { segments: SegmentJson[] }
interface CampaignJson { key: string; category: string; allowedSegments: Array<{ key: string }> }
interface LibraryJson { total: number; data: CampaignJson[] }
interface RecommendationsJson { plan: unknown[] }

let ui: vm.Context
let audiences: AudiencesJson
let recommendations: RecommendationsJson
let library: LibraryJson

// Toda função de render de app.js devolve uma string de HTML (ou o texto de num()).
function run(expr: string): string { return vm.runInContext(expr, ui) as string }

beforeAll(async () => {
  mocks.getSnapshot.mockResolvedValue(snapshot)
  const { default: app } = await import('../../index')
  const headers = { 'x-crm-read-secret': env.CRM_READ_SECRET }
  audiences = (await request(app).get('/crm-api/email/audiences').set(headers)).body
  recommendations = (await request(app).get('/crm-api/email/recommendations').set(headers)).body
  library = (await request(app).get('/crm-api/email/campaign-library').set(headers)).body
  ui = vm.createContext({
    document: { getElementById: () => null, querySelectorAll: () => [] },
    ICONS: { alert: '!', checkouts: 'x', check: 'v' },
    state: { selectedStrategy: {} }, renderGen: 1, api: vi.fn(), generateCampaignFromOpportunity: vi.fn(), console,
  })
  vm.runInContext([constantsSnippet, helpersSnippet, campaignsAndEmailSnippet].join('\n'), ui)
  ui.__audiences = audiences; ui.__recs = recommendations; ui.__lib = library
})

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()

describe('aba E-mail — contrato real backend → UI', () => {
  it('as três rotas devolvem o que a UI consome', () => {
    expect(audiences.segments.length).toBeGreaterThan(10)
    expect(recommendations.plan.length).toBeGreaterThan(0)
    expect(library.total).toBeGreaterThanOrEqual(30)
  })

  it('a navegação tem a aba E-mail dentro de Campanhas & IA e o registro da área', () => {
    expect(source).toMatch(/\['opportunities', 'Oportunidades'\], \['email', 'E-mail'\], \['campaigns', 'Campanhas'\]/)
    expect(source).toMatch(/email: renderEmailArea,/)
    expect(source).toMatch(/api\('email\/audiences'/)
    expect(source).toMatch(/api\('email\/recommendations'/)
    expect(source).toMatch(/api\('email\/campaign-library'/)
  })

  describe('bloco 1 — Visão da base', () => {
    it('mostra os 11 cards pedidos com números reais do backend', () => {
      const html = run('emailBaseBlock(__audiences)')
      const t = text(html)
      for (const label of ['Base com e-mail', 'Comprou 1 vez', 'Comprou 2+ vezes', 'VIP', '0–30 dias', '31–60 dias', '61–90 dias', '91–180 dias', '181–365 dias', '365+ dias', 'Nunca comprou']) expect(t).toContain(label)
      expect((html.match(/email-metric/g) ?? []).length).toBeGreaterThanOrEqual(11)
      const all = audiences.segments.find((s: SegmentJson) => s.segmentKey === 'ALL_EMAIL_CUSTOMERS')
      expect(t).toContain(run(`num(${all?.audienceCount})`))
      expect(t).toContain('Buckets de última compra sem sobreposição')
    })

    it('nunca apresenta um número de "prontos/elegíveis para enviar"', () => {
      const t = text(run('emailBaseBlock(__audiences)') + run('emailSegmentsBlock(__audiences, __lib)') + run('emailNowBlock(__recs)'))
      expect(t).not.toMatch(/elegíveis para envio|prontos para enviar|prontos para receber/i)
      expect(t).toContain('Elegibilidade')
    })

    it('dado ausente aparece como — e nunca como 0 inventado', () => {
      const withNull = JSON.parse(JSON.stringify(audiences))
      withNull.segments.find((s: SegmentJson) => s.segmentKey === 'VIP_CUSTOMERS').audienceCount = null
      ui.__nullAud = withNull
      const html = run('emailBaseBlock(__nullAud)')
      const vipCard = html.split('email-metric').find((c: string) => c.includes('>VIP<'))!
      expect(vipCard).toContain('>—<')
    })
  })

  describe('bloco 2 — Segmentos', () => {
    it('mostra segmento, clientes, última compra, objetivo, status dos dados e campanhas disponíveis com "Ver campanhas"', () => {
      const html = run('emailSegmentsBlock(__audiences, __lib)')
      const t = text(html)
      expect(t).toContain('Comprou 1 vez')
      expect(t).toContain('Objetivo: Gerar a segunda compra')
      expect(t).toContain('campanha(s)')
      expect(html).toContain('data-seg-campaigns="ONE_TIME_BUYERS"')
      expect(t).toContain('Última compra 61–90 dias')
      expect(t).toMatch(/Dados (completos|parciais)/)
    })

    it('segmentos NEEDS_DATA mostram — e a explicação, nunca 0', () => {
      const html = run('emailSegmentsBlock(__audiences, __lib)')
      for (const name of ['Afinidade de categoria', 'Engajou por e-mail e não comprou', 'Navegou e não comprou']) {
        const card = html.split('class="email-seg ').find((c: string) => c.includes(name))!
        expect(card, name).toContain('needs-data')
        expect(card).toContain('NEEDS_DATA')
        expect(text(card)).toContain('Dados necessários ainda não são coletados')
        expect(card).toContain('email-seg-n">—')
      }
    })

    it('opt-out de WhatsApp é tratado como revisão humana, nunca como opt-out de e-mail', () => {
      const t = text(run('emailSegmentsBlock(__audiences, __lib)'))
      expect(t).toContain('não é opt-out de e-mail')
    })
  })

  describe('bloco 3 — O que fazer agora', () => {
    it('lista o plano determinístico: carrinho primeiro, no máximo 8, com "Gerar com IA" ligado à campanha e à oportunidade', () => {
      const html = run('emailNowBlock(__recs)')
      expect((html.match(/class="email-rec"/g) ?? []).length).toBe(Math.min(8, recommendations.plan.length))
      const first = html.split('class="email-rec"')[1]
      expect(text(first)).toContain('Recuperação de carrinho por e-mail')
      expect(first).toContain('data-campaign="CART_RECOVERY_EMAIL"')
      expect(first).toMatch(/data-opp="opp_email_recent_cart_abandoner_2026-09-19"/)
      expect(text(first)).toContain('Motivo:')
      expect(text(first)).toContain('Prioridade 2')
      expect(text(first)).toContain('Cooldown')
      expect(text(first)).toContain('não aplicável')
      expect(html).toContain('Gerar com IA')
    })

    it('a mesma campanha nunca aparece duas vezes e alternativas do mesmo público são sinalizadas', () => {
      const html = run('emailNowBlock(__recs)')
      const campaigns = [...html.matchAll(/data-campaign="([A-Z0-9_]+)"/g)].map(m => m[1])
      expect(new Set(campaigns).size).toBe(campaigns.length)
      expect(html).toContain('Alternativa a')
    })

    it('campanhas que dependem de dados inexistentes ficam separadas, com o dado que falta', () => {
      const html = run('emailNowBlock(__recs)')
      expect(html).toContain('email-blocked')
      expect(text(html)).toContain('Prova de novidade')
      expect(text(html)).toContain('dependem de dados que o sistema ainda não coleta')
    })
  })

  describe('bloco 4 — Biblioteca de campanhas', () => {
    it('mostra as 33 campanhas com nome, objetivo, público, prioridade, cooldown, dados necessários e status', () => {
      const html = run('emailLibraryBlock(__lib, __recs, __audiences)')
      expect((html.match(/email-lib-card/g) ?? []).length).toBeGreaterThanOrEqual(library.total)
      const t = text(html)
      for (const f of ['Todas', 'Base geral', '1 compra', 'Recorrentes', 'VIP', 'Reativação', 'Sem compra', 'Comportamental']) expect(t).toContain(f)
      expect(t).toContain('PRONTA')
      expect(t).toContain('NEEDS_DATA')
      expect(t).toContain('SEND_ELIGIBILITY_UNVERIFIED')
      expect(t).toContain('Dados necessários')
      expect(t).toContain('Cooldown')
      expect(t).toContain('Prioridade')
    })

    it('campanha NEEDS_DATA tem o botão desabilitado e diz por quê; campanha pronta e acionável tem o botão liberado', () => {
      const html = run('emailLibraryBlock(__lib, __recs, __audiences)')
      const card = (name: string) => html.split('class="opp-card email-lib-card').find((c: string) => c.includes(name))!
      const newArrivals = card('Novidades da semana')
      expect(newArrivals).toMatch(/data-campaign="NEW_ARRIVALS"[^>]*disabled/)
      expect(text(newArrivals)).toContain('Depende de dados que o sistema ainda não coleta')
      expect(text(newArrivals)).toContain('Prova de novidade')
      const winback = card('Reativação: novidades desde a última compra')
      expect(winback).toMatch(/data-campaign="WINBACK_61_90"/)
      expect(winback).not.toMatch(/data-campaign="WINBACK_61_90"[^>]*disabled/)
    })

    it('filtro por categoria reduz a lista e o filtro por segmento vem do botão "Ver campanhas"', () => {
      run("emailUi.filter = 'VIP'; emailUi.segment = ''")
      const vip = run('emailLibraryBlock(__lib, __recs, __audiences)')
      expect((vip.match(/class="opp-card email-lib-card/g) ?? []).length).toBe(library.data.filter((c: CampaignJson) => c.category === 'VIP').length)
      run("emailUi.filter = 'ALL'; emailUi.segment = 'LAPSED_61_90D'")
      const seg = run('emailLibraryBlock(__lib, __recs, __audiences)')
      expect(seg).toContain('data-email-clear-seg')
      const expected = library.data.filter((c: CampaignJson) => c.allowedSegments.some(s => s.key === 'LAPSED_61_90D')).length
      expect((seg.match(/class="opp-card email-lib-card/g) ?? []).length).toBe(expected)
      run("emailUi.filter = 'ALL'; emailUi.segment = ''")
    })
  })

  describe('segurança de renderização', () => {
    it('todo texto vindo do backend é escapado (nome de campanha/segmento com HTML não executa)', () => {
      const evil = JSON.parse(JSON.stringify(library))
      evil.data[0].name = '<img src=x onerror=alert(1)>'
      evil.data[0].objective = '"><script>alert(2)</script>'
      ui.__evilLib = evil
      const html = run('emailLibraryBlock(__evilLib, __recs, __audiences)')
      expect(html).not.toContain('<img src=x')
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;img')
    })

    it('corpo do e-mail gerado é escapado e vira parágrafos', () => {
      ui.__body = 'Primeiro parágrafo.\n<script>alert(1)</script>\n\nSegundo.'
      const html = run('emailParagraphs(__body)')
      expect(html).not.toContain('<script>')
      expect((html.match(/<p>/g) ?? []).length).toBe(3)
      expect(run("emailParagraphs('')")).toContain('—')
    })

    it('a aba não guarda nada persistente nem chama fetch de escrita por conta própria', () => {
      expect(emailSnippet).not.toMatch(/localStorage|sessionStorage|fetch\(/)
      expect(emailSnippet).not.toMatch(/JSON\.stringify/)
    })
  })

  describe('detalhe da campanha de e-mail', () => {
    const emailStrategy = {
      direction: 'A', name: 'Reconexão', angle: 'Reabrir o contato', audience: 'Clientes 61–90 dias', productId: null, status: 'OK', findings: [],
      subject: 'Sentimos a sua falta', preheader: 'Passe quando puder', headline: 'Que bom ter você', body: 'Linha um.\nLinha dois.', cta: 'Conhecer o catálogo', creativeBrief: 'Tom acolhedor.', warnings: ['Direção degradada: sem novidade comprovada.'],
      qualityRubric: [{ criterion: 'Product Truth', score: 2, notes: 'ok' }, { criterion: 'Compliance', score: 2, notes: 'ok' }, { criterion: 'Email subject', score: 1, notes: 'longo' }],
    }

    it('estratégia de e-mail mostra assunto, preheader, headline, corpo, CTA, brief, warnings e as verificações', () => {
      ui.__strategy = emailStrategy
      const html = run("renderStrategyCard('draft_1', __strategy, 0)")
      const t = text(html)
      for (const label of ['Assunto', 'Preheader', 'Headline', 'Corpo do e-mail', 'CTA', 'Brief criativo']) expect(t).toContain(label)
      expect(t).toContain('Sentimos a sua falta')
      expect(t).toContain('Qualidade 5/6')
      expect(t).toContain('Product Truth: nenhum produto citado')
      expect(t).toContain('Compliance: sem alegações não comprovadas')
      expect(t).toContain('Direção degradada')
      expect(html).not.toContain('>Mensagem<')
      expect(html).toContain('data-select-strategy="0"')
    })

    it('estratégia de WhatsApp continua com o campo Mensagem', () => {
      ui.__wa = { direction: 'A', name: 'x', angle: 'a', audience: 'p', productId: null, status: 'OK', findings: [], message: 'Mensagem de WhatsApp', cta: 'Ver', creativeBrief: 'b', warnings: [], qualityRubric: [] }
      const html = run("renderStrategyCard('draft_1', __wa, 0)")
      expect(text(html)).toContain('Mensagem')
      expect(text(html)).toContain('Mensagem de WhatsApp')
      expect(html).not.toContain('Assunto')
    })

    it('estratégia bloqueada por compliance mostra o achado e desabilita a seleção', () => {
      ui.__blocked = { ...emailStrategy, status: 'BLOCKED', findings: [{ claim: 'ultima chance', reason: 'não comprovada' }] }
      const html = run("renderStrategyCard('d', __blocked, 0)")
      expect(html).toContain('Bloqueada')
      expect(text(html)).toContain('Compliance: 1 alegação(ões) bloqueada(s)')
      expect(html).toMatch(/data-select-strategy="0"[^>]*disabled/)
    })

    it('contexto da campanha de e-mail: canal, segmento, tamanho da audiência e elegibilidade não validada', () => {
      ui.__draft = { channel: 'EMAIL', audienceSnapshot: { segmentName: 'Sem comprar há 61–90 dias', audienceCount: 2431, campaignName: 'Reativação: novidades desde a última compra' } }
      const t = text(run('renderEmailCampaignContext(__draft)'))
      expect(t).toContain('E-mail')
      expect(t).toContain('Sem comprar há 61–90 dias')
      expect(t).toContain(text(run('num(2431)')) + ' clientes')
      expect(t).toContain('Ainda não validada')
    })

    it('draft de e-mail APROVADO nunca oferece "Agendar (modo simulado)": o botão é desabilitado e diz que o envio é indisponível', () => {
      const html = run("renderCampaignActionBlock({ id: 'd', status: 'APPROVED', channel: 'EMAIL' })")
      expect(html).toContain('envio de e-mail indisponível')
      expect(html).toMatch(/<button[^>]*disabled[^>]*>Agendar e-mail \(indisponível\)/)
      expect(html).not.toContain('id="scheduleBtn"')
      const whatsapp = run("renderCampaignActionBlock({ id: 'd', status: 'APPROVED', channel: 'WHATSAPP' })")
      expect(whatsapp).toContain('id="scheduleBtn"')
    })

    it('aprovação humana continua obrigatória para e-mail (AWAITING_HUMAN_APPROVAL)', () => {
      const html = run("renderCampaignActionBlock({ id: 'd', status: 'AWAITING_HUMAN_APPROVAL', channel: 'EMAIL' })")
      expect(html).toContain('A IA nunca aprova uma campanha por conta própria')
      expect(html).toContain('id="approveBtn"')
    })
  })
})
