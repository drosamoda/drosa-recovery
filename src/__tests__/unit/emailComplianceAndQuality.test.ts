import { describe, expect, it } from 'vitest'
import { EmailStrategy, WhatsappStrategy } from '../../services/ai/aiProvider'
import { auditAllStrategies, auditClaimCategories, auditEmailClaims, auditStrategy } from '../../services/ai/complianceService'
import { evaluateCreativeDistance } from '../../services/ai/strategyDistanceService'
import { evaluateStrategyQuality } from '../../services/ai/strategyQualityRubric'
import type { ProductTruth } from '../../services/productTruthService'

const noEvidence = { hasCandidateProducts: false, hasCategoryEvidence: false, hasStockEvidence: false, hasNewnessEvidence: false, hasPaymentExpiryEvidence: false, hasSecondCopySupport: false, hasPromotionEvidence: false, hasRecoveryUrlEvidence: false }

function email(overrides: Partial<EmailStrategy> = {}): EmailStrategy {
  return {
    direction: 'A', name: 'Reconexão', angle: 'Reabrir o contato com leveza', audience: 'Clientes sem comprar há 61–90 dias', productId: null,
    subject: 'Sentimos a sua falta na D\'Rosa',
    preheader: 'Passe por aqui quando tiver um tempinho para ver o catálogo',
    headline: 'Que bom ter você por perto',
    body: 'Olá! Faz um tempinho que não nos falamos e queríamos dizer que estamos por aqui. Se quiser conhecer o catálogo atual, ele está a um clique. Nosso time também pode ajudar você a encontrar peças que combinem com o seu jeito, sem pressa e sem compromisso.',
    cta: 'Conhecer o catálogo', creativeBrief: 'Tom acolhedor e sem pressão comercial.', warnings: [], ...overrides,
  }
}

const product = (description: string): ProductTruth => ({
  productId: 'p1', name: 'Vestido', url: 'https://x.test/p1', image: null, price: 100, compareAtPrice: null, variants: 1, colors: [], sizes: [], stockStatus: 'in_stock', description, updatedAt: '2026-01-01',
})

describe('compliance de e-mail — e-mail NÃO ganha exceção', () => {
  it('um e-mail limpo passa sem nenhum achado', () => {
    expect(auditStrategy(email(), 0, null)).toEqual([])
  })

  it.each([
    ['subject', 'Última chance de conferir!'],
    ['subject', 'Só hoje: veja o catálogo'],
    ['subject', 'Corra para ver as peças'],
    ['preheader', 'Imperdível: não perca esta seleção'],
    ['headline', 'Ganhe um look novo'],
    ['body', 'Passe aqui e leve um brinde na sua próxima compra.'],
    ['body', 'Peças grátis para quem abrir este e-mail.'],
    ['body', 'Você terá acesso antecipado às peças.'],
    ['subject', 'As queridinhas da semana chegaram'],
    ['body', 'Os mais procurados estão aqui.'],
    ['body', 'Aproveite o desconto especial de hoje.'],
    ['body', 'Cupom exclusivo para você.'],
    ['body', 'Frete grátis nesta semana.'],
    ['body', 'Restam as últimas unidades.'],
    ['cta', 'Aproveite a oferta'],
  ])('bloqueia alegação inventada no campo %s: "%s"', (field, text) => {
    const findings = auditStrategy(email({ [field]: text } as Partial<EmailStrategy>), 0, null)
    expect(findings.length, text).toBeGreaterThan(0)
  })

  it('bloqueia "novidade" sem prova: novidades da semana / acabou de chegar / nova coleção', () => {
    for (const text of ['Veja as novidades da semana.', 'Acabou de chegar algo para você.', 'Conheça a nova coleção.']) {
      const strategy = email({ body: text })
      const findings = auditClaimCategories(strategy, 0, 'EMAIL_LAPSED_61_90', noEvidence)
      expect(findings.some(f => f.claim === 'newness'), text).toBe(true)
      // com evidência de novidade comprovada, a mesma frase é liberada
      expect(auditClaimCategories(strategy, 0, 'EMAIL_LAPSED_61_90', { ...noEvidence, hasNewnessEvidence: true }).some(f => f.claim === 'newness')).toBe(false)
    }
  })

  it('a alegação só passa se o termo estiver literalmente na descrição REAL do produto (Product Truth)', () => {
    const strategy = email({ body: 'Conheça a peça, que vem com um brinde cortesia da casa.' })
    expect(auditEmailClaims(strategy, 0, null).map(f => f.claim)).toContain('brinde')
    expect(auditEmailClaims(strategy, 0, product('Vestido midi. Acompanha brinde cortesia.')).map(f => f.claim)).not.toContain('brinde')
  })

  it('limite de palavra inteira: "corrida", "apresente", "brindar", "ganhei" NÃO geram falso positivo', () => {
    const findings = auditEmailClaims(email({ body: 'Apresente-se sem correria, uma corrida leve e o brindar de um novo começo; ganhei muito com isso.' }), 0, null)
    expect(findings).toEqual([])
  })

  it('o nome da marca (D\'Rosa) NÃO é a cor rosa; "rosa" sozinho continua sendo cor auditada', () => {
    expect(auditStrategy(email({ subject: "Novidade na D'Rosa? Não: só um oi da D’Rosa", body: 'Aqui na D Rosa e na DRosa cuidamos de você.' }), 0, null).filter(f => f.claim === 'rosa')).toEqual([])
    expect(auditStrategy(email({ body: 'Uma peça rosa para o verão.' }), 0, null).some(f => f.claim === 'rosa')).toBe(true)
    const whatsapp: WhatsappStrategy = { direction: 'A', name: 'x', angle: 'x', audience: 'x', productId: null, message: "Olá, aqui é da D'Rosa!", cta: 'Ver', creativeBrief: 'x', warnings: [] }
    expect(auditStrategy(whatsapp, 0, null).some(f => f.claim === 'rosa')).toBe(false)
  })

  it('claims de WhatsApp continuam iguais: estratégia de WhatsApp não passa pelas regras exclusivas de e-mail', () => {
    const whatsapp: WhatsappStrategy = { direction: 'A', name: 'x', angle: 'x', audience: 'x', productId: null, message: 'Passe aqui, última chance.', cta: 'Ver', creativeBrief: 'x', warnings: [] }
    expect(auditEmailClaims(whatsapp as unknown as EmailStrategy, 0, null)).toEqual([])
  })

  it('auditAllStrategies aplica o mesmo auditor às 3 estratégias e indexa o achado na estratégia certa', () => {
    const findings = auditAllStrategies([email(), email({ direction: 'B', subject: 'Última chance!' }), email({ direction: 'C' })], [null, null, null])
    expect(findings.every(f => f.strategyIndex === 1)).toBe(true)
    expect(findings.length).toBeGreaterThan(0)
  })

  it('productId citado e não confirmado pela Nuvemshop também bloqueia e-mail', () => {
    expect(auditStrategy(email({ productId: 'inexistente' }), 0, null).some(f => f.reason.includes('Product Truth'))).toBe(true)
  })
})

describe('rubrica de qualidade de e-mail', () => {
  const ctx = (overrides = {}) => ({ product: null, complianceFindings: [], distanceFindings: [], strategyIndex: 0, ...overrides })
  const score = (results: ReturnType<typeof evaluateStrategyQuality>, criterion: string) => results.find(r => r.criterion === criterion)!

  it('e-mail tem critérios próprios (assunto, preheader, adequação) e NÃO tem o critério de WhatsApp', () => {
    const results = evaluateStrategyQuality(email(), ctx())
    const names = results.map(r => r.criterion)
    expect(names).toEqual(expect.arrayContaining(['Evidence adherence', 'Product Truth', 'Compliance', 'Specificity', 'Strategic differentiation', 'CTA clarity', 'Email subject', 'Email preheader', 'Email suitability', 'Brand fit']))
    expect(names).not.toContain('WhatsApp suitability')
    for (const r of results) expect([0, 1, 2]).toContain(r.score)
  })

  it('um e-mail bem escrito pontua 2 em assunto, preheader, CTA e adequação', () => {
    const results = evaluateStrategyQuality(email(), ctx())
    for (const c of ['Email subject', 'Email preheader', 'CTA clarity', 'Email suitability', 'Compliance', 'Product Truth']) expect(score(results, c).score, c).toBe(2)
  })

  it('assunto longo, gritado ou com várias exclamações perde pontos', () => {
    expect(score(evaluateStrategyQuality(email({ subject: 'Conheça agora o catálogo completo e atualizado da D\'Rosa para a nova estação' }), ctx()), 'Email subject').score).toBe(1)
    expect(score(evaluateStrategyQuality(email({ subject: 'CONFIRA O CATÁLOGO AGORA' }), ctx()), 'Email subject').score).toBe(1)
    expect(score(evaluateStrategyQuality(email({ subject: 'Olá!! Veja!!!' }), ctx()), 'Email subject').score).toBe(1)
    expect(score(evaluateStrategyQuality(email({ subject: 'x'.repeat(120) }), ctx()), 'Email subject').score).toBe(0)
  })

  it('preheader que só repete o assunto (ou está contido nele) recebe 0', () => {
    expect(score(evaluateStrategyQuality(email({ subject: 'Sentimos a sua falta', preheader: 'Sentimos a sua falta' }), ctx()), 'Email preheader').score).toBe(0)
    expect(score(evaluateStrategyQuality(email({ subject: 'Sentimos a sua falta na loja', preheader: 'sentimos a sua falta' }), ctx()), 'Email preheader').score).toBe(0)
  })

  it('corpo curto demais ou longo demais não é "adequado" para e-mail', () => {
    expect(score(evaluateStrategyQuality(email({ body: 'Oi, tudo bem?' }), ctx()), 'Email suitability').score).toBe(0)
    expect(score(evaluateStrategyQuality(email({ body: 'palavra '.repeat(500) }), ctx()), 'Email suitability').score).toBe(0)
  })

  it('achado de compliance derruba Compliance e Brand fit; CTA longo demais perde pontos', () => {
    const findings = [{ strategyIndex: 0, claim: 'brinde', reason: 'x' }]
    const results = evaluateStrategyQuality(email({ cta: 'Clique aqui agora mesmo para conhecer todo o catálogo' }), ctx({ complianceFindings: findings }))
    expect(score(results, 'Compliance').score).toBe(0)
    expect(score(results, 'Brand fit').score).toBe(1)
    expect(score(results, 'CTA clarity').score).toBe(1)
  })

  it('rubrica de WhatsApp continua com os 8 critérios de antes', () => {
    const whatsapp: WhatsappStrategy = { direction: 'A', name: 'x', angle: 'x', audience: 'x', productId: null, message: 'Uma mensagem real de WhatsApp com conteúdo suficiente.', cta: 'Ver', creativeBrief: 'x', warnings: [] }
    const names = evaluateStrategyQuality(whatsapp, ctx()).map(r => r.criterion)
    expect(names).toEqual(['Evidence adherence', 'Product Truth', 'Compliance', 'Specificity', 'Strategic differentiation', 'CTA clarity', 'WhatsApp suitability', 'Brand fit'])
  })
})

describe('distância criativa de e-mail (A/B/C precisam ser estratégias diferentes)', () => {
  it('três e-mails realmente diferentes não colidem', () => {
    const a = email()
    const b = email({ direction: 'B', angle: 'Ouvir a cliente sobre a última experiência', cta: 'Responder este e-mail', creativeBrief: 'Pergunta direta e empática.', subject: 'Como foi a sua última compra?', preheader: 'Queremos ouvir você', headline: 'Sua opinião importa', body: 'Gostaríamos de saber como foi a sua experiência e o que podemos melhorar. Responda este e-mail com sinceridade; ler cada resposta é a parte favorita da nossa semana e ajuda toda a equipe.' })
    const c = email({ direction: 'C', angle: 'Apresentar a marca e seus valores', cta: 'Ver a história da marca', creativeBrief: 'Tom institucional caloroso.', subject: 'Um pouco sobre quem faz a D\'Rosa', preheader: 'Bastidores e valores', headline: 'Nosso jeito de fazer moda', body: 'Somos uma marca pensada com carinho para mulheres reais. Cada detalhe é cuidadosamente escolhido pelo nosso time. Queremos que você se sinta bem em cada ocasião, sem exageros e sem modismos passageiros.' })
    expect(evaluateCreativeDistance([a, b, c])).toEqual([])
  })

  it('o MESMO e-mail com pequenas trocas (assunto/corpo quase idênticos) colide', () => {
    const a = email()
    const b = email({ direction: 'B', name: 'Outro', subject: 'Sentimos a sua falta na D\'Rosa!', headline: 'Que bom ter você por perto!' })
    const findings = evaluateCreativeDistance([a, b, email({ direction: 'C', angle: 'Totalmente outro ângulo', cta: 'Falar com a equipe', creativeBrief: 'Pergunta sobre preferências', body: 'Conte para a gente o que você procura ultimamente; a equipe responde com atenção e ajuda a encontrar exatamente o que faz sentido para você agora.' })])
    expect(findings.some(f => f.strategyIndexA === 0 && f.strategyIndexB === 1)).toBe(true)
  })
})
