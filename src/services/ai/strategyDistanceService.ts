import { Strategy, strategyText } from './aiProvider'

// Detecta quando A/B/C são, na prática, a mesma estratégia com troca de
// adjetivos — não usa previsão de venda nem qualquer sinal de conversão,
// só compara o texto de fato produzido entre pares de estratégias.
export type DistanceFinding = { strategyIndexA: number; strategyIndexB: number; reason: string }

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter(w => w.length > 2))
}

// Jaccard: |interseção| / |união| dos tokens normalizados. Determinístico e
// simétrico — o mesmo par de textos sempre produz o mesmo score, em qualquer
// ordem.
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}

// "argumento/mensagem" é strategyText(): para WhatsApp é exatamente `message`;
// para e-mail é assunto+preheader+headline+corpo — duas estratégias de e-mail
// com o mesmo corpo e assunto parecido também colidem.
const FIELDS: Array<{ label: string; threshold: number; read: (s: Strategy) => string }> = [
  { label: 'ângulo', threshold: 0.6, read: s => s.angle },
  { label: 'CTA', threshold: 0.7, read: s => s.cta },
  { label: 'argumento/mensagem', threshold: 0.6, read: strategyText },
  { label: 'brief criativo', threshold: 0.6, read: s => s.creativeBrief },
]

// Falha só quando pelo menos 2 dos 4 campos centrais colidem — um único CTA
// parecido por coincidência ("Ver agora" em ambas) não deveria reprovar duas
// estratégias com ângulo e argumento genuinamente diferentes.
const MIN_COLLIDING_FIELDS_TO_FAIL = 2

export function evaluateCreativeDistance(strategies: Strategy[]): DistanceFinding[] {
  const findings: DistanceFinding[] = []
  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      const collidingFields: string[] = []
      for (const field of FIELDS) {
        const similarity = jaccard(tokenSet(field.read(strategies[i])), tokenSet(field.read(strategies[j])))
        if (similarity >= field.threshold) collidingFields.push(field.label)
      }
      if (collidingFields.length >= MIN_COLLIDING_FIELDS_TO_FAIL) {
        findings.push({
          strategyIndexA: i,
          strategyIndexB: j,
          reason: `Estratégias ${i} e ${j} têm ${collidingFields.join(', ')} quase idênticos — não são direções realmente distintas, só uma reescrita da mesma ideia.`,
        })
      }
    }
  }
  return findings
}
