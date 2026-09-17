// Contrato de prompt compartilhado por TODOS os providers de IA (Anthropic, OpenAI, futuros).
// Existe para garantir paridade real entre providers — não é o Zod schema em si (esse é
// campaignStrategiesSchema, em aiProvider.ts), mas as regras de negócio que moldam a geração.
// Trocar de provider nunca deve mudar o que a IA pode ou não pode afirmar.
export const PROMPT_VERSION = 'campaign-strategies-v1'

export const SYSTEM_PROMPT = `Você é o motor de estratégia de campanhas da D'Rosa Recovery.

REGRAS ABSOLUTAS:
- Você só pode usar os dados numéricos e textuais fornecidos no input. Nunca invente estoque, benefício, resultado, urgência ou prova social.
- Se nenhum produto candidato for fornecido, use productId: null e diga isso explicitamente na mensagem (ex: "produto ainda não recomendado").
- Nunca afirme "últimas unidades", "mais vendido", "estoque acabando" ou qualquer alegação de escassez/performance sem que ela esteja literalmente no input.
- Nunca use termos de benefício de produto não comprovado (emagrece, afina, modela, alfaiataria, premium) a menos que venham literalmente da descrição do produto fornecida.
- audienceCount/eligibleCount/blockedCount já vêm calculados pelo backend — você nunca recalcula nem contesta elegibilidade.
- Gere exatamente 3 estratégias distintas (ângulos diferentes), cada uma com hook, argumento, produto (ou null), mensagem, CTA e brief criativo curto para o time de criação.
- Se algo no input for insuficiente para uma alegação, adicione um aviso em "warnings" em vez de inventar.`

// Usado só pelo AnthropicProvider: o helper de Zod do SDK da Anthropic espera Zod v4
// internamente, e o projeto está em Zod v3 em todo o resto do código — não vale a pena
// forçar duas versões de Zod coexistindo só por causa de um provider. O OpenAiProvider
// deriva o JSON Schema diretamente do mesmo campaignStrategiesSchema (Zod v3, compatível
// nativamente com o helper de Zod da OpenAI), então esta cópia manual não precisa ser
// duplicada lá — mas o formato abaixo é mantido em sincronia com esse schema.
export const STRATEGIES_JSON_SCHEMA = {
  type: 'object',
  properties: {
    opportunityId: { type: 'string' },
    summary: { type: 'string' },
    strategies: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          angle: { type: 'string' },
          audience: { type: 'string' },
          productId: { type: ['string', 'null'] },
          message: { type: 'string' },
          cta: { type: 'string' },
          creativeBrief: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'angle', 'audience', 'productId', 'message', 'cta', 'creativeBrief', 'warnings'],
      },
    },
  },
  required: ['opportunityId', 'summary', 'strategies'],
} as const
