import { Strategy } from './aiProvider'
import { ProductTruth } from '../productTruthService'

// Claims que exigem comprovação explícita nos dados de produto antes de
// aparecer numa mensagem gerada pela IA. Bloqueio por padrão (fail-closed):
// a claim só passa se o termo aparecer literalmente na descrição real do
// produto (Product Truth) — nunca porque a IA "acha" que é verdade.
const GUARDED_CLAIMS = [
  'premium', 'alfaiataria', 'emagrece', 'afina', 'modela', 'alongador',
  'últimas unidades', 'ultimas unidades', 'estoque acabando', 'mais vendido',
]

export type ComplianceFinding = { strategyIndex: number; claim: string; reason: string }

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function auditStrategy(strategy: Strategy, strategyIndex: number, product: ProductTruth | null): ComplianceFinding[] {
  const findings: ComplianceFinding[] = []
  const haystack = normalize(`${strategy.message} ${strategy.angle} ${strategy.creativeBrief} ${strategy.cta}`)
  const productDescription = product?.description ? normalize(product.description) : ''

  for (const claim of GUARDED_CLAIMS) {
    const needle = normalize(claim)
    if (!haystack.includes(needle)) continue
    if (productDescription.includes(needle)) continue
    findings.push({ strategyIndex, claim, reason: `Alegação "${claim}" não está comprovada na descrição real do produto` })
  }

  if (strategy.productId && !product) {
    findings.push({ strategyIndex, claim: strategy.productId, reason: 'productId citado pela IA não foi confirmado pela Nuvemshop (Product Truth)' })
  }

  return findings
}

export function auditAllStrategies(strategies: Strategy[], productByStrategy: Array<ProductTruth | null>): ComplianceFinding[] {
  return strategies.flatMap((strategy, index) => auditStrategy(strategy, index, productByStrategy[index] ?? null))
}
