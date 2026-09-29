import { OAuth2Client } from 'google-auth-library'

// Autenticação OIDC dos jobs: o Cloud Scheduler assina um ID token com a service
// account dedicada; aqui a assinatura e os claims são VERIFICADOS (nunca só
// decodificados). Sem segredo da aplicação guardado no Scheduler.
export interface OidcClaims {
  iss?: string
  aud?: string | string[]
  email?: string
  email_verified?: boolean
  exp?: number
}

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

const client = new OAuth2Client()

// Verifica assinatura (chaves públicas do Google, com cache da biblioteca),
// expiração e audience. Lança em qualquer falha.
export async function verifyGoogleIdToken(idToken: string, audience: string): Promise<OidcClaims> {
  const ticket = await client.verifyIdToken({ idToken, audience })
  return (ticket.getPayload() ?? {}) as OidcClaims
}

// Decisão de autorização sobre claims já verificados. Fail closed.
export function isAllowedOidcIdentity(
  claims: OidcClaims,
  policy: { audience: string; allowedServiceAccounts: string[] },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!policy.audience || policy.allowedServiceAccounts.length === 0) return false
  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) return false
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : []
  if (!aud.includes(policy.audience)) return false
  if (claims.email_verified !== true || !claims.email) return false
  if (!policy.allowedServiceAccounts.includes(claims.email.toLowerCase())) return false
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return false
  return true
}
