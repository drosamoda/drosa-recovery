import axios, { AxiosError } from 'axios'
import { env } from '../config/env'
import { logger } from '../config/logger'

// Parâmetros para envio de template
export type SendTemplateParams = {
  to: string
  templateName: string
  languageCode?: string
  bodyParams?: string[]
  buttonUrlParam?: string
}

export type SendTemplateResult = {
  success: boolean
  metaMessageId?: string
  response?: object
  errorCode?: string
  errorType?: 'temporary' | 'permanent'
  reason?: string
  uncertain?: boolean
}

export type SendTextMessageParams = {
  to: string
  text: string
  contextMessageId?: string
}

export type SendTextMessageResult = SendTemplateResult

// Códigos de erro Meta classificados como temporários (retry faz sentido)
const TEMPORARY_ERROR_CODES = new Set([131056, 130429])

// Códigos de erro Meta classificados como permanentes (não tentar novamente)
const PERMANENT_ERROR_CODES = new Set([132000, 132001, 131030, 100])

function classifyMetaErrorCode(code?: number): 'temporary' | 'permanent' {
  if (!code) return 'temporary'
  if (TEMPORARY_ERROR_CODES.has(code)) return 'temporary'
  if (PERMANENT_ERROR_CODES.has(code)) return 'permanent'
  return 'temporary'
}

function classifyHttpStatus(status: number): 'temporary' | 'permanent' {
  if ([429, 500, 502, 503, 504].includes(status)) return 'temporary'
  return 'permanent'
}

function buildComponents(
  bodyParams?: string[],
  buttonUrlParam?: string
): object[] {
  const components: object[] = []

  if (bodyParams && bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text })),
    })
  }

  if (buttonUrlParam) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: buttonUrlParam }],
    })
  }

  return components
}

export const whatsappService = {
  async sendImageMessage(_params: {
    to: string; fileBuffer: Buffer; mimeType: string; caption?: string;
    contextMessageId?: string; fileName?: string;
  }): Promise<SendTemplateResult & { mediaId?: string }> {
    // This checkout contains the Inbox caller but no validated media transport.
    // Keep it explicit and fail closed until that transport has been reviewed.
    return { success: false, errorType: 'permanent', reason: 'image_transport_not_configured' }
  },
  async sendTextMessage(params: SendTextMessageParams): Promise<SendTextMessageResult> {
    const { to, text } = params

    const url = `https://graph.facebook.com/${env.META_API_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      ...(params.contextMessageId ? { context: { message_id: params.contextMessageId } } : {}),
      text: {
        preview_url: false,
        body: text,
      },
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: env.META_REQUEST_TIMEOUT_MS,
      })

      const metaMessageId =
        response.data?.messages?.[0]?.id ?? undefined

      return {
        success: true,
        metaMessageId,
        response: response.data,
      }
    } catch (err) {
      if (err instanceof AxiosError) {
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          return {
            success: false,
            errorType: 'permanent',
            reason: 'delivery_unknown',
            errorCode: err.code,
            uncertain: true,
          }
        }

        if (!err.response && err.request) {
          return { success: false, errorType: 'permanent', reason: 'delivery_unknown', errorCode: err.code ?? 'network_error', uncertain: true }
        }
        const status = err.response?.status
        const errorData = err.response?.data?.error
        const metaCode: number | undefined = errorData?.code
        const errorType = metaCode
          ? classifyMetaErrorCode(metaCode)
          : status
            ? classifyHttpStatus(status)
            : 'temporary'

        logger.error('[whatsapp] erro ao enviar texto manual', undefined, {
          httpStatus: status ?? 'N/A',
          metaCode: metaCode ?? 'N/A',
          message: errorData?.message ?? err.message,
        })

        return {
          success: false,
          errorType,
          errorCode: metaCode ? String(metaCode) : String(status ?? 'unknown'),
          reason: errorData?.message ?? err.message,
          response: err.response?.data,
        }
      }

      return {
        success: false,
        errorType: 'temporary',
        reason: 'unexpected_error',
        errorCode: 'unknown',
      }
    }
  },

  async sendTemplateMessage(params: SendTemplateParams): Promise<SendTemplateResult> {
    const { to, templateName, languageCode = 'pt_BR', bodyParams, buttonUrlParam } = params

    const url = `https://graph.facebook.com/${env.META_API_VERSION}/${env.META_PHONE_NUMBER_ID}/messages`

    const components = buildComponents(bodyParams, buttonUrlParam)

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    }

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: env.META_REQUEST_TIMEOUT_MS,
      })

      const metaMessageId =
        response.data?.messages?.[0]?.id ?? undefined

      return {
        success: true,
        metaMessageId,
        response: response.data,
      }
    } catch (err) {
      if (err instanceof AxiosError) {
        // Timeout de rede
        if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          return {
            success: false,
            errorType: 'permanent',
            reason: 'delivery_unknown',
            errorCode: err.code,
            uncertain: true,
          }
        }

        if (!err.response && err.request) {
          return { success: false, errorType: 'permanent', reason: 'delivery_unknown', errorCode: err.code ?? 'network_error', uncertain: true }
        }
        const status = err.response?.status
        const errorData = err.response?.data?.error

        const metaCode: number | undefined = errorData?.code
        const errorType = metaCode
          ? classifyMetaErrorCode(metaCode)
          : status
            ? classifyHttpStatus(status)
            : 'temporary'

        logger.error('[whatsapp] erro ao enviar mensagem', {
          httpStatus: status ?? 'N/A',
          metaCode: metaCode ?? 'N/A',
          message: errorData?.message ?? err.message,
        })

        return {
          success: false,
          errorType,
          errorCode: metaCode ? String(metaCode) : String(status ?? 'unknown'),
          reason: errorData?.message ?? err.message,
          response: err.response?.data,
        }
      }

      return {
        success: false,
        errorType: 'temporary',
        reason: 'unexpected_error',
        errorCode: 'unknown',
      }
    }
  },
}
