import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import vm from 'vm'

// public/crm-v2/app.js é JS puro de navegador (sem módulos, sem bundler) —
// não dá para `import` a função diretamente. Em vez de reimplementar a
// lógica no teste (o que poderia divergir silenciosamente do código real),
// extraímos o TRECHO REAL do arquivo por marcador de texto e o executamos
// num contexto vm isolado, com só as dependências globais que ele usa
// (crypto/apiPost/$/state/load/describeAiIssue/esc/ICONS) substituídas por
// stubs. Isso prova o comportamento do código que de fato roda no browser.
function loadIdempotencySnippet(): string {
  const source = fs.readFileSync(path.join(process.cwd(), 'public/crm-v2/app.js'), 'utf8')
  const startMarker = 'const pendingCampaignIdempotencyKeys = new Map()'
  const endMarker = '// ── ÁREA: CAMPANHAS & IA · ABA CAMPANHAS'
  const startIdx = source.indexOf(startMarker)
  const endIdx = source.indexOf(endMarker)
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error('generateCampaignFromOpportunity não encontrada em public/crm-v2/app.js na forma esperada — ajuste os marcadores deste teste se o arquivo mudou de estrutura')
  }
  return source.slice(startIdx, endIdx)
}

function makeSandbox(overrides: Record<string, unknown> = {}) {
  let uuidCounter = 0
  const context = vm.createContext({
    crypto: { randomUUID: vi.fn(() => `uuid-${++uuidCounter}`) },
    apiPost: vi.fn(),
    $: vi.fn(() => null),
    state: {},
    load: vi.fn(),
    describeAiIssue: vi.fn(() => ({ title: 'Erro', body: 'Falhou' })),
    esc: (s: string) => s,
    ICONS: { alert: '!' },
    ...overrides,
  })
  vm.runInContext(loadIdempotencySnippet(), context)
  return context
}

function callGenerate(context: vm.Context, opportunityId: string, btn: { textContent: string; disabled: boolean }) {
  context.__opportunityId = opportunityId
  context.__btn = btn
  return vm.runInContext('generateCampaignFromOpportunity(__opportunityId, __btn)', context)
}

describe('public/crm-v2/app.js — idempotencyKey por ação humana (Activation Wiring v2, seção 1)', () => {
  // A) frontend envia idempotencyKey
  it('A) gera a idempotencyKey via crypto.randomUUID() e a envia junto com opportunityId', async () => {
    const apiPost = vi.fn().mockResolvedValue({ id: 'draft_1' })
    const context = makeSandbox({ apiPost })
    const btn = { textContent: 'Gerar campanha', disabled: false }

    await callGenerate(context, 'opp1', btn)

    expect((context.crypto as { randomUUID: ReturnType<typeof vi.fn> }).randomUUID).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('ai/campaigns', { opportunityId: 'opp1', idempotencyKey: 'uuid-1' })
  })

  // B) retry reutiliza a mesma key
  it('B) um retry após falha (mesma oportunidade, sem sucesso anterior) reusa a MESMA idempotencyKey', async () => {
    const apiPost = vi.fn()
      .mockRejectedValueOnce(new Error('falha de rede'))
      .mockResolvedValueOnce({ id: 'draft_1' })
    const context = makeSandbox({ apiPost })
    const btn = { textContent: 'Gerar campanha', disabled: false }

    await callGenerate(context, 'opp1', btn) // 1ª tentativa: falha
    await callGenerate(context, 'opp1', btn) // retry da MESMA ação humana

    expect((context.crypto as { randomUUID: ReturnType<typeof vi.fn> }).randomUUID).toHaveBeenCalledTimes(1)
    expect(apiPost.mock.calls[0][1]).toEqual({ opportunityId: 'opp1', idempotencyKey: 'uuid-1' })
    expect(apiPost.mock.calls[1][1]).toEqual({ opportunityId: 'opp1', idempotencyKey: 'uuid-1' })
  })

  // C) novo clique deliberado gera nova key
  it('C) um novo clique deliberado, depois de um sucesso anterior para a mesma oportunidade, gera uma NOVA idempotencyKey', async () => {
    const apiPost = vi.fn().mockResolvedValue({ id: 'draft_1' })
    const context = makeSandbox({ apiPost })
    const btn = { textContent: 'Gerar campanha', disabled: false }

    await callGenerate(context, 'opp1', btn) // sucesso — key é descartada
    await callGenerate(context, 'opp1', btn) // novo clique deliberado

    expect((context.crypto as { randomUUID: ReturnType<typeof vi.fn> }).randomUUID).toHaveBeenCalledTimes(2)
    expect(apiPost.mock.calls[0][1].idempotencyKey).not.toBe(apiPost.mock.calls[1][1].idempotencyKey)
  })

  it('oportunidades diferentes sempre recebem keys diferentes, mesmo na mesma leva de cliques', async () => {
    const apiPost = vi.fn().mockResolvedValue({ id: 'draft_1' })
    const context = makeSandbox({ apiPost })

    await callGenerate(context, 'opp1', { textContent: 'x', disabled: false })
    await callGenerate(context, 'opp2', { textContent: 'x', disabled: false })

    expect(apiPost.mock.calls[0][1].idempotencyKey).not.toBe(apiPost.mock.calls[1][1].idempotencyKey)
  })

  // E-mail: a "ação humana" é oportunidade + campanha. O corpo de WhatsApp (sem campaignKey)
  // continua EXATAMENTE { opportunityId, idempotencyKey } — cravado no teste A acima.
  describe('campanha de e-mail (campaignKey)', () => {
    const callGenerateEmail = (context: vm.Context, opportunityId: string, campaignKey: string, btn = { textContent: 'Gerar', disabled: false }) => {
      context.__o = opportunityId; context.__c = campaignKey; context.__b = btn
      return vm.runInContext('generateCampaignFromOpportunity(__o, __b, __c, "err-el")', context)
    }

    it('envia campaignKey junto com opportunityId e uma idempotencyKey gerada por crypto.randomUUID()', async () => {
      const apiPost = vi.fn().mockResolvedValue({ id: 'draft_1' })
      const context = makeSandbox({ apiPost })
      await callGenerateEmail(context, 'opp_email_lapsed_61_90d_2026-09-19', 'WINBACK_61_90')
      expect(apiPost).toHaveBeenCalledWith('ai/campaigns', { opportunityId: 'opp_email_lapsed_61_90d_2026-09-19', idempotencyKey: 'uuid-1', campaignKey: 'WINBACK_61_90' })
    })

    it('duas campanhas DIFERENTES para o mesmo segmento são ações diferentes: nunca compartilham a idempotencyKey', async () => {
      const apiPost = vi.fn().mockResolvedValue({ id: 'draft_1' })
      const context = makeSandbox({ apiPost })
      await callGenerateEmail(context, 'opp_email_lapsed_61_90d_2026-09-19', 'WINBACK_61_90')
      await callGenerateEmail(context, 'opp_email_lapsed_61_90d_2026-09-19', 'CATALOG_DISCOVERY')
      expect(apiPost.mock.calls[0][1].idempotencyKey).not.toBe(apiPost.mock.calls[1][1].idempotencyKey)
    })

    it('retry da MESMA campanha após falha reusa a MESMA key (nunca chama a IA duas vezes pela mesma ação)', async () => {
      const apiPost = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ id: 'draft_1' })
      const context = makeSandbox({ apiPost })
      await callGenerateEmail(context, 'opp_email_lapsed_61_90d_2026-09-19', 'WINBACK_61_90')
      await callGenerateEmail(context, 'opp_email_lapsed_61_90d_2026-09-19', 'WINBACK_61_90')
      expect((context.crypto as { randomUUID: ReturnType<typeof vi.fn> }).randomUUID).toHaveBeenCalledTimes(1)
      expect(apiPost.mock.calls[1][1].idempotencyKey).toBe(apiPost.mock.calls[0][1].idempotencyKey)
    })

    it('depois de um sucesso, um novo clique deliberado na mesma campanha gera uma NOVA key', async () => {
      const apiPost = vi.fn().mockResolvedValue({ id: 'draft_1' })
      const context = makeSandbox({ apiPost })
      await callGenerateEmail(context, 'opp_email_lapsed_61_90d_2026-09-19', 'WINBACK_61_90')
      await callGenerateEmail(context, 'opp_email_lapsed_61_90d_2026-09-19', 'WINBACK_61_90')
      expect(apiPost.mock.calls[0][1].idempotencyKey).not.toBe(apiPost.mock.calls[1][1].idempotencyKey)
    })

    it('o erro é exibido no elemento indicado (errorElementId), não em um id derivado só da oportunidade', async () => {
      const apiPost = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { payloadCode: 'EMAIL_CAMPAIGN_NEEDS_DATA' }))
      const errEl = { innerHTML: '' }
      const dollar = vi.fn((id: string) => (id === 'err-el' ? errEl : null))
      const context = makeSandbox({ apiPost, $: dollar })
      const btn = { textContent: 'Gerar campanha', disabled: false }
      await callGenerateEmail(context, 'opp_email_x_2026-09-19', 'WINBACK_61_90', btn)
      expect(dollar).toHaveBeenCalledWith('err-el')
      expect(errEl.innerHTML).toContain('ai-banner')
      expect(btn.disabled).toBe(false) // pode tentar de novo
    })
  })

  // Escopado ao TRECHO da idempotencyKey, não ao arquivo inteiro — app.js usa
  // sessionStorage em outro lugar (a conexão x-crm-read-secret, um recurso
  // não relacionado e pré-existente), então uma checagem no arquivo inteiro
  // pegaria esse uso legítimo e não provaria nada sobre a idempotencyKey.
  it('a key é mantida só em memória — o trecho de idempotencyKey nunca referencia localStorage/sessionStorage', () => {
    const snippet = loadIdempotencySnippet()
    expect(snippet).not.toMatch(/localStorage|sessionStorage/)
  })
})
