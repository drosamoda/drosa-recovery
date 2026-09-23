import { Strategy, isEmailStrategy, strategyText } from './aiProvider'
import { ProductTruth } from '../productTruthService'
import { OpportunityType } from '../aiOpportunityEngine'
import { EvidenceFlags } from './strategyPlaybook'

// Claims que exigem comprovação explícita nos dados de produto antes de
// aparecer numa mensagem gerada pela IA. Bloqueio por padrão (fail-closed):
// a claim só passa se o termo aparecer literalmente na descrição real do
// produto (Product Truth) — nunca porque a IA "acha" que é verdade.
//
// Categorias cobertas (Strategy Lab v1): benefício corporal, escassez/estoque,
// prova social/desempenho, comercial (desconto/cupom/frete), lançamento/
// exclusividade e prazo. "Cor"/"tamanho" NÃO entram aqui — têm fonte
// estruturada mais confiável (product.colors/product.sizes) e são checados
// separadamente em auditAttributeClaims, para não bloquear uma cor real só
// porque o texto da descrição não repete a palavra. "Tecido" entra aqui:
// a Nuvemshop não expõe um campo estruturado de tecido, então só a descrição
// literal pode comprová-lo.
const GUARDED_CLAIMS = [
  // Benefício corporal / resultado não comprovado
  'premium', 'alfaiataria', 'emagrece', 'afina', 'modela', 'alongador',
  // Escassez / estoque
  'últimas unidades', 'ultimas unidades', 'estoque acabando', 'sem estoque',
  'reposição', 'reposicao', 'corre que acaba', 'por tempo limitado',
  'aproveite antes que acabe',
  // Prova social / desempenho
  'mais vendido', 'bestseller', 'best-seller', 'todo mundo está comprando',
  'todo mundo esta comprando', 'clientes aprovam', 'o mais pedido',
  // Comercial / promoção
  'desconto', 'cupom', 'promoção', 'promocao', 'frete grátis', 'frete gratis', 'oferta',
  // Lançamento / exclusividade
  'lançamento', 'lancamento', 'exclusivo', 'exclusividade',
  'edição limitada', 'edicao limitada',
  // Prazo (só é permitido quando literalmente comprovado no input/descrição)
  'vence em', 'vencimento', 'prazo de', 'expira em',
  // Tecido (sem campo estruturado na Nuvemshop — só a descrição comprova).
  // "lã"/"la" fica de fora de propósito: como substring simples ela bate
  // dentro de palavras comuns ("ela", "aquela", "pela"), gerando falso
  // positivo constante — um risco que os outros termos abaixo não têm.
  'algodão', 'algodao', 'linho', 'poliéster', 'poliester', 'viscose', 'seda',
  'jeans', 'malha', 'tricô', 'trico', 'couro',
]

// Cores em português comumente usadas em moda — comparadas contra
// product.colors (fonte estruturada real) em vez de contra texto livre, para
// não bloquear uma cor verdadeira só porque a descrição não repete a palavra.
const COLOR_TERMS = [
  'preto', 'preta', 'branco', 'branca', 'azul', 'vermelho', 'vermelha',
  'verde', 'amarelo', 'amarela', 'rosa', 'cinza', 'bege', 'marrom', 'roxo',
  'roxa', 'laranja', 'dourado', 'dourada', 'prateado', 'prateada', 'nude', 'vinho',
]

// Só tamanhos por letra (PP/P/M/G/GG/XG) — tamanhos numéricos (36, 38, 40...)
// não entram aqui de propósito: são tokens curtos demais e aparecem por
// coincidência em preço, quantidade etc., o que geraria falso positivo
// constante. Letra isolada com \b evita casar dentro de outra palavra.
const SIZE_TERMS = ['pp', 'p', 'm', 'g', 'gg', 'xg', 'xxg']

export type ComplianceFinding = { strategyIndex: number; claim: string; reason: string }

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Para WhatsApp strategyText() é exatamente `message` (mesma string de antes);
// para e-mail inclui assunto, preheader, headline e corpo — nenhum campo de
// e-mail escapa da auditoria.
// "D'Rosa" é o NOME DA MARCA, não a cor "rosa" — sem isto o auditor de cores
// bloqueava qualquer texto que citasse a própria marca (achado ao gerar e-mails,
// onde assunto e corpo citam a marca naturalmente). Só o nome da marca é
// neutralizado; "rosa" sozinho continua sendo cor e continua auditado.
const BRAND_NAME = /\bd\s?['’`´]?\s?rosa\b/g

function haystackOf(strategy: Strategy): string {
  return normalize(`${strategyText(strategy)} ${strategy.angle} ${strategy.creativeBrief} ${strategy.cta}`).replace(BRAND_NAME, ' a marca ')
}

// Alegações específicas do canal E-MAIL (assunto e corpo são o lugar clássico de
// urgência falsa e de spam). Mesma regra de todo o resto: bloqueio por padrão,
// só passa se o termo estiver literalmente na descrição real do produto.
// Comparação por palavra inteira (\b) para não bater dentro de outras palavras.
const EMAIL_GUARDED_CLAIMS: Array<{ term: string; category: string }> = [
  // Urgência falsa
  ...['ultima chance', 'ultimas horas', 'ultimos dias', 'so hoje', 'acaba hoje', 'nao perca', 'imperdivel', 'urgente', 'corra'].map(term => ({ term, category: 'urgência falsa' })),
  // Spam
  ...['gratis', 'ganhe'].map(term => ({ term, category: 'spam' })),
  // Prova social / ranking
  ...['mais procurado', 'mais procurados', 'queridinha', 'queridinhas', 'favorito da semana', 'favoritos da semana'].map(term => ({ term, category: 'prova social' })),
  // Benefício / exclusividade inventados
  ...['acesso antecipado', 'brinde', 'brindes', 'pre-venda', 'pre venda', 'prioridade no atendimento', 'beneficio exclusivo', 'sorteio'].map(term => ({ term, category: 'benefício inventado' })),
]

export function auditEmailClaims(strategy: Strategy, strategyIndex: number, product: ProductTruth | null): ComplianceFinding[] {
  if (!isEmailStrategy(strategy)) return []
  const haystack = haystackOf(strategy)
  const productDescription = product?.description ? normalize(product.description) : ''
  const findings: ComplianceFinding[] = []
  for (const { term, category } of EMAIL_GUARDED_CLAIMS) {
    const needle = normalize(term)
    // Os termos acima são texto simples (sem metacaracteres de regex além do
    // hífen), então só o limite de palavra é necessário.
    if (!new RegExp(`\\b${needle}\\b`).test(haystack)) continue
    if (productDescription.includes(needle)) continue
    findings.push({ strategyIndex, claim: term, reason: `Alegação de e-mail "${term}" (${category}) não está comprovada — e-mail não tem exceção às regras de Product Truth e compliance` })
  }
  return findings
}

// Verifica alegações de atributo (cor, tamanho) contra a fonte estruturada
// real (Product Truth), não contra texto livre — um product.colors real deve
// deixar passar a claim mesmo que a description nunca repita a palavra.
// Sem produto confirmado, qualquer menção a cor/tamanho é não comprovada.
export function auditAttributeClaims(strategy: Strategy, strategyIndex: number, product: ProductTruth | null): ComplianceFinding[] {
  const findings: ComplianceFinding[] = []
  const haystack = haystackOf(strategy)
  const productDescription = product?.description ? normalize(product.description) : ''

  const realColors = new Set((product?.colors ?? []).map(normalize))
  for (const color of COLOR_TERMS) {
    if (!new RegExp(`\\b${color}\\b`, 'i').test(haystack)) continue
    if (realColors.has(color) || productDescription.includes(color)) continue
    findings.push({ strategyIndex, claim: color, reason: `Cor "${color}" não está confirmada nas variantes reais do produto (Product Truth)` })
  }

  const realSizes = new Set((product?.sizes ?? []).map(normalize))
  for (const size of SIZE_TERMS) {
    if (!new RegExp(`\\b${size}\\b`, 'i').test(haystack)) continue
    if (realSizes.has(size) || productDescription.includes(size)) continue
    findings.push({ strategyIndex, claim: size.toUpperCase(), reason: `Tamanho "${size.toUpperCase()}" não está confirmado nas variantes reais do produto (Product Truth)` })
  }

  return findings
}

export function auditStrategy(strategy: Strategy, strategyIndex: number, product: ProductTruth | null): ComplianceFinding[] {
  const findings: ComplianceFinding[] = []
  const haystack = haystackOf(strategy)
  const productDescription = product?.description ? normalize(product.description) : ''

  for (const claim of GUARDED_CLAIMS) {
    const needle = normalize(claim)
    if (!haystack.includes(needle)) continue
    if (productDescription.includes(needle)) continue
    findings.push({ strategyIndex, claim, reason: `Alegação "${claim}" não está comprovada na descrição real do produto` })
  }

  findings.push(...auditAttributeClaims(strategy, strategyIndex, product))
  findings.push(...auditEmailClaims(strategy, strategyIndex, product))

  if (strategy.productId && !product) {
    findings.push({ strategyIndex, claim: strategy.productId, reason: 'productId citado pela IA não foi confirmado pela Nuvemshop (Product Truth)' })
  }

  return findings
}

export function auditAllStrategies(strategies: Strategy[], productByStrategy: Array<ProductTruth | null>): ComplianceFinding[] {
  return strategies.flatMap((strategy, index) => auditStrategy(strategy, index, productByStrategy[index] ?? null))
}

// Strategy Lab v1.1 — Truth Hardening. GUARDED_CLAIMS bloqueia PALAVRAS
// (desconto, emagrece...); isto aqui bloqueia CLAIMS IMPLÍCITAS — frases que
// pressupõem um fato que o input não comprova, mesmo sem usar nenhuma palavra
// da lista acima. "O item continua disponível" não tem nenhuma palavra
// proibida, mas afirma estoque sem prova nenhuma — é exatamente esse tipo de
// alegação que escapava do auditor por palavra. Cada categoria só se aplica
// quando a EvidenceFlags correspondente estiver ausente, e algumas só valem
// para os tipos de oportunidade onde a frase realmente implica o que
// pressupõe (ex.: "continua disponível" é claim de ESTOQUE em carrinho
// abandonado, mas é claim de VALIDADE DE PAGAMENTO em Pix/boleto pendente).
interface ClaimCategoryRule {
  category: string
  requiredFlag: keyof EvidenceFlags
  phrases: string[]
  appliesTo?: OpportunityType[]
}

const CLAIM_CATEGORY_RULES: ClaimCategoryRule[] = [
  {
    category: 'product_recommendation',
    requiredFlag: 'hasCandidateProducts',
    phrases: [
      'separamos um complemento', 'separamos uma selecao', 'preparamos uma selecao',
      'combina com o que voce comprou', 'combina bem com o que voce ja tem',
      'pecas novas', 'complemento que combina',
    ],
  },
  {
    category: 'stock_availability',
    requiredFlag: 'hasStockEvidence',
    appliesTo: ['ABANDONED_CART'],
    phrases: ['continua disponivel', 'item continua disponivel', 'produto continua disponivel', 'ainda disponivel', 'segue disponivel'],
  },
  {
    // Microfix v1.1.1: "ainda dá tempo de finalizar quando quiser" não é uma
    // claim de estoque — é uma claim de que o CHECKOUT em si continua válido/
    // retomável, o que só está comprovado quando existe uma URL de
    // recuperação real (hasRecoveryUrlEvidence), não quando existe estoque.
    category: 'checkout_validity',
    requiredFlag: 'hasRecoveryUrlEvidence',
    appliesTo: ['ABANDONED_CART'],
    phrases: ['finalizar quando quiser', 'ainda da tempo', 'retomar o checkout quando quiser'],
  },
  {
    category: 'payment_validity',
    requiredFlag: 'hasPaymentExpiryEvidence',
    appliesTo: ['PIX_PENDING', 'BOLETO_PENDING'],
    phrases: [
      'continua disponivel', 'pagar agora', 'ainda pode ser pago', 'ainda e valido',
      'qualquer banco', 'qualquer loterica', 'quando for conveniente', 'quando quiser',
    ],
  },
  {
    category: 'newness',
    requiredFlag: 'hasNewnessEvidence',
    phrases: [
      'chegaram novidades', 'novidades relacionadas', 'novidades na categoria', 'novidades da categoria', 'novidades da mesma categoria',
      // e-mail: campanhas de novidade só existem com prova de novidade
      'novidades da semana', 'acabou de chegar', 'acabaram de chegar', 'recem chegad', 'nova colecao', 'colecao nova',
    ],
  },
  {
    category: 'category_affinity',
    requiredFlag: 'hasCategoryEvidence',
    phrases: [
      'mesma categoria', 'categoria que voce costuma comprar', 'categoria da sua ultima compra',
      'categoria que voce costumava explorar', 'categoria de interesse', 'categoria de afinidade',
    ],
  },
  {
    category: 'promotion',
    requiredFlag: 'hasPromotionEvidence',
    phrases: ['desconto', 'cupom', 'promocao', 'frete gratis'],
  },
]

// Diferente de auditStrategy, aqui a "descrição do produto" nunca é uma
// desculpa válida — estas claims não são sobre o PRODUTO, são sobre a
// OPORTUNIDADE (estoque, categoria, novidade, validade de pagamento), então
// só a EvidenceFlags computada a partir de dados reais da oportunidade pode
// liberar a frase, nunca a descrição de um produto candidato.
export function auditClaimCategories(strategy: Strategy, strategyIndex: number, opportunityType: OpportunityType, evidence: EvidenceFlags): ComplianceFinding[] {
  const findings: ComplianceFinding[] = []
  const haystack = haystackOf(strategy)

  for (const rule of CLAIM_CATEGORY_RULES) {
    if (rule.appliesTo && !rule.appliesTo.includes(opportunityType)) continue
    if (evidence[rule.requiredFlag]) continue
    for (const phrase of rule.phrases) {
      if (!haystack.includes(normalize(phrase))) continue
      findings.push({
        strategyIndex,
        claim: rule.category,
        reason: `Frase "${phrase}" implica um fato (${rule.category}) que não está comprovado para esta oportunidade (evidência ausente: ${rule.requiredFlag})`,
      })
    }
  }

  return findings
}
