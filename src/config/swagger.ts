export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: "D'Rosa Recovery API",
    version: '1.0.0',
    description:
      "API de automações WhatsApp para D'Rosa Moda — integração Nuvemshop + Meta WhatsApp Cloud API.",
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  components: {
    securitySchemes: {
      AdminSecret: { type: 'apiKey', in: 'header', name: 'x-admin-secret' },
      JobsSecret: { type: 'apiKey', in: 'header', name: 'x-jobs-secret' },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          service: { type: 'string', example: 'drosa-recovery' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      JobResult: {
        type: 'object',
        properties: {
          found: { type: 'integer' },
          markedProcessing: { type: 'integer' },
          sent: { type: 'integer' },
          skipped: { type: 'integer' },
          failed: { type: 'integer' },
          retryScheduled: { type: 'integer' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check rápido',
        responses: {
          200: {
            description: 'Serviço operacional',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/health/deep': {
      get: {
        tags: ['Health'],
        summary: 'Health check completo (banco + env)',
        responses: {
          200: { description: 'Todos os checks passaram' },
          503: { description: 'Um ou mais checks falharam' },
        },
      },
    },
    '/webhooks/nuvemshop/orders': {
      post: {
        tags: ['Webhooks'],
        summary: 'Recebe evento de pedido da Nuvemshop',
        parameters: [
          { in: 'header', name: 'x-linkedstore-hmac-sha256', required: true, schema: { type: 'string' }, description: 'HMAC-SHA256 do body em Base64' },
          { in: 'header', name: 'x-linkedstore-topic', schema: { type: 'string' }, example: 'orders/created' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: { id: 12345, number: 1001, status: 'open', payment_status: 'pending', contact_name: 'Maria Silva', contact_phone: '31998021418', total: '199.90' },
            },
          },
        },
        responses: {
          200: { description: 'Recebido com sucesso (processamento assíncrono)' },
          401: { description: 'Assinatura HMAC inválida' },
        },
      },
    },
    '/webhooks/meta': {
      get: {
        tags: ['Webhooks'],
        summary: 'Verificação do webhook pelo Meta (challenge)',
        parameters: [
          { in: 'query', name: 'hub.mode', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'hub.verify_token', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'hub.challenge', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Retorna hub.challenge' },
          403: { description: 'Token inválido' },
        },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Recebe eventos de status e mensagens do Meta',
        parameters: [
          { in: 'header', name: 'x-hub-signature-256', required: true, schema: { type: 'string' }, description: 'sha256=<hash>' },
        ],
        responses: {
          200: { description: 'Recebido (processamento assíncrono)' },
          401: { description: 'Assinatura inválida' },
        },
      },
    },
    '/jobs/sync-abandoned-checkouts': {
      post: {
        tags: ['Jobs'],
        summary: 'Sincroniza carrinhos abandonados da Nuvemshop',
        security: [{ JobsSecret: [] }],
        responses: {
          200: { description: 'Resumo da execução', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobResult' } } } },
          401: { description: 'x-jobs-secret ausente ou inválido' },
        },
      },
    },
    '/jobs/process-messages': {
      post: {
        tags: ['Jobs'],
        summary: 'Processa mensagens pendentes e envia via WhatsApp',
        security: [{ JobsSecret: [] }],
        responses: {
          200: { description: 'Resumo da execução', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobResult' } } } },
          401: { description: 'x-jobs-secret ausente ou inválido' },
        },
      },
    },
    '/customers/opt-out': {
      post: {
        tags: ['Customers'],
        summary: 'Aplica opt-out manual para um telefone',
        security: [{ AdminSecret: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { example: { phone: '31998021418' } } },
        },
        responses: {
          200: { description: 'Opt-out aplicado', content: { 'application/json': { example: { success: true, normalizedPhone: '5531998021418' } } } },
          400: { description: 'Telefone inválido ou ausente' },
          401: { description: 'x-admin-secret ausente ou inválido' },
        },
      },
    },
    '/admin/orders': {
      get: {
        tags: ['Admin'],
        summary: 'Lista últimos pedidos',
        security: [{ AdminSecret: [] }],
        responses: {
          200: { description: 'Lista de pedidos' },
          401: { description: 'Não autorizado' },
        },
      },
    },
    '/admin/abandoned-checkouts': {
      get: {
        tags: ['Admin'],
        summary: 'Lista carrinhos abandonados',
        security: [{ AdminSecret: [] }],
        responses: { 200: { description: 'Lista de carrinhos' }, 401: { description: 'Não autorizado' } },
      },
    },
    '/admin/message-logs': {
      get: {
        tags: ['Admin'],
        summary: 'Lista logs de mensagens WhatsApp',
        security: [{ AdminSecret: [] }],
        parameters: [
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'skipped'] } },
          { in: 'query', name: 'template_name', schema: { type: 'string' } },
          { in: 'query', name: 'entity_type', schema: { type: 'string', enum: ['order', 'abandoned_checkout'] } },
          { in: 'query', name: 'date_from', schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'date_to', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Lista de logs' }, 401: { description: 'Não autorizado' } },
      },
    },
    '/admin/webhook-events': {
      get: {
        tags: ['Admin'],
        summary: 'Lista eventos de webhook recebidos',
        security: [{ AdminSecret: [] }],
        parameters: [
          { in: 'query', name: 'provider', schema: { type: 'string', enum: ['nuvemshop', 'meta'] } },
          { in: 'query', name: 'processed', schema: { type: 'boolean' } },
          { in: 'query', name: 'topic', schema: { type: 'string' } },
          { in: 'query', name: 'date_from', schema: { type: 'string', format: 'date-time' } },
          { in: 'query', name: 'date_to', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'Lista de eventos' }, 401: { description: 'Não autorizado' } },
      },
    },
    '/admin/automation-rules': {
      get: {
        tags: ['Admin'],
        summary: 'Lista regras de automação',
        security: [{ AdminSecret: [] }],
        responses: { 200: { description: 'Lista de regras' } },
      },
      post: {
        tags: ['Admin'],
        summary: 'Cria regra de automação',
        security: [{ AdminSecret: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: { name: 'Confirmação', eventType: 'order_created', templateName: 'confirmacao_pedido_drosa', delayMinutes: 1, active: true },
            },
          },
        },
        responses: { 201: { description: 'Regra criada' }, 400: { description: 'Dados inválidos' } },
      },
    },
    '/admin/automation-rules/{id}': {
      patch: {
        tags: ['Admin'],
        summary: 'Atualiza regra de automação',
        security: [{ AdminSecret: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { example: { active: false } } },
        },
        responses: { 200: { description: 'Regra atualizada' } },
      },
    },
    '/admin/whatsapp-templates': {
      get: {
        tags: ['Admin'],
        summary: 'Lista templates WhatsApp',
        security: [{ AdminSecret: [] }],
        responses: { 200: { description: 'Lista de templates' } },
      },
    },
    '/admin/whatsapp-templates/{id}': {
      patch: {
        tags: ['Admin'],
        summary: 'Atualiza template (permite ativar/desativar Fase 2)',
        security: [{ AdminSecret: [] }],
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { example: { active: true } } },
        },
        responses: { 200: { description: 'Template atualizado' } },
      },
    },
  },
}
