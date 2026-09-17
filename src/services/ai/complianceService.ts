import { Strategy } from './aiProvider'
import { ProductTruth } from '../productTruthService'

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

function haystackOf(strategy: Strategy): string {
  return normalize(`${strategy.message} ${strategy.angle} ${strategy.creativeBrief} ${strategy.cta}`)
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

  if (strategy.productId && !product) {
    findings.push({ strategyIndex, claim: strategy.productId, reason: 'productId citado pela IA não foi confirmado pela Nuvemshop (Product Truth)' })
  }

  return findings
}

export function auditAllStrategies(strategies: Strategy[], productByStrategy: Array<ProductTruth | null>): ComplianceFinding[] {
  return strategies.flatMap((strategy, index) => auditStrategy(strategy, index, productByStrategy[index] ?? null))
}
