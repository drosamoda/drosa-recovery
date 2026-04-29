import * as Sentry from '@sentry/node'
import { env } from './env'
import { logger } from './logger'

const SENSITIVE_PATTERNS = [
  /bearer\s+\S+/gi,
  /authorization['":\s]+['"]?\S+/gi,
]

function sanitizeEventData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const str = JSON.stringify(data)
  const clean = SENSITIVE_PATTERNS.reduce(
    (s, re) => s.replace(re, '[REDACTED]'),
    str
  )
  try {
    return JSON.parse(clean)
  } catch {
    return data
  }
}

export function initSentry(): void {
  if (!env.SENTRY_DSN) {
    logger.debug('[sentry] SENTRY_DSN não configurado — monitoramento desativado')
    return
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    beforeSend(event) {
      // Sanitiza request data para não enviar headers sensíveis
      if (event.request?.headers) {
        event.request.headers = sanitizeEventData(event.request.headers) as typeof event.request.headers
      }
      if (event.request?.data) {
        event.request.data = sanitizeEventData(event.request.data) as typeof event.request.data
      }
      return event
    },
  })

  logger.info('[sentry] Inicializado', { environment: env.SENTRY_ENVIRONMENT })
}

export function captureError(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(sanitizeEventData(context) as Record<string, unknown>)
      Sentry.captureException(err)
    })
  } else {
    logger.error('[sentry] captureError (sem DSN)', err, context)
  }
}
