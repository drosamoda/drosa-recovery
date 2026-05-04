import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  NUVEMSHOP_STORE_ID: z.string().min(1, 'NUVEMSHOP_STORE_ID é obrigatório'),
  NUVEMSHOP_ACCESS_TOKEN: z.string().default(''),
  NUVEMSHOP_CLIENT_ID: z.string().default(''),
  NUVEMSHOP_CLIENT_SECRET: z.string().default(''),
  NUVEMSHOP_USER_AGENT: z.string().default('DrosaRecovery (contato@drosamoda.com.br)'),
  NUVEMSHOP_API_VERSION: z.string().default('v1'),
  WEBHOOK_SECRET: z.string().default(''),

  META_ACCESS_TOKEN: z.string().min(1, 'META_ACCESS_TOKEN é obrigatório'),
  META_PHONE_NUMBER_ID: z.string().min(1, 'META_PHONE_NUMBER_ID é obrigatório'),
  META_API_VERSION: z.string().default('v20.0'),
  META_VERIFY_TOKEN: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_REQUEST_TIMEOUT_MS: z.coerce.number().default(8000),

  ADMIN_SECRET: z.string().min(1, 'ADMIN_SECRET é obrigatório'),
  JOBS_SECRET: z.string().min(1, 'JOBS_SECRET é obrigatório'),

  ORDER_CONFIRMATION_TEMPLATE: z.string().default('confirmacao_pedido_drosa'),
  ABANDONED_CART_TEMPLATE: z.string().default('carrinho_abandonado_drosa_01'),
  GRUPO_VIP_LINK: z.string().default('https://chat.whatsapp.com/GTb6T94rZciFXY94C0mGug'),

  CHECKOUT_BASE_URL: z.string().default('https://www.drosamoda.com.br/checkout/'),

  DEFAULT_COUNTRY_CODE: z.string().default('55'),
  MAX_RETRY_ATTEMPTS: z.coerce.number().default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().default(1000),
  MESSAGES_BATCH_SIZE: z.coerce.number().default(20),
  MESSAGE_SEND_DELAY_MS: z.coerce.number().default(250),

  CRON_ABANDONED_CART_INTERVAL: z.coerce.number().default(15),
  CRON_PROCESS_MESSAGES_INTERVAL: z.coerce.number().default(1),
  CRON_BOLETO_EXPIRING_INTERVAL: z.coerce.number().default(60),
  ABANDONED_CART_LOOKBACK_HOURS: z.coerce.number().default(2),
  // Horas após o pedido para disparar mensagem de boleto vencendo (padrão: 48h = 2 dias)
  BOLETO_NOTIFY_HOURS: z.coerce.number().default(48),

  SENTRY_DSN: z.string().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1),

  // Quando true, processMessages monta o payload mas NÃO chama a Meta Cloud API.
  // Marca a mensagem como sent com reason=dry_run. Útil para homologação local.
  WHATSAPP_DRY_RUN: z.string().default('false').transform((v) => v === 'true'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
