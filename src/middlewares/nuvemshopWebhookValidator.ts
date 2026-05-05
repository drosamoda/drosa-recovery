import { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '../config/env'
import { logger } from '../config/logger'

type WebhookSecret = {
  name: 'NUVEMSHOP_CLIENT_SECRET' | 'WEBHOOK_SECRET'
  value: string
}

function getConfiguredSecrets(): WebhookSecret[] {
  return [
    { name: 'NUVEMSHOP_CLIENT_SECRET' as const, value: env.NUVEMSHOP_CLIENT_SECRET },
    { name: 'WEBHOOK_SECRET' as const, value: env.WEBHOOK_SECRET },
  ].filter((item) => item.value)
}

function getSignature(req: Request): string | undefined {
  return (
    (req.headers['x-linkedstore-hmac-sha256'] as string | undefined) ??
    (req.headers['http_x_linkedstore_hmac_sha256'] as string | undefined) ??
    (req.headers['x-tiendanube-hmac-sha256'] as string | undefined)
  )
}

function relevantHeaders(req: Request): Record<string, boolean> {
  return {
    linkedstoreHmacSha256: req.headers['x-linkedstore-hmac-sha256'] !== undefined,
    httpLinkedstoreHmacSha256: req.headers['http_x_linkedstore_hmac_sha256'] !== undefined,
    tiendanubeHmacSha256: req.headers['x-tiendanube-hmac-sha256'] !== undefined,
    linkedstoreTopic: req.headers['x-linkedstore-topic'] !== undefined,
    contentType: req.headers['content-type'] !== undefined,
    userAgent: req.headers['user-agent'] !== undefined,
  }
}

function logRejected(req: Request, reason: string, extra?: Record<string, unknown>): void {
  logger.warn('[nuvemshop] webhook rejeitado', {
    reason,
    headersPresent: relevantHeaders(req),
    rawBodyLength: req.rawBody?.length ?? 0,
    ...(extra ?? {}),
  })
}

function safeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

function isValidSignature(rawBody: string, signature: string, secrets: WebhookSecret[]): boolean {
  return secrets.some((secret) => {
    const expectedHex = createHmac('sha256', secret.value).update(rawBody, 'utf8').digest('hex')
    const expectedBase64 = createHmac('sha256', secret.value).update(rawBody, 'utf8').digest('base64')

    return safeCompare(signature, expectedHex) || safeCompare(signature, expectedBase64)
  })
}

function buildInvalidSignatureDiagnostics(
  req: Request,
  rawBody: string,
  signature: string,
  secrets: WebhookSecret[]
): Record<string, unknown> {
  const diagnosticSecret =
    secrets.find((secret) => secret.name === 'WEBHOOK_SECRET') ?? secrets.find((secret) => secret.value)
  const secretValue = diagnosticSecret?.value ?? ''
  const expected = secretValue
    ? createHmac('sha256', secretValue).update(rawBody, 'utf8').digest('hex')
    : ''

  return {
    hasSecret: Boolean(secretValue),
    secretLength: secretValue.length,
    secretStart: secretValue.slice(0, 3),
    secretEnd: secretValue.slice(-3),
    rawBodyLength: rawBody.length,
    signatureLength: signature.length,
    expectedLength: expected.length,
    signatureStart: signature.slice(0, 8),
    expectedStart: expected.slice(0, 8),
    contentType: req.headers['content-type'] ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    configuredSecrets: secrets.map((item) => item.name),
  }
}

export function nuvemshopWebhookValidator(req: Request, res: Response, next: NextFunction): void {
  const secrets = getConfiguredSecrets()

  if (secrets.length === 0) {
    if (env.NODE_ENV === 'development') {
      logger.warn('[nuvemshop] nenhum secret de webhook configurado - bypass em desenvolvimento')
      next()
      return
    }

    logRejected(req, 'secret_missing')
    res.status(401).json({ error: 'Webhook nao autorizado', reason: 'secret_missing' })
    return
  }

  const signature = getSignature(req)
  if (!signature) {
    logRejected(req, 'signature_missing')
    res.status(401).json({ error: 'Assinatura ausente', reason: 'signature_missing' })
    return
  }

  const rawBody = req.rawBody
  if (!rawBody) {
    logRejected(req, 'raw_body_missing', { signatureLength: signature.length })
    res.status(401).json({ error: 'Body invalido para assinatura', reason: 'raw_body_missing' })
    return
  }

  if (!isValidSignature(rawBody, signature, secrets)) {
    logRejected(req, 'signature_invalid', buildInvalidSignatureDiagnostics(req, rawBody, signature, secrets))
    res.status(401).json({ error: 'Assinatura invalida', reason: 'signature_invalid' })
    return
  }

  next()
}
