import 'dotenv/config'
import { z } from 'zod'

// Modo somente-leitura para ambientes de Preview: dispensa integrações
// operacionais (Meta/Nuvemshop/admin/jobs) no boot, exigindo apenas o
// necessário para servir dados reais via /crm-api. Lido diretamente de
// process.env porque precisa decidir o formato do schema abaixo.
const isPreviewReadOnly = process.env.CRM_PREVIEW_READONLY === 'true'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().default(''),

  CRM_PREVIEW_READONLY: z.string().default('false').transform((v) => v === 'true'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DIRECT_URL: isPreviewReadOnly
    ? z.string().min(1, 'DIRECT_URL é obrigatória em CRM_PREVIEW_READONLY')
    : z.string().default(''),

  NUVEMSHOP_STORE_ID: isPreviewReadOnly
    ? z.string().default('')
    : z.string().min(1, 'NUVEMSHOP_STORE_ID é obrigatório'),
  NUVEMSHOP_ACCESS_TOKEN: z.string().default(''),
  NUVEMSHOP_CLIENT_ID: z.string().default(''),
  NUVEMSHOP_CLIENT_SECRET: z.string().default(''),
  NUVEMSHOP_USER_AGENT: z.string().default('DrosaRecovery (contato@drosamoda.com.br)'),
  NUVEMSHOP_API_VERSION: z.string().default('v1'),
  WEBHOOK_SECRET: z.string().default(''),

  META_ACCESS_TOKEN: isPreviewReadOnly
    ? z.string().default('')
    : z.string().min(1, 'META_ACCESS_TOKEN é obrigatório'),
  META_PHONE_NUMBER_ID: isPreviewReadOnly
    ? z.string().default('')
    : z.string().min(1, 'META_PHONE_NUMBER_ID é obrigatório'),
  META_API_VERSION: z.string().default('v20.0'),
  META_VERIFY_TOKEN: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_REQUEST_TIMEOUT_MS: z.coerce.number().default(8000),

  ADMIN_SECRET: isPreviewReadOnly
    ? z.string().default('')
    : z.string().min(1, 'ADMIN_SECRET é obrigatório'),
  JOBS_SECRET: isPreviewReadOnly
    ? z.string().default('')
    : z.string().min(1, 'JOBS_SECRET é obrigatório'),
  INBOX_ADMIN_SECRET: z.string().default(''),
  CRM_READ_SECRET: isPreviewReadOnly
    ? z.string().min(1, 'CRM_READ_SECRET é obrigatória em CRM_PREVIEW_READONLY')
    : z.string().default(''),
  INBOX_SEND_DRY_RUN: z.string().default('false').transform((v) => v === 'true'),

  ORDER_CONFIRMATION_TEMPLATE: z.string().default('confirmacao_pedido_drosa'),
  ABANDONED_CART_TEMPLATE: z.string().default('carrinho_abandonado_drosa_v2'),
  GRUPO_VIP_LINK: z.string().default('https://chat.whatsapp.com/GTb6T94rZciFXY94C0mGug'),

  CHECKOUT_BASE_URL: z.string().default('https://www.drosamoda.com.br/checkout/'),

  DEFAULT_COUNTRY_CODE: z.string().default('55'),
  MAX_RETRY_ATTEMPTS: z.coerce.number().default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().default(1000),
  MESSAGES_BATCH_SIZE: z.coerce.number().default(20),
  MESSAGE_SEND_DELAY_MS: z.coerce.number().default(250),

  ENABLE_INTERNAL_CRON: z.string().default('false').transform((v) => v === 'true'),
  ABANDONED_CART_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  REMARKETING_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  ABANDONED_CART_MAX_SENDS_PER_RUN: z.coerce.number().int().min(0).default(1),
  ABANDONED_CART_DELAY_MINUTES: z.coerce.number().int().min(0).default(30),
  ABANDONED_CART_COOLDOWN_HOURS: z.coerce.number().positive().default(24),
  ABANDONED_CART_PREVIEW_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  PREVIEW_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
  ABANDONED_CART_MAX_AGE_HOURS: z.coerce.number().positive().default(168),
  ABANDONED_CART_OVERLAP_HOURS: z.coerce.number().positive().default(72),
  REMARKETING_MAX_SENDS_PER_RUN: z.coerce.number().int().min(0).default(1),
  REMARKETING_GLOBAL_COOLDOWN_HOURS: z.coerce.number().positive().default(24),
  REMARKETING_RECENT_CUSTOMER_DAYS: z.coerce.number().int().positive().default(30),
  REMARKETING_INACTIVE_DAYS: z.coerce.number().int().positive().default(90),
  VIP_MIN_ORDERS: z.coerce.number().int().positive().default(3),
  VIP_MIN_SPEND: z.coerce.number().positive().default(500),
  MARKETING_SEND_HOUR_START: z.coerce.number().int().min(0).max(23).default(9),
  MARKETING_SEND_HOUR_END: z.coerce.number().int().min(1).max(24).default(20),
  MESSAGE_CLAIM_LEASE_SECONDS: z.coerce.number().int().min(30).default(300),

  CRON_ABANDONED_CART_INTERVAL: z.coerce.number().default(15),
  CRON_PROCESS_MESSAGES_INTERVAL: z.coerce.number().default(1),
  CRON_BOLETO_EXPIRING_INTERVAL: z.coerce.number().default(60),
  ABANDONED_CART_LOOKBACK_HOURS: z.coerce.number().default(2),
  // Horas após o pedido para disparar mensagem de boleto vencendo (padrão: 48h = 2 dias)
  BOLETO_NOTIFY_HOURS: z.coerce.number().default(48),

  SENTRY_DSN: z.string().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1),

  // Opt-out seguro: envio real exige configuração explícita como false.
  WHATSAPP_DRY_RUN: z.string().default('true').transform((v) => v === 'true'),
  AUTOMATION_SEND_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  WHATSAPP_API_NUMBER: z.string().default(''),
  META_WABA_ID: z.string().default(''),

  // AI Campaign Intelligence — server-side only, nunca exposto ao browser.
  // Ausência da API key do provedor selecionado não derruba o boot: bloqueia
  // só a geração de campanhas (AiProviderConfigError), preservando as 7
  // áreas existentes. A escolha de provedor é sempre explícita via
  // AI_PROVIDER — sem fallback automático entre eles nesta fase.
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'groq']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-5'),
  // Groq — terceiro provedor independente, API compatível com a da OpenAI
  // (mesmo SDK `openai`, só com baseURL trocada). Mesma regra dos outros
  // dois: sem fallback automático, sem chave = geração indisponível.
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),

  // Final Pre-Activation Readiness — banco isolado para campaign_drafts/
  // ai_runs. Vazio = não configurado = geração de campanha fica indisponível
  // (503 AI_DATABASE_NOT_CONFIGURED), nunca cai de volta para gravar no
  // DATABASE_URL do Preview. Nenhuma migração é aplicada por esta variável
  // existir — ela só passa a ser lida quando alguém a configurar de propósito.
  AI_DATABASE_URL: z.string().default(''),

  // Email Campaign Intelligence — envio real de e-mail NÃO existe nesta fase:
  // não há provedor de e-mail, fonte de consentimento, histórico de envio nem
  // lista de descadastro/supressão. Esta flag é só uma das condições do gate
  // fail-closed (emailSendGate.ts) — mesmo `true`, o gate continua fechado
  // enquanto as outras quatro condições não existirem. Default false.
  EMAIL_SEND_ENABLED: z.string().default('false').transform((v) => v === 'true'),

  // Controles pagos — nenhum provedor de IA é chamado sem estes limites
  // explícitos. Aplicados igualmente aos dois provedores (nunca um limite
  // "especial" para OpenAI ou Anthropic).
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  AI_MAX_CONCURRENT_GENERATIONS: z.coerce.number().int().positive().default(2),
  AI_GENERATION_MAX_PER_MINUTE: z.coerce.number().int().positive().default(10),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
