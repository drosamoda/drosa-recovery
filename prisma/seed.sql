-- =====================================================================
-- D'Rosa Recovery — Seed de dados
-- Cole no Supabase → SQL Editor → Run
-- =====================================================================

-- WHATSAPP TEMPLATES
INSERT INTO "whatsapp_templates" ("id","name","eventType","metaTemplateName","languageCode","category","messagePreview","variables","active","createdAt","updatedAt") VALUES
('tpl_order_created','Confirmação de pedido','order_created','confirmacao_pedido_drosa','pt_BR','utility','Oi, [nome_cliente]! 😊 Sou a Dani da D''Rosa Moda. Recebemos o seu pedido *[numero_pedido]* com sucesso.','["nome_cliente","numero_pedido"]',true,NOW(),NOW()),
('tpl_abandoned_checkout','Carrinho abandonado 30 minutos','abandoned_checkout','carrinho_abandonado_drosa_01','pt_BR','marketing','Oi, [nome_cliente]! 😊 Vi que você iniciou um pedido no nosso site, mas não conseguiu finalizar. Continue pelo link: [link_checkout]','["nome_cliente","link_checkout"]',true,NOW(),NOW()),
('tpl_order_created_boleto','Pedido com boleto','order_created_boleto','pedido_boleto_drosa_01','pt_BR','utility','Oi, [nome_cliente]! Pedido *[numero_pedido]* aguardando confirmação do boleto.','["nome_cliente","numero_pedido"]',false,NOW(),NOW()),
('tpl_boleto_expiring','Boleto vencendo','boleto_expiring','boleto_vencendo_drosa_01','pt_BR','utility','Oi, [nome_cliente]! Seu boleto está prestes a expirar. Pague pelo link: [link_boleto_pix]','["nome_cliente","link_boleto_pix"]',false,NOW(),NOW()),
('tpl_order_created_pix','Pix pendente','order_created_pix','pix_pendente_drosa_01','pt_BR','utility','Oi, [nome_cliente]! Pedido nº *[numero_pedido]* no valor de *R$ [valor_total]* aguardando pagamento PIX.','["nome_cliente","numero_pedido","valor_total"]',false,NOW(),NOW()),
('tpl_payment_confirmed','Pagamento confirmado / pós-venda','payment_confirmed','pagamento_confirmado_drosa_01','pt_BR','marketing','Oi, [nome_cliente]! Pagamento do pedido *[numero_pedido]* confirmado! Entre no nosso Grupo VIP: [link_grupo_vip]','["nome_cliente","numero_pedido","link_grupo_vip"]',false,NOW(),NOW()),
('tpl_payment_rejected','Pagamento recusado','payment_rejected','pagamento_recusado_drosa_01','pt_BR','utility','Oi, [nome_cliente]! O pagamento do pedido *[numero_pedido]* não foi aprovado. Posso gerar um link pelo Mercado Pago.','["nome_cliente","numero_pedido"]',false,NOW(),NOW()),
('tpl_pix_cancelled','QR Code ou pedido cancelado','pix_cancelled','pix_cancelado_drosa_01','pt_BR','marketing','Oi, [nome_cliente]! O pedido *[numero_pedido]* foi cancelado. Entre no nosso Grupo VIP: [link_grupo_vip]','["nome_cliente","numero_pedido","link_grupo_vip"]',false,NOW(),NOW())
ON CONFLICT ("id") DO NOTHING;

-- AUTOMATION RULES
INSERT INTO "automation_rules" ("id","name","eventType","templateName","delayMinutes","active","maxSendsPerEntity","stopIfOrderExists","createdAt","updatedAt") VALUES
('rule_order_created','Confirmação de pedido','order_created','confirmacao_pedido_drosa',1,true,1,false,NOW(),NOW()),
('rule_abandoned_checkout','Carrinho abandonado 30 minutos','abandoned_checkout','carrinho_abandonado_drosa_01',30,true,1,true,NOW(),NOW()),
('rule_order_created_boleto','Pedido com boleto','order_created_boleto','pedido_boleto_drosa_01',5,false,1,true,NOW(),NOW()),
('rule_boleto_expiring','Boleto vencendo','boleto_expiring','boleto_vencendo_drosa_01',0,false,1,true,NOW(),NOW()),
('rule_order_created_pix','Pix pendente','order_created_pix','pix_pendente_drosa_01',30,false,1,true,NOW(),NOW()),
('rule_payment_confirmed','Pagamento confirmado','payment_confirmed','pagamento_confirmado_drosa_01',0,false,1,true,NOW(),NOW()),
('rule_payment_rejected','Pagamento recusado','payment_rejected','pagamento_recusado_drosa_01',5,false,1,true,NOW(),NOW()),
('rule_pix_cancelled','QR Code ou pedido cancelado','pix_cancelled','pix_cancelado_drosa_01',0,false,1,true,NOW(),NOW())
ON CONFLICT ("id") DO NOTHING;
