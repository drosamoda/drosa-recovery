import { Request, Response, Router } from 'express'
import { logger } from '../config/logger'
import { createFailureRateLimiter } from '../helpers/failureRateLimiter'
import { suppressEmailByHash } from '../services/emailSuppressionService'
import { UNSUBSCRIBE_PATH, UnsubscribeTokenPayload, verifyUnsubscribeToken } from '../services/emailUnsubscribeToken'

// Descadastro de e-mail — rota PÚBLICA (o destinatário não tem login), protegida
// pela assinatura do token. Monta em /unsubscribe/email.
//   GET  ?t=<token>  → página de confirmação. NÃO altera nada: scanners de
//                      segurança e pré-visualizadores de e-mail fazem GET em
//                      todo link e não podem descadastrar ninguém sozinhos.
//   POST ?t=<token>  → executa o descadastro. É o que os clientes de e-mail
//                      chamam no One-Click (RFC 8058, corpo
//                      "List-Unsubscribe=One-Click") e o que o botão da página envia.
// Nunca loga e-mail, hash nem token; a resposta nunca ecoa dado do token.
//
// Rate limit — SÓ sobre tentativas INVÁLIDAS, nunca sobre token válido. Motivo:
// o One-Click do Gmail/Yahoo sai de poucos IPs de servidor; um teto por IP sobre
// todas as requisições derrubaria descadastros legítimos no meio de um envio, e
// descadastro precisa ser sempre honrado. O token válido é verificado ANTES e
// passa direto. Passadas as falhas permitidas na janela, o inválido leva 429.
// A chave é req.ip: sem `trust proxy` atrás de um balanceador todos dividem a
// mesma chave — o pior caso é o INVÁLIDO tomar 429 mais cedo, nunca um válido
// ser barrado. Estado em memória por instância (defesa em profundidade; a
// barreira real é a assinatura do token, que 256 bits tornam inviável de forçar).
export const UNSUBSCRIBE_MAX_INVALID_PER_WINDOW = 20
export const UNSUBSCRIBE_INVALID_WINDOW_MS = 60_000

const invalidTokenLimiter = createFailureRateLimiter({
  maxFailures: UNSUBSCRIBE_MAX_INVALID_PER_WINDOW,
  windowMs: UNSUBSCRIBE_INVALID_WINDOW_MS,
})

// Só para testes: limpa os contadores entre casos.
export function resetUnsubscribeInvalidTokenLimiter(): void {
  invalidTokenLimiter.reset()
}

const router = Router()

const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
}

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}button{font:inherit;padding:.6rem 1.2rem;cursor:pointer}</style>
</head>
<body>
<h1>${title}</h1>
${bodyHtml}
</body>
</html>`
}

function send(res: Response, status: number, html: string): void {
  res.status(status).set(PAGE_HEADERS).type('html').send(html)
}

type TokenCheck = { ok: true; payload: UnsubscribeTokenPayload; token: string } | { ok: false }

// Responde o erro e devolve ok=false; devolve o payload quando o token é válido.
function checkToken(req: Request, res: Response): TokenCheck {
  const token: unknown = req.query.t
  const verification = verifyUnsubscribeToken(token)
  if (verification.ok) return { ok: true, payload: verification.payload, token: token as string }

  if (verification.reason === 'SECRET_NOT_CONFIGURED') {
    // Falha nossa, não do cliente: não conta como tentativa inválida.
    send(res, 503, page('Serviço indisponível', '<p>O descadastro está temporariamente indisponível. Tente novamente mais tarde.</p>'))
    return { ok: false }
  }

  const state = invalidTokenLimiter.hit(req.ip ?? 'unknown')
  if (state.limited) {
    res.set('Retry-After', String(state.retryAfterSeconds))
    send(res, 429, page('Muitas tentativas', '<p>Recebemos muitas tentativas com links inválidos. Aguarde um minuto e use o link do seu e-mail.</p>'))
  } else {
    send(res, 400, page('Link inválido', '<p>Este link de descadastro é inválido ou está incompleto.</p>'))
  }
  return { ok: false }
}

router.get('/', (req: Request, res: Response) => {
  const check = checkToken(req, res)
  if (!check.ok) return
  const action = `${UNSUBSCRIBE_PATH}?t=${encodeURIComponent(check.token)}`
  send(
    res,
    200,
    page(
      'Cancelar inscrição',
      `<p>Confirme para parar de receber e-mails de marketing da D'Rosa Moda.</p>
<form method="post" action="${action}">
<input type="hidden" name="List-Unsubscribe" value="One-Click">
<button type="submit">Confirmar descadastro</button>
</form>`,
    ),
  )
})

router.post('/', async (req: Request, res: Response) => {
  const check = checkToken(req, res)
  if (!check.ok) return
  const { emailHash, sendId, issuedAt } = check.payload

  let result: Awaited<ReturnType<typeof suppressEmailByHash>>
  try {
    result = await suppressEmailByHash({
      emailHash,
      reason: 'UNSUBSCRIBE',
      evidenceRef: `unsubscribe-link:${sendId ?? 'na'}:${Math.floor(issuedAt.getTime() / 1000)}`,
    })
  } catch (error) {
    // Rota pública: nunca deixa o handler padrão do Express responder (fora de
    // produção ele devolve a stack trace). Só o NOME do erro vai para o log — a
    // mensagem de um erro de banco pode carregar valores da consulta.
    logger.error('[email/unsubscribe] falha ao registrar descadastro', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    send(res, 500, page('Erro temporário', '<p>Não conseguimos concluir agora. Tente novamente em instantes.</p>'))
    return
  }
  // Só contadores: nenhum identificador do destinatário vai para o log.
  logger.info('[email/unsubscribe] descadastro registrado', {
    newlySuppressed: result.newlySuppressed,
    consentRevoked: result.consentRevoked,
  })
  send(res, 200, page('Descadastro confirmado', '<p>Pronto: você não receberá mais e-mails de marketing da D\'Rosa Moda.</p>'))
})

export default router
