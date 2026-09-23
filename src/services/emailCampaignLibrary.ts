import { DirectionDefinition, EvidenceFlags } from './ai/strategyPlaybook'
import { EmailSegmentKey, EmailTrack, TRACK_PRIORITY } from './emailAudienceEngine'

// Biblioteca OFICIAL de campanhas de e-mail — versionada em código e
// independente da IA. A IA nunca decide qual campanha existe, para quem ela
// serve, qual a prioridade ou o cooldown: ela só gera copy DENTRO de uma
// campanha já escolhida pelo backend, seguindo as 3 direções (A/B/C) daqui.
//
// Nenhuma campanha desta lista inventa desconto, benefício, acesso antecipado,
// brinde, exclusividade, estoque ou ranking. Campanhas cuja premissa depende de
// um dado que o sistema ainda não coleta (novidade comprovada, ranking de
// vendas, reposição, categoria, navegação...) declaram um requisito HARD e
// ficam NEEDS_DATA — o nome da campanha nunca é tratado como prova.
export const EMAIL_CAMPAIGN_LIBRARY_VERSION = 'email-campaign-library-v1'

export type EmailCampaignCategory = 'GENERAL' | 'FIRST_TO_SECOND' | 'REPEAT' | 'VIP' | 'REACTIVATION' | 'NO_PURCHASE' | 'BEHAVIORAL'
export type FunnelStage = 'AWARENESS' | 'CONSIDERATION' | 'CONVERSION' | 'RETENTION' | 'REACTIVATION'

export type RequirementKey =
  | 'CANDIDATE_PRODUCTS'
  | 'NEWNESS_EVIDENCE'
  | 'CATEGORY_DATA'
  | 'BEST_SELLER_RANKING'
  | 'RESTOCK_EVIDENCE'
  | 'COMPLEMENTARY_PRODUCT_EVIDENCE'
  | 'BROWSE_TRACKING'
  | 'STOCK_INTEREST_SUBSCRIPTION'
  | 'CART_RECOVERY_DATA'

export interface DataCapability { available: boolean; evidence: string }

// O que o sistema REALMENTE tem hoje (auditoria da Fase 1). Só vira true
// quando existir fonte real de dados no schema/serviços — nunca por intenção.
export const EMAIL_DATA_CAPABILITIES: Record<RequirementKey, DataCapability> = {
  CANDIDATE_PRODUCTS: { available: false, evidence: 'Candidatos de produto verificados (Product Truth) só existem por amostra de audiência de WhatsApp; não há seleção de produtos por segmento de e-mail.' },
  NEWNESS_EVIDENCE: { available: false, evidence: 'Nenhum indício comprovado de lançamento/novidade (data de publicação de produto) é armazenado.' },
  CATEGORY_DATA: { available: false, evidence: 'Nenhum pedido ou produto armazenado tem categoria (confirmado em docs/evidence-enrichment-report.md).' },
  BEST_SELLER_RANKING: { available: false, evidence: 'Não existe ranking de vendas por produto calculado nem armazenado.' },
  RESTOCK_EVIDENCE: { available: false, evidence: 'Não existe histórico de estoque nem evento de reposição.' },
  COMPLEMENTARY_PRODUCT_EVIDENCE: { available: false, evidence: 'Nenhuma regra determinística de produto complementar existe.' },
  BROWSE_TRACKING: { available: false, evidence: 'Não há rastreamento de navegação por cliente.' },
  STOCK_INTEREST_SUBSCRIPTION: { available: false, evidence: 'Não há inscrição de interesse em produto sem estoque.' },
  CART_RECOVERY_DATA: { available: true, evidence: 'abandoned_checkouts guarda customerEmail e abandonedCheckoutUrl reais.' },
}

export interface CampaignRequirement { key: RequirementKey; hard: boolean; description: string }

export interface EmailCampaignDefinition {
  key: EmailCampaignKey
  name: string
  category: EmailCampaignCategory
  objective: string
  description: string
  allowedSegments: EmailSegmentKey[]
  excludedSegments: EmailSegmentKey[]
  track: EmailTrack
  priority: number
  recommendedCooldownDays: number
  recommendedCadence: string
  funnelStage: FunnelStage
  requirements: CampaignRequirement[]
  primaryMetric: string
  whyNow: string
  aiDirections: DirectionDefinition[]
}

export const EMAIL_CAMPAIGN_KEYS = [
  'NEW_ARRIVALS', 'BEST_SELLERS', 'STYLE_INSPIRATION', 'WEEKLY_SELECTION', 'SEASONAL_COLLECTION', 'OCCASION_EDIT', 'CATEGORY_SPOTLIGHT', 'RESTOCK', 'BRAND_RELATIONSHIP', 'CATALOG_DISCOVERY',
  'SECOND_PURCHASE', 'POST_PURCHASE_STYLE', 'POST_PURCHASE_DISCOVERY', 'COMPLEMENTARY_PURCHASE',
  'REPEAT_BUYER_NEWNESS', 'REPEAT_BUYER_RELATIONSHIP', 'REPEAT_BUYER_CATEGORY', 'REPEAT_BUYER_CROSS_SELL',
  'VIP_RELATIONSHIP', 'VIP_CURATED_SELECTION', 'VIP_NEW_ARRIVALS',
  'WINBACK_31_60', 'WINBACK_61_90', 'WINBACK_91_180', 'WINBACK_181_365', 'DORMANT_REACTIVATION_365_PLUS', 'DORMANT_LAST_ENGAGEMENT',
  'FIRST_PURCHASE_DISCOVERY', 'ASSISTED_DISCOVERY',
  'CART_RECOVERY_EMAIL', 'BROWSE_RECOVERY', 'BACK_IN_STOCK', 'CATEGORY_AFFINITY',
] as const
export type EmailCampaignKey = typeof EMAIL_CAMPAIGN_KEYS[number]

type Flag = keyof EvidenceFlags

// Helpers de escrita — mantêm as 33 definições legíveis e uniformes.
function dir(key: 'A' | 'B' | 'C', label: string, intent: string, guidance: string, fallback?: { requires: Flag; guidance: string; warning: string }): DirectionDefinition {
  return { key, label, intent, guidance, ...(fallback ? { requires: fallback.requires, fallbackGuidance: fallback.guidance, fallbackWarning: fallback.warning } : {}) }
}
function req(key: RequirementKey, hard: boolean, description: string): CampaignRequirement { return { key, hard, description } }
function cadence(days: number): string { return `No máximo 1 envio a cada ${days} dias por cliente` }

function campaign(input: Omit<EmailCampaignDefinition, 'priority' | 'recommendedCadence'>): EmailCampaignDefinition {
  return { ...input, priority: TRACK_PRIORITY[input.track], recommendedCadence: cadence(input.recommendedCooldownDays) }
}

const NO_CLAIMS = 'Nunca invente desconto, cupom, frete grátis, benefício, brinde, acesso antecipado, exclusividade, estoque ou urgência.'
const NEWNESS_FALLBACK = (label: string) => ({ requires: 'hasNewnessEvidence' as Flag, guidance: `Sem prova de novidade, não afirme que chegou algo novo. ${label}`, warning: 'Direção degradada: nenhuma evidência comprovada de novidade — a variação evita afirmar que há novidades.' })
const PRODUCT_FALLBACK = (label: string) => ({ requires: 'hasCandidateProducts' as Flag, guidance: `Sem produto candidato real, não cite item específico nem afirme ter separado uma seleção. ${label}`, warning: 'Direção degradada: nenhum produto candidato real foi fornecido — a variação não cita item específico.' })
const CATEGORY_FALLBACK = (label: string) => ({ requires: 'hasCategoryEvidence' as Flag, guidance: `Sem evidência real de categoria, não afirme afinidade nem cite categoria. ${label}`, warning: 'Direção degradada: nenhuma evidência real de categoria — a variação evita citar categoria de interesse.' })

const ALL: EmailSegmentKey = 'ALL_EMAIL_CUSTOMERS'

const CAMPAIGNS: EmailCampaignDefinition[] = [
  // ── GERAIS ─────────────────────────────────────────────────────────────────────────────────
  campaign({
    key: 'NEW_ARRIVALS', name: 'Novidades da semana', category: 'GENERAL', track: 'GENERAL', funnelStage: 'AWARENESS',
    objective: 'Apresentar peças novas da semana', description: 'Comunica novidades reais do catálogo. Só existe com prova de novidade.',
    allowedSegments: [ALL, 'RECENT_BUYERS_0_30D', 'LAPSED_61_90D', 'LAPSED_91_180D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 7,
    requirements: [req('NEWNESS_EVIDENCE', true, 'Prova comprovada de que há peças novas (ex.: data de publicação de produto).'), req('CANDIDATE_PRODUCTS', false, 'Produtos reais para destacar.')],
    primaryMetric: 'Cliques nas peças novas', whyNow: 'Base com e-mail conhecida e nenhuma campanha de novidades ativa.',
    aiDirections: [
      dir('A', 'NOVIDADE EM DESTAQUE', 'Anunciar a novidade comprovada.', 'Apresente a novidade comprovada citando apenas o produto candidato real do input.', NEWNESS_FALLBACK('Convide a conhecer o catálogo atual.')),
      dir('B', 'CURADORIA DA SEMANA', 'Organizar as novidades por uma ideia de uso.', 'Agrupe as peças reais do input por uma ideia de uso, sem inventar atributos.', PRODUCT_FALLBACK('Convide a explorar o catálogo.')),
      dir('C', 'CONVITE À DESCOBERTA', 'Convidar a ver o que há de novo sem pressão.', `Convide a conferir o catálogo com tom de curiosidade. ${NO_CLAIMS}`),
    ],
  }),
  campaign({
    key: 'BEST_SELLERS', name: 'Mais procurados', category: 'GENERAL', track: 'GENERAL', funnelStage: 'CONSIDERATION',
    objective: 'Mostrar o que mais sai', description: 'Só existe com ranking de vendas comprovado. Sem ranking, fica NEEDS_DATA.',
    allowedSegments: [ALL, 'ONE_TIME_BUYERS', 'NO_PURCHASE_CUSTOMERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('BEST_SELLER_RANKING', true, 'Ranking de vendas por produto calculado a partir de pedidos reais.'), req('CANDIDATE_PRODUCTS', true, 'Produtos reais do ranking.')],
    primaryMetric: 'Cliques nos produtos do ranking', whyNow: 'Prova social real ajuda quem ainda não decidiu — quando o ranking existe.',
    aiDirections: [
      dir('A', 'RANKING COMPROVADO', 'Apresentar o ranking real.', 'Apresente os produtos do ranking real fornecido, sem superlativo além do dado.', PRODUCT_FALLBACK('Não use "mais vendido" nem equivalente.')),
      dir('B', 'POR QUE ESTÃO EM DESTAQUE', 'Explicar o motivo real do destaque.', 'Explique o destaque usando só o dado real fornecido.', PRODUCT_FALLBACK('Não afirme popularidade.')),
      dir('C', 'CONVITE À CONFERIR', 'Convidar a ver os itens em destaque.', `Convide a conferir os itens em destaque. ${NO_CLAIMS}`),
    ],
  }),
  campaign({
    key: 'STYLE_INSPIRATION', name: 'Inspiração de looks', category: 'GENERAL', track: 'GENERAL', funnelStage: 'CONSIDERATION',
    objective: 'Inspirar com ideias de composição', description: 'Conteúdo editorial de estilo, sem prometer produto específico quando não houver candidato real.',
    allowedSegments: [ALL, 'RECENT_BUYERS_0_30D', 'ONE_TIME_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('CANDIDATE_PRODUCTS', false, 'Produtos reais para ilustrar os looks.')],
    primaryMetric: 'Cliques no catálogo', whyNow: 'Conteúdo de estilo mantém a marca presente sem oferta.',
    aiDirections: [
      dir('A', 'LOOK DO DIA A DIA', 'Sugerir uma composição prática.', 'Sugira uma ideia de composição para o dia a dia, com linguagem D\'Rosa.', PRODUCT_FALLBACK('Descreva a ideia sem citar peça específica.')),
      dir('B', 'OCASIÃO ESPECIAL', 'Sugerir uma composição para uma ocasião.', 'Sugira uma ideia de composição para uma ocasião, sem prometer disponibilidade.'),
      dir('C', 'DICA DE COMBINAÇÃO', 'Ensinar uma combinação simples.', 'Dê uma dica simples de combinação sem afirmar atributos de tecido, cor ou caimento não comprovados.'),
    ],
  }),
  campaign({
    key: 'WEEKLY_SELECTION', name: 'Seleção da semana', category: 'GENERAL', track: 'GENERAL', funnelStage: 'CONSIDERATION',
    objective: 'Apresentar uma seleção curada', description: 'Exige produtos candidatos reais — sem eles, não há seleção a apresentar.',
    allowedSegments: [ALL, 'REPEAT_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 7,
    requirements: [req('CANDIDATE_PRODUCTS', true, 'Produtos reais verificados para compor a seleção.')],
    primaryMetric: 'Cliques nos produtos da seleção', whyNow: 'Uma seleção curta reduz a fricção de escolha.',
    aiDirections: [
      dir('A', 'SELEÇÃO COMPLETA', 'Apresentar a seleção.', 'Apresente a seleção usando só os produtos reais do input.', PRODUCT_FALLBACK('Convide a conhecer o catálogo.')),
      dir('B', 'PEÇA EM DESTAQUE', 'Destacar uma peça da seleção.', 'Destaque uma peça real do input.', PRODUCT_FALLBACK('Convide a conhecer o catálogo.')),
      dir('C', 'CONVITE À ESCOLHA', 'Convidar a escolher sem pressão.', `Convide a escolher com calma. ${NO_CLAIMS}`),
    ],
  }),
  campaign({
    key: 'SEASONAL_COLLECTION', name: 'Coleção de estação', category: 'GENERAL', track: 'GENERAL', funnelStage: 'AWARENESS',
    objective: 'Conectar a marca à estação', description: 'Campanha editorial da estação. Sem prova de coleção nova, não afirma lançamento.',
    allowedSegments: [ALL, 'RECENT_BUYERS_0_30D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('NEWNESS_EVIDENCE', false, 'Prova de coleção nova.'), req('CANDIDATE_PRODUCTS', false, 'Produtos reais da estação.')],
    primaryMetric: 'Cliques no catálogo', whyNow: 'A mudança de estação é um gancho natural de comunicação.',
    aiDirections: [
      dir('A', 'CLIMA DA ESTAÇÃO', 'Falar da estação como inspiração.', 'Fale da estação como inspiração de estilo, sem afirmar lançamento.', NEWNESS_FALLBACK('Foque na inspiração, não na novidade.')),
      dir('B', 'PEÇAS PARA A ESTAÇÃO', 'Sugerir peças reais para a estação.', 'Sugira peças reais do input para a estação.', PRODUCT_FALLBACK('Descreva a inspiração sem citar peça.')),
      dir('C', 'CONVITE À CONFERIR', 'Convidar a ver o catálogo.', `Convide a conferir o catálogo. ${NO_CLAIMS}`),
    ],
  }),
  campaign({
    key: 'OCCASION_EDIT', name: 'Looks por ocasião', category: 'GENERAL', track: 'GENERAL', funnelStage: 'CONSIDERATION',
    objective: 'Ajudar a escolher por ocasião', description: 'Organiza ideias por ocasião (trabalho, festa, fim de semana) sem prometer produto específico.',
    allowedSegments: [ALL, 'ONE_TIME_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('CANDIDATE_PRODUCTS', false, 'Produtos reais para ilustrar as ocasiões.')],
    primaryMetric: 'Cliques no catálogo', whyNow: 'Ocasião é um jeito prático de escolher.',
    aiDirections: [
      dir('A', 'TRABALHO', 'Ideias para o dia a dia profissional.', 'Sugira ideias para a rotina de trabalho sem afirmar atributos não comprovados.', PRODUCT_FALLBACK('Descreva a ideia sem citar peça.')),
      dir('B', 'FIM DE SEMANA', 'Ideias para momentos leves.', 'Sugira ideias para o fim de semana sem afirmar atributos não comprovados.'),
      dir('C', 'OCASIÃO ESPECIAL', 'Ideias para eventos.', 'Sugira ideias para uma ocasião especial sem prometer disponibilidade ou exclusividade.'),
    ],
  }),
  campaign({
    key: 'CATEGORY_SPOTLIGHT', name: 'Destaque de categoria', category: 'GENERAL', track: 'GENERAL', funnelStage: 'CONSIDERATION',
    objective: 'Apresentar uma categoria', description: 'Exige dados de categoria — que o sistema ainda não coleta.',
    allowedSegments: [ALL], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('CATEGORY_DATA', true, 'Categoria de produto armazenada por item.'), req('CANDIDATE_PRODUCTS', true, 'Produtos reais da categoria.')],
    primaryMetric: 'Cliques na categoria', whyNow: 'Destacar uma categoria ajuda a explorar o catálogo — quando a categoria é conhecida.',
    aiDirections: [
      dir('A', 'A CATEGORIA EM FOCO', 'Apresentar a categoria.', 'Apresente a categoria comprovada do input.', CATEGORY_FALLBACK('Convide a conhecer o catálogo.')),
      dir('B', 'PEÇAS DA CATEGORIA', 'Mostrar peças reais da categoria.', 'Mostre peças reais do input dessa categoria.', PRODUCT_FALLBACK('Convide a conhecer o catálogo.')),
      dir('C', 'COMO USAR', 'Dar uma ideia de uso.', 'Dê uma ideia de uso sem afirmar atributos não comprovados.'),
    ],
  }),
  campaign({
    key: 'RESTOCK', name: 'Reposição', category: 'GENERAL', track: 'GENERAL', funnelStage: 'CONVERSION',
    objective: 'Avisar que uma peça voltou', description: 'Só existe com evidência real de reposição de estoque.',
    allowedSegments: [ALL, 'ONE_TIME_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 7,
    requirements: [req('RESTOCK_EVIDENCE', true, 'Evento real de reposição de estoque.'), req('CANDIDATE_PRODUCTS', true, 'Produto reposto verificado.')],
    primaryMetric: 'Cliques no produto reposto', whyNow: 'Reposição real é um dos motivos mais fortes de contato — quando comprovada.',
    aiDirections: [
      dir('A', 'VOLTOU AO ESTOQUE', 'Avisar a reposição comprovada.', 'Avise a reposição citando só o produto e o dado real do input.', PRODUCT_FALLBACK('Não afirme reposição nem disponibilidade.')),
      dir('B', 'PARA QUEM ESPERAVA', 'Falar com quem tinha interesse.', 'Fale com quem demonstrou interesse, sem afirmar quantidade restante.', PRODUCT_FALLBACK('Não afirme reposição.')),
      dir('C', 'CONFIRA AGORA', 'Convidar a conferir.', `Convide a conferir. ${NO_CLAIMS}`),
    ],
  }),
  campaign({
    key: 'BRAND_RELATIONSHIP', name: 'Relacionamento com a marca', category: 'GENERAL', track: 'GENERAL', funnelStage: 'RETENTION',
    objective: 'Manter a marca presente sem oferta', description: 'Conteúdo de relacionamento e identidade D\'Rosa — sem oferta inventada.',
    allowedSegments: [ALL, 'REPEAT_BUYERS', 'ONE_TIME_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [],
    primaryMetric: 'Cliques no site', whyNow: 'Relacionamento constante sustenta a próxima compra sem depender de oferta.',
    aiDirections: [
      dir('A', 'HISTÓRIA DA MARCA', 'Contar quem é a D\'Rosa.', `Conte de forma genuína o que a marca valoriza, sem afirmar fatos não fornecidos no input. ${NO_CLAIMS}`),
      dir('B', 'BASTIDORES', 'Aproximar a cliente da marca.', 'Aproxime a cliente da marca com tom pessoal, sem inventar fatos.'),
      dir('C', 'AGRADECIMENTO', 'Agradecer a confiança.', 'Agradeça a confiança da cliente sem oferecer benefício não comprovado.'),
    ],
  }),
  campaign({
    key: 'CATALOG_DISCOVERY', name: 'Descubra o catálogo', category: 'GENERAL', track: 'GENERAL', funnelStage: 'CONSIDERATION',
    objective: 'Levar a cliente a explorar o catálogo atual', description: 'Convite à descoberta do catálogo atual, sem afirmar novidade, estoque ou oferta.',
    allowedSegments: [ALL, 'LAPSED_61_90D', 'LAPSED_91_180D', 'NO_PURCHASE_CUSTOMERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [],
    primaryMetric: 'Cliques no catálogo', whyNow: 'Convite simples à descoberta funciona quando não há novidade comprovada.',
    aiDirections: [
      dir('A', 'CONVITE À EXPLORAÇÃO', 'Convidar a explorar.', `Convide a explorar o catálogo atual. ${NO_CLAIMS}`),
      dir('B', 'DE ONDE COMEÇAR', 'Dar um ponto de partida.', 'Sugira por onde começar a explorar, sem citar peça específica sem candidato real.'),
      dir('C', 'ESTAMOS POR AQUI', 'Reforçar a disponibilidade de atendimento.', 'Reforce que a equipe está disponível para ajudar, sem prometer prazo ou benefício.'),
    ],
  }),

  // ── PRIMEIRA → SEGUNDA COMPRA ──────────────────────────────────────────────────────────────
  campaign({
    key: 'SECOND_PURCHASE', name: 'Segunda compra', category: 'FIRST_TO_SECOND', track: 'SECOND_PURCHASE', funnelStage: 'CONVERSION',
    objective: 'Converter o cliente de 1 compra em recorrente', description: 'Para quem fez apenas uma compra. Sem desconto ou benefício inventado.',
    allowedSegments: ['ONE_TIME_BUYERS', 'LAPSED_31_60D'], excludedSegments: ['RECENT_CART_ABANDONER', 'REPEAT_BUYERS', 'VIP_CUSTOMERS'], recommendedCooldownDays: 14,
    requirements: [req('CANDIDATE_PRODUCTS', false, 'Produtos reais para sugerir.')],
    primaryMetric: 'Segunda compra em 30 dias', whyNow: 'Cliente com uma única compra: a segunda compra é o passo que mais muda o valor do relacionamento.',
    aiDirections: [
      dir('A', 'CONTINUIDADE DA EXPERIÊNCIA', 'Retomar a boa experiência da primeira compra.', 'Retome a experiência da primeira compra e convide a voltar, sem oferta.'),
      dir('B', 'PRÓXIMO PASSO', 'Sugerir o próximo item.', 'Sugira um próximo item real do input.', PRODUCT_FALLBACK('Convide a conhecer o catálogo atual.')),
      dir('C', 'AJUDA PARA ESCOLHER', 'Oferecer ajuda humana.', 'Ofereça ajuda da equipe para escolher, sem prometer nada além disso.'),
    ],
  }),
  campaign({
    key: 'POST_PURCHASE_STYLE', name: 'Pós-compra: como combinar', category: 'FIRST_TO_SECOND', track: 'POST_PURCHASE', funnelStage: 'RETENTION',
    objective: 'Ajudar a usar e combinar o que foi comprado', description: 'Orientação de estilo geral após a primeira compra, sem afirmar o item exato comprado.',
    allowedSegments: ['ONE_TIME_BUYERS', 'RECENT_BUYERS_0_30D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('CANDIDATE_PRODUCTS', false, 'Produto comprado/complementar verificado.')],
    primaryMetric: 'Satisfação pós-compra', whyNow: 'Compra recente: momento de maior atenção da cliente.',
    aiDirections: [
      dir('A', 'COMO USAR', 'Orientar o uso.', 'Ofereça orientação geral de uso, sem afirmar qual item foi comprado.', PRODUCT_FALLBACK('Mantenha a orientação geral.')),
      dir('B', 'COMO COMBINAR', 'Ideias de combinação.', 'Dê ideias de combinação sem afirmar atributos não comprovados.'),
      dir('C', 'FALE COM A GENTE', 'Abrir canal de ajuda.', 'Convide a tirar dúvidas com a equipe.'),
    ],
  }),
  campaign({
    key: 'POST_PURCHASE_DISCOVERY', name: 'Pós-compra: conheça outras opções', category: 'FIRST_TO_SECOND', track: 'POST_PURCHASE', funnelStage: 'CONSIDERATION',
    objective: 'Apresentar outras opções depois da primeira compra', description: 'Convite a conhecer outras partes do catálogo após a primeira compra.',
    allowedSegments: ['ONE_TIME_BUYERS', 'RECENT_BUYERS_0_30D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('CANDIDATE_PRODUCTS', false, 'Produtos reais para apresentar.')],
    primaryMetric: 'Cliques no catálogo', whyNow: 'A primeira compra abre a porta para conhecer mais.',
    aiDirections: [
      dir('A', 'MAIS DO CATÁLOGO', 'Convidar a conhecer mais.', `Convide a conhecer outras opções do catálogo. ${NO_CLAIMS}`),
      dir('B', 'PEÇAS REAIS', 'Apresentar peças reais.', 'Apresente peças reais do input.', PRODUCT_FALLBACK('Convide a conhecer o catálogo.')),
      dir('C', 'CONVERSA', 'Abrir conversa.', 'Pergunte o que a cliente gostaria de encontrar.'),
    ],
  }),
  campaign({
    key: 'COMPLEMENTARY_PURCHASE', name: 'Compra complementar', category: 'FIRST_TO_SECOND', track: 'SECOND_PURCHASE', funnelStage: 'CONVERSION',
    objective: 'Sugerir um complemento real da compra', description: 'Cross-sell — só com produto complementar comprovado.',
    allowedSegments: ['ONE_TIME_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 14,
    requirements: [req('COMPLEMENTARY_PRODUCT_EVIDENCE', true, 'Regra determinística de produto complementar.'), req('CANDIDATE_PRODUCTS', true, 'Produto complementar verificado.')],
    primaryMetric: 'Compra do item complementar', whyNow: 'Complemento faz sentido logo após a compra — quando existe evidência do que combina.',
    aiDirections: [
      dir('A', 'COMPLEMENTO REAL', 'Sugerir o complemento.', 'Sugira o complemento real do input.', PRODUCT_FALLBACK('Não afirme que algo combina.')),
      dir('B', 'COMPLETE O LOOK', 'Sugerir completar o look.', 'Sugira completar o look com o item real do input.', PRODUCT_FALLBACK('Não afirme combinação.')),
      dir('C', 'AJUDA HUMANA', 'Oferecer ajuda.', 'Ofereça ajuda da equipe para escolher um complemento.'),
    ],
  }),

  // ── RECORRENTES ────────────────────────────────────────────────────────────────────────────
  campaign({
    key: 'REPEAT_BUYER_NEWNESS', name: 'Novidades para recorrentes', category: 'REPEAT', track: 'REPEAT_ACTIVE', funnelStage: 'RETENTION',
    objective: 'Manter recorrentes atualizados', description: 'Novidades comprovadas para quem compra repetidamente.',
    allowedSegments: ['REPEAT_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER', 'VIP_CUSTOMERS'], recommendedCooldownDays: 14,
    requirements: [req('NEWNESS_EVIDENCE', true, 'Prova de novidade.'), req('CANDIDATE_PRODUCTS', false, 'Produtos reais.')],
    primaryMetric: 'Recompra em 30 dias', whyNow: 'Cliente recorrente responde bem a novidades — quando elas existem de fato.',
    aiDirections: [
      dir('A', 'NOVIDADE COMPROVADA', 'Apresentar a novidade.', 'Apresente a novidade comprovada do input.', NEWNESS_FALLBACK('Reconheça a recorrência e convide a conferir o catálogo.')),
      dir('B', 'PEÇAS PARA VOCÊ', 'Sugerir peças reais.', 'Sugira peças reais do input.', PRODUCT_FALLBACK('Convide a conferir o catálogo.')),
      dir('C', 'RECONHECIMENTO', 'Reconhecer a recorrência.', 'Reconheça a recorrência sem oferecer benefício não comprovado.'),
    ],
  }),
  campaign({
    key: 'REPEAT_BUYER_RELATIONSHIP', name: 'Reconhecimento de cliente recorrente', category: 'REPEAT', track: 'REPEAT_ACTIVE', funnelStage: 'RETENTION',
    objective: 'Reconhecer quem compra sempre', description: 'Relacionamento com clientes de 2+ compras, sem benefício inventado.',
    allowedSegments: ['REPEAT_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER', 'VIP_CUSTOMERS'], recommendedCooldownDays: 21,
    requirements: [],
    primaryMetric: 'Recompra em 60 dias', whyNow: 'Quem já comprou mais de uma vez merece um contato que reconheça isso.',
    aiDirections: [
      dir('A', 'OBRIGADO POR VOLTAR', 'Agradecer a recorrência.', `Agradeça por voltar a comprar. ${NO_CLAIMS}`),
      dir('B', 'CONTE COM A GENTE', 'Reforçar o atendimento.', 'Reforce o atendimento próximo, sem prometer benefício.'),
      dir('C', 'O QUE VOCÊ GOSTARIA DE VER', 'Ouvir a cliente.', 'Pergunte o que a cliente gostaria de encontrar na loja.'),
    ],
  }),
  campaign({
    key: 'REPEAT_BUYER_CATEGORY', name: 'Categoria de afinidade (recorrentes)', category: 'REPEAT', track: 'REPEAT_ACTIVE', funnelStage: 'CONSIDERATION',
    objective: 'Falar da categoria que o cliente mais compra', description: 'Só com afinidade de categoria comprovada — hoje não existe categoria armazenada.',
    allowedSegments: ['REPEAT_BUYERS', 'CATEGORY_AFFINITY'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [req('CATEGORY_DATA', true, 'Categoria de produto por item comprado.'), req('CANDIDATE_PRODUCTS', true, 'Produtos reais da categoria.')],
    primaryMetric: 'Recompra na categoria', whyNow: 'Afinidade real de categoria torna a mensagem relevante — quando existe dado.',
    aiDirections: [
      dir('A', 'SUA CATEGORIA', 'Falar da categoria de afinidade.', 'Fale da categoria de afinidade comprovada.', CATEGORY_FALLBACK('Convide a conferir o catálogo.')),
      dir('B', 'PEÇAS DA CATEGORIA', 'Mostrar peças reais.', 'Mostre peças reais do input.', PRODUCT_FALLBACK('Convide a conferir o catálogo.')),
      dir('C', 'CONVERSA', 'Perguntar preferências.', 'Pergunte que tipo de peça a cliente procura.'),
    ],
  }),
  campaign({
    key: 'REPEAT_BUYER_CROSS_SELL', name: 'Complemento para recorrentes', category: 'REPEAT', track: 'REPEAT_ACTIVE', funnelStage: 'CONVERSION',
    objective: 'Sugerir complemento baseado em evidência', description: 'Cross-sell apenas com evidência real de produto complementar.',
    allowedSegments: ['REPEAT_BUYERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [req('COMPLEMENTARY_PRODUCT_EVIDENCE', true, 'Regra determinística de complemento.'), req('CANDIDATE_PRODUCTS', true, 'Produto complementar verificado.')],
    primaryMetric: 'Compra do item sugerido', whyNow: 'Quem compra sempre tende a aceitar um complemento — se ele for comprovadamente relevante.',
    aiDirections: [
      dir('A', 'COMPLEMENTO COMPROVADO', 'Sugerir o complemento.', 'Sugira o complemento real do input.', PRODUCT_FALLBACK('Não afirme que algo combina.')),
      dir('B', 'RENOVE O LOOK', 'Sugerir renovação.', 'Sugira renovar com uma peça real do input.', PRODUCT_FALLBACK('Não afirme combinação.')),
      dir('C', 'AJUDA HUMANA', 'Oferecer ajuda.', 'Ofereça ajuda da equipe para escolher.'),
    ],
  }),

  // ── VIP ────────────────────────────────────────────────────────────────────────────────────
  campaign({
    key: 'VIP_RELATIONSHIP', name: 'Relacionamento VIP', category: 'VIP', track: 'VIP_RELATIONSHIP', funnelStage: 'RETENTION',
    objective: 'Reconhecer clientes VIP sem inventar benefício', description: 'Reconhecimento do histórico de compra. Nunca oferece benefício, acesso ou exclusividade não configurados.',
    allowedSegments: ['VIP_CUSTOMERS', 'HIGH_VALUE_NON_VIP'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [],
    primaryMetric: 'Recompra VIP em 60 dias', whyNow: 'Clientes VIP concentram valor — reconhecimento genuíno sustenta o relacionamento.',
    aiDirections: [
      dir('A', 'RECONHECIMENTO', 'Reconhecer o histórico.', `Reconheça o histórico de compras com tom de relacionamento. ${NO_CLAIMS}`),
      dir('B', 'OBRIGADO PELA CONFIANÇA', 'Agradecer.', 'Agradeça a confiança de forma pessoal, sem benefício não comprovado.'),
      dir('C', 'ATENDIMENTO PRÓXIMO', 'Reforçar o atendimento.', 'Reforce o atendimento próximo, sem prometer prioridade ou benefício.'),
    ],
  }),
  campaign({
    key: 'VIP_CURATED_SELECTION', name: 'Curadoria para VIP', category: 'VIP', track: 'VIP_RELATIONSHIP', funnelStage: 'CONVERSION',
    objective: 'Apresentar curadoria a clientes VIP', description: 'Exige produtos candidatos reais para existir.',
    allowedSegments: ['VIP_CUSTOMERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [req('CANDIDATE_PRODUCTS', true, 'Produtos reais verificados para a curadoria.')],
    primaryMetric: 'Compra VIP na curadoria', whyNow: 'Curadoria personalizada é o formato mais relevante para VIP — quando há produtos reais.',
    aiDirections: [
      dir('A', 'CURADORIA', 'Apresentar a seleção.', 'Apresente a seleção com os produtos reais do input.', PRODUCT_FALLBACK('Reconheça o histórico sem afirmar curadoria.')),
      dir('B', 'PEÇA EM DESTAQUE', 'Destacar uma peça.', 'Destaque uma peça real do input.', PRODUCT_FALLBACK('Reconheça o histórico sem afirmar curadoria.')),
      dir('C', 'CONVERSA', 'Abrir conversa.', 'Pergunte o que a cliente gostaria de ver, sem prometer acesso especial.'),
    ],
  }),
  campaign({
    key: 'VIP_NEW_ARRIVALS', name: 'Novidades para VIP', category: 'VIP', track: 'VIP_RELATIONSHIP', funnelStage: 'RETENTION',
    objective: 'Apresentar novidades comprovadas a VIP', description: 'Nunca afirma acesso antecipado. Só existe com prova de novidade.',
    allowedSegments: ['VIP_CUSTOMERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [req('NEWNESS_EVIDENCE', true, 'Prova de novidade.'), req('CANDIDATE_PRODUCTS', false, 'Produtos reais.')],
    primaryMetric: 'Cliques nas novidades', whyNow: 'VIP tende a valorizar novidades — desde que sejam reais.',
    aiDirections: [
      dir('A', 'NOVIDADE COMPROVADA', 'Apresentar a novidade.', 'Apresente a novidade comprovada do input, sem afirmar acesso antecipado.', NEWNESS_FALLBACK('Reconheça o relacionamento e convide a conferir o catálogo.')),
      dir('B', 'PEÇAS PARA VOCÊ', 'Sugerir peças reais.', 'Sugira peças reais do input.', PRODUCT_FALLBACK('Convide a conferir o catálogo.')),
      dir('C', 'RECONHECIMENTO', 'Reconhecer.', `Reconheça o relacionamento. ${NO_CLAIMS}`),
    ],
  }),

  // ── REATIVAÇÃO ─────────────────────────────────────────────────────────────────────────────
  campaign({
    key: 'WINBACK_31_60', name: 'Reativação leve (31–60 dias)', category: 'REACTIVATION', track: 'REACTIVATION', funnelStage: 'REACTIVATION',
    objective: 'Lembrar a marca de forma leve', description: 'Contato leve para quem comprou há 31–60 dias. Clientes nessa faixa costumam estar cobertos por campanhas de ciclo de vida (segunda compra/recorrente/VIP), que têm prioridade.',
    allowedSegments: ['LAPSED_31_60D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [],
    primaryMetric: 'Retorno em 30 dias', whyNow: 'Última compra entre 31 e 60 dias.',
    aiDirections: [
      dir('A', 'SAUDADE LEVE', 'Reabrir contato de forma leve.', `Reabra o contato com leveza. ${NO_CLAIMS}`),
      dir('B', 'O QUE HÁ NO CATÁLOGO', 'Convidar a conferir.', 'Convide a conferir o catálogo atual sem afirmar novidade.'),
      dir('C', 'COMO FOI SUA EXPERIÊNCIA', 'Ouvir a cliente.', 'Pergunte como foi a experiência da última compra.'),
    ],
  }),
  campaign({
    key: 'WINBACK_61_90', name: 'Reativação: novidades desde a última compra', category: 'REACTIVATION', track: 'REACTIVATION', funnelStage: 'REACTIVATION',
    objective: 'Reengajar quem está esfriando', description: 'Para quem comprou há 61–90 dias. Novidades só com prova.',
    allowedSegments: ['LAPSED_61_90D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [req('NEWNESS_EVIDENCE', false, 'Prova de novidade desde a última compra.')],
    primaryMetric: 'Retorno em 30 dias', whyNow: 'Última compra entre 61 e 90 dias: a relação está esfriando.',
    aiDirections: [
      dir('A', 'NOVIDADE DESDE A ÚLTIMA COMPRA', 'Apresentar novidade real.', 'Apresente novidade comprovada do input desde a última compra.', NEWNESS_FALLBACK('Reabra contato sem afirmar novidade.')),
      dir('B', 'RELEMBRE A DROSA', 'Reforçar a marca.', 'Reforce a marca e o convite a voltar, sem oferta.'),
      dir('C', 'CONVERSA', 'Abrir conversa.', 'Pergunte o que a cliente gostaria de encontrar.'),
    ],
  }),
  campaign({
    key: 'WINBACK_91_180', name: 'Reconquista (91–180 dias)', category: 'REACTIVATION', track: 'REACTIVATION', funnelStage: 'REACTIVATION',
    objective: 'Reconquistar clientes inativos', description: 'Para quem comprou há 91–180 dias. Nunca oferece desconto não configurado.',
    allowedSegments: ['LAPSED_91_180D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 30,
    requirements: [req('NEWNESS_EVIDENCE', false, 'Prova de novidade.')],
    primaryMetric: 'Retorno em 45 dias', whyNow: 'Última compra entre 91 e 180 dias: risco real de perder o cliente.',
    aiDirections: [
      dir('A', 'NOVIDADE', 'Apresentar novidade real.', 'Apresente novidade comprovada do input.', NEWNESS_FALLBACK('Reabra contato sem afirmar novidade.')),
      dir('B', 'RECONEXÃO', 'Reconectar com a marca.', `Reconecte com tom genuíno. ${NO_CLAIMS}`),
      dir('C', 'SENTIMOS SUA FALTA', 'Expressar cuidado.', 'Expresse cuidado sem pressão comercial e sem benefício não comprovado.'),
    ],
  }),
  campaign({
    key: 'WINBACK_181_365', name: 'Reativação forte (181–365 dias)', category: 'REACTIVATION', track: 'REACTIVATION', funnelStage: 'REACTIVATION',
    objective: 'Reativar antes de virar dormente', description: 'Para quem comprou há 181–365 dias.',
    allowedSegments: ['LAPSED_181_365D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 45,
    requirements: [req('NEWNESS_EVIDENCE', false, 'Prova de novidade.')],
    primaryMetric: 'Retorno em 60 dias', whyNow: 'Última compra entre 181 e 365 dias: última janela antes de o cliente ficar dormente.',
    aiDirections: [
      dir('A', 'MUITA COISA MUDOU', 'Apresentar mudanças reais.', 'Apresente mudanças reais do input.', NEWNESS_FALLBACK('Reabra o contato sem afirmar mudança.')),
      dir('B', 'RECOMEÇO', 'Convidar a recomeçar.', `Convide a recomeçar o relacionamento. ${NO_CLAIMS}`),
      dir('C', 'CONVERSA', 'Perguntar o motivo do afastamento.', 'Pergunte com respeito o que a loja pode fazer melhor, sem assumir a causa.'),
    ],
  }),
  campaign({
    key: 'DORMANT_REACTIVATION_365_PLUS', name: 'Reabertura de relacionamento (+365 dias)', category: 'REACTIVATION', track: 'REACTIVATION', funnelStage: 'REACTIVATION',
    objective: 'Reabrir o relacionamento com dormentes', description: 'Para quem não compra há mais de um ano.',
    allowedSegments: ['DORMANT_365D_PLUS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 60,
    requirements: [],
    primaryMetric: 'Retorno em 90 dias', whyNow: 'Sem compra há mais de 365 dias: o relacionamento precisa ser reaberto do zero.',
    aiDirections: [
      dir('A', 'REAPRESENTAÇÃO', 'Reapresentar a marca.', `Reapresente a marca com simplicidade. ${NO_CLAIMS}`),
      dir('B', 'CONVITE SEM PRESSÃO', 'Convidar sem pressão.', 'Convide a conhecer o catálogo atual sem pressão e sem afirmar novidade.'),
      dir('C', 'CONFIRMAR INTERESSE', 'Confirmar se ainda quer receber.', 'Pergunte se a cliente ainda deseja receber contatos e explique como ajustar preferências, sem prometer nada além disso.'),
    ],
  }),
  campaign({
    key: 'DORMANT_LAST_ENGAGEMENT', name: 'Última tentativa de reengajamento', category: 'REACTIVATION', track: 'REACTIVATION', funnelStage: 'REACTIVATION',
    objective: 'Confirmar interesse antes de reduzir o contato', description: 'Última tentativa antes de tratar o cliente como inativo no canal.',
    allowedSegments: ['DORMANT_365D_PLUS', 'LAPSED_181_365D'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 90,
    requirements: [],
    primaryMetric: 'Confirmação de interesse', whyNow: 'Depois de várias tentativas sem retorno, confirmar interesse protege a reputação do canal.',
    aiDirections: [
      dir('A', 'AINDA FAZ SENTIDO?', 'Confirmar interesse.', 'Pergunte de forma direta e cordial se a cliente ainda quer receber os e-mails.'),
      dir('B', 'ÚLTIMO CONVITE', 'Fazer um último convite.', `Faça um último convite cordial. ${NO_CLAIMS}`),
      dir('C', 'AJUSTE SUAS PREFERÊNCIAS', 'Explicar como ajustar.', 'Explique como ajustar preferências de contato, sem prometer nada além disso.'),
    ],
  }),

  // ── SEM COMPRA ─────────────────────────────────────────────────────────────────────────────
  campaign({
    key: 'FIRST_PURCHASE_DISCOVERY', name: 'Descoberta para a primeira compra', category: 'NO_PURCHASE', track: 'FIRST_PURCHASE', funnelStage: 'CONVERSION',
    objective: 'Gerar a primeira compra', description: 'Para quem está cadastrado mas nunca comprou. Sem desconto de primeira compra inventado.',
    allowedSegments: ['NO_PURCHASE_CUSTOMERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [req('CANDIDATE_PRODUCTS', false, 'Produtos reais para apresentar.')],
    primaryMetric: 'Primeira compra em 30 dias', whyNow: 'Cliente conhecido com e-mail que ainda não comprou.',
    aiDirections: [
      dir('A', 'BEM-VINDA', 'Apresentar a marca.', `Apresente a D'Rosa de forma acolhedora. ${NO_CLAIMS}`),
      dir('B', 'POR ONDE COMEÇAR', 'Dar um ponto de partida.', 'Sugira por onde começar, sem citar peça específica sem candidato real.', PRODUCT_FALLBACK('Sugira apenas explorar o catálogo.')),
      dir('C', 'AJUDA PARA ESCOLHER', 'Oferecer ajuda.', 'Ofereça ajuda da equipe para encontrar a primeira peça.'),
    ],
  }),
  campaign({
    key: 'ASSISTED_DISCOVERY', name: 'Descoberta assistida', category: 'NO_PURCHASE', track: 'FIRST_PURCHASE', funnelStage: 'CONSIDERATION',
    objective: 'Ajudar a encontrar o primeiro produto', description: 'Atendimento humano como caminho para a primeira compra.',
    allowedSegments: ['NO_PURCHASE_CUSTOMERS'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [],
    primaryMetric: 'Respostas ao convite', whyNow: 'Sem histórico de compra, uma conversa ajuda a entender o que a cliente procura.',
    aiDirections: [
      dir('A', 'FALE COM UMA CONSULTORA', 'Oferecer atendimento.', 'Ofereça conversar com a equipe, sem prometer prazo.'),
      dir('B', 'CONTE O QUE PROCURA', 'Ouvir a necessidade.', 'Pergunte o que a cliente procura.'),
      dir('C', 'DÚVIDAS FREQUENTES', 'Antecipar dúvidas.', 'Convide a tirar dúvidas comuns (tamanho, pagamento, entrega), sem afirmar políticas não fornecidas no input.'),
    ],
  }),

  // ── COMPORTAMENTAIS ────────────────────────────────────────────────────────────────────────
  campaign({
    key: 'CART_RECOVERY_EMAIL', name: 'Recuperação de carrinho por e-mail', category: 'BEHAVIORAL', track: 'CART_RECOVERY', funnelStage: 'CONVERSION',
    objective: 'Recuperar um carrinho abandonado', description: 'Para quem abandonou um checkout com e-mail nos últimos dias. Nunca afirma que o checkout ou o item continuam válidos/disponíveis.',
    allowedSegments: ['RECENT_CART_ABANDONER'], excludedSegments: [], recommendedCooldownDays: 3,
    requirements: [req('CART_RECOVERY_DATA', true, 'Checkout real com e-mail e link de recuperação.'), req('CANDIDATE_PRODUCTS', false, 'Item do carrinho verificado.')],
    primaryMetric: 'Carrinhos recuperados', whyNow: 'Carrinho abandonado recente: o interesse ainda está quente.',
    aiDirections: [
      dir('A', 'LEMBRETE DIRETO', 'Lembrar que o carrinho não foi concluído.', 'Informe objetivamente que um carrinho ficou sem finalizar. Não afirme que ele ou o item continuam válidos ou disponíveis.'),
      dir('B', 'AJUDA PARA FINALIZAR', 'Remover obstáculos.', 'Ofereça ajuda humana para destravar a compra; pergunte qual foi o obstáculo, nunca assuma.'),
      dir('C', 'O ITEM QUE VOCÊ ESCOLHEU', 'Reforçar o interesse pelo item.', 'Reforce o interesse pelo item escolhido citando apenas dados reais do input.', PRODUCT_FALLBACK('Reforce o interesse demonstrado sem citar item nem afirmar disponibilidade.')),
    ],
  }),
  campaign({
    key: 'BROWSE_RECOVERY', name: 'Recuperação de navegação', category: 'BEHAVIORAL', track: 'CART_RECOVERY', funnelStage: 'CONSIDERATION',
    objective: 'Recuperar interesse de quem navegou', description: 'Exige rastreamento de navegação por cliente, que ainda não existe.',
    allowedSegments: ['BROWSE_NO_PURCHASE'], excludedSegments: [], recommendedCooldownDays: 7,
    requirements: [req('BROWSE_TRACKING', true, 'Rastreamento de produtos visualizados por cliente.')],
    primaryMetric: 'Retorno ao produto visto', whyNow: 'Navegação recente indica interesse — quando existe rastreamento.',
    aiDirections: [
      dir('A', 'VOCÊ VIU', 'Lembrar do produto visto.', 'Lembre o produto visto citando só o dado real do input.', PRODUCT_FALLBACK('Não afirme que a cliente viu algo.')),
      dir('B', 'AJUDA', 'Oferecer ajuda.', 'Ofereça ajuda para escolher.'),
      dir('C', 'MAIS OPÇÕES', 'Sugerir opções.', 'Sugira ver mais opções reais do input.', PRODUCT_FALLBACK('Convide a conhecer o catálogo.')),
    ],
  }),
  campaign({
    key: 'BACK_IN_STOCK', name: 'De volta ao estoque', category: 'BEHAVIORAL', track: 'CART_RECOVERY', funnelStage: 'CONVERSION',
    objective: 'Avisar quem pediu para ser avisado', description: 'Exige inscrição de interesse e estoque comprovado — nenhum dos dois existe.',
    allowedSegments: ['BROWSE_NO_PURCHASE'], excludedSegments: [], recommendedCooldownDays: 7,
    requirements: [req('STOCK_INTEREST_SUBSCRIPTION', true, 'Inscrição de interesse por produto.'), req('RESTOCK_EVIDENCE', true, 'Estoque comprovado do produto.')],
    primaryMetric: 'Compra após o aviso', whyNow: 'Quem pediu aviso de reposição é um contato de altíssima intenção — quando existe inscrição.',
    aiDirections: [
      dir('A', 'ELE VOLTOU', 'Avisar a volta.', 'Avise a volta do produto citando só o dado real do input.', PRODUCT_FALLBACK('Não afirme reposição.')),
      dir('B', 'VOCÊ PEDIU PARA SER AVISADA', 'Cumprir o aviso.', 'Cumpra o aviso combinado sem afirmar quantidade.', PRODUCT_FALLBACK('Não afirme reposição.')),
      dir('C', 'CONFIRA', 'Convidar a conferir.', `Convide a conferir. ${NO_CLAIMS}`),
    ],
  }),
  campaign({
    key: 'CATEGORY_AFFINITY', name: 'Afinidade de categoria', category: 'BEHAVIORAL', track: 'REPEAT_ACTIVE', funnelStage: 'CONSIDERATION',
    objective: 'Comunicar pela categoria de maior interesse', description: 'Exige categoria derivável com segurança — hoje não existe.',
    allowedSegments: ['CATEGORY_AFFINITY'], excludedSegments: ['RECENT_CART_ABANDONER'], recommendedCooldownDays: 21,
    requirements: [req('CATEGORY_DATA', true, 'Categoria derivada de itens comprados.'), req('CANDIDATE_PRODUCTS', true, 'Produtos reais da categoria.')],
    primaryMetric: 'Compra na categoria de afinidade', whyNow: 'Comunicar pela categoria de interesse aumenta a relevância — quando a categoria é conhecida.',
    aiDirections: [
      dir('A', 'A CATEGORIA QUE VOCÊ MAIS COMPRA', 'Falar da categoria de afinidade.', 'Fale da categoria comprovada do input.', CATEGORY_FALLBACK('Convide a conhecer o catálogo.')),
      dir('B', 'PEÇAS DA CATEGORIA', 'Mostrar peças reais.', 'Mostre peças reais do input.', PRODUCT_FALLBACK('Convide a conhecer o catálogo.')),
      dir('C', 'CONVERSA', 'Perguntar preferências.', 'Pergunte que tipo de peça a cliente procura.'),
    ],
  }),
]

export function listEmailCampaigns(): EmailCampaignDefinition[] { return CAMPAIGNS }

export function getEmailCampaign(key: string): EmailCampaignDefinition | null {
  return CAMPAIGNS.find(c => c.key === key) ?? null
}

// Só requisitos HARD ausentes impedem a campanha (NEEDS_DATA). Requisito soft
// ausente só degrada as direções (fallback honesto) — a campanha continua
// gerável.
export type CampaignReadiness = 'READY' | 'NEEDS_DATA'
export interface CampaignReadinessResult {
  status: CampaignReadiness
  missingHard: CampaignRequirement[]
  missingSoft: CampaignRequirement[]
}

export function evaluateCampaignReadiness(def: EmailCampaignDefinition, capabilities: Record<RequirementKey, DataCapability> = EMAIL_DATA_CAPABILITIES): CampaignReadinessResult {
  const missing = def.requirements.filter(r => !capabilities[r.key]?.available)
  const missingHard = missing.filter(r => r.hard)
  return { status: missingHard.length ? 'NEEDS_DATA' : 'READY', missingHard, missingSoft: missing.filter(r => !r.hard) }
}

// Flags de evidência que o pipeline de IA de e-mail enxerga — derivadas das
// capacidades REAIS, nunca do nome da campanha. Nenhum e-mail/cliente entra
// aqui: só booleanos.
export function evidenceFlagsFromCapabilities(capabilities: Record<RequirementKey, DataCapability> = EMAIL_DATA_CAPABILITIES): EvidenceFlags {
  return {
    hasCandidateProducts: capabilities.CANDIDATE_PRODUCTS.available,
    hasCategoryEvidence: capabilities.CATEGORY_DATA.available,
    hasStockEvidence: capabilities.RESTOCK_EVIDENCE.available,
    hasNewnessEvidence: capabilities.NEWNESS_EVIDENCE.available,
    hasPaymentExpiryEvidence: false,
    hasSecondCopySupport: false,
    hasPromotionEvidence: false,
    hasRecoveryUrlEvidence: false,
  }
}
