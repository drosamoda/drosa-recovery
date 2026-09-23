import { env } from '../config/env'
import { EmailProviderAdapter } from './emailProviderAdapter'
import { ResendEmailProvider } from './resendEmailProvider'

export function isEmailProviderConfigured(): boolean {
  return env.EMAIL_PROVIDER === 'resend'
    && env.RESEND_API_KEY.trim() !== ''
    && env.RESEND_WEBHOOK_SECRET.trim() !== ''
}

export function getEmailProviderAdapter(): EmailProviderAdapter | null {
  if (!isEmailProviderConfigured()) return null

  return new ResendEmailProvider({
    apiKey: env.RESEND_API_KEY,
    webhookSecret: env.RESEND_WEBHOOK_SECRET,
  })
}
