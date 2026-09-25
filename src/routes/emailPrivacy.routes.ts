import { Router } from 'express'
import { env } from '../config/env'

const router = Router()

router.get('/', (_req, res) => {
  const transferApproved = env.EMAIL_TRANSFER_MECHANISM_APPROVED
  const channelEnabled = env.EMAIL_SEND_ENABLED && env.EMAIL_LEGAL_REVIEW_APPROVED && transferApproved

  res.set('Cache-Control', 'public, max-age=300')
  res.type('html').send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacidade e e-mails promocionais — D'Rosa Moda</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222">
<h1>Privacidade e e-mails promocionais</h1>
<p>A D'Rosa Moda envia comunicações promocionais somente para destinatários com preferência de marketing confirmada e permite o cancelamento a qualquer momento.</p>
<h2>Prestador de envio</h2>
<p>Para a infraestrutura de envio usamos o Resend (Plus Five Five, Inc.). O serviço processa dados de e-mail, como endereço do destinatário, conteúdo da mensagem e registros técnicos, nos Estados Unidos.</p>
<h2>Transferência internacional</h2>
<p>${transferApproved
  ? 'A transferência internacional deste canal está liberada somente após a D\'Rosa documentar mecanismo aplicável nos termos da LGPD e da regulamentação da ANPD.'
  : 'As campanhas de clientes permanecem bloqueadas enquanto não houver mecanismo de transferência internacional documentado e aprovado para este canal.'}</p>
<h2>Seus controles</h2>
<ul>
<li>Você pode cancelar e-mails promocionais pelo link de descadastro presente em cada mensagem.</li>
<li>Pedidos de acesso, correção, revogação, oposição ou exclusão quando cabível podem ser enviados para contato@drosamoda.com.br.</li>
<li>O cancelamento de marketing é registrado para impedir novos envios promocionais.</li>
</ul>
<p>Política geral: <a href="https://www.drosamoda.com.br/politica-de-privacidade/">drosamoda.com.br/politica-de-privacidade/</a></p>
<p style="font-size:12px;color:#666">Status operacional do canal: ${channelEnabled ? 'ativo' : 'bloqueado para campanhas de clientes'}.</p>
</body>
</html>`)
})

export default router
