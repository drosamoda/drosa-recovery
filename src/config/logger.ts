// Chaves cujos valores são redactados em qualquer nível do log
const SENSITIVE_KEYS = new Set([
  'authorization',
  'meta_access_token',
  'nuvemshop_access_token',
  'admin_secret',
  'jobs_secret',
  'webhook_secret',
  'meta_app_secret',
  'x-admin-secret',
  'x-jobs-secret',
  'x-hub-signature-256',
  'x-linkedstore-hmac-sha256',
  'password',
  'token',
  'secret',
])

function sanitize(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return obj
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) return obj.map((v) => sanitize(v, depth + 1))

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]'
    } else {
      result[key] = sanitize(value, depth + 1)
    }
  }
  return result
}

type LogMeta = Record<string, unknown>

function formatEntry(level: string, msg: string, meta?: LogMeta): string {
  return JSON.stringify({
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...(meta ? sanitize(meta) as object : {}),
  })
}

export const logger = {
  info(msg: string, meta?: LogMeta): void {
    console.log(formatEntry('info', msg, meta))
  },

  warn(msg: string, meta?: LogMeta): void {
    console.warn(formatEntry('warn', msg, meta))
  },

  error(msg: string, err?: unknown, meta?: LogMeta): void {
    const errMeta: LogMeta = {
      ...(meta ?? {}),
      error:
        err instanceof Error
          ? { message: err.message, name: err.name }
          : String(err ?? ''),
    }
    console.error(formatEntry('error', msg, errMeta))
  },

  debug(msg: string, meta?: LogMeta): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatEntry('debug', msg, meta))
    }
  },
}
