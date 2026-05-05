-- =====================================================================
-- D'Rosa Recovery — Setup completo do banco de dados
-- Cole no Supabase → SQL Editor → Run
-- =====================================================================

-- Enums
CREATE TYPE IF NOT EXISTS "AbandonedCheckoutStatus" AS ENUM ('abandoned', 'converted', 'skipped');
CREATE TYPE IF NOT EXISTS "TemplateCategory" AS ENUM ('utility', 'marketing', 'authentication');
CREATE TYPE IF NOT EXISTS "EventType" AS ENUM ('order_created', 'abandoned_checkout', 'order_created_boleto', 'boleto_expiring', 'order_created_pix', 'payment_confirmed', 'payment_rejected', 'pix_cancelled');
CREATE TYPE IF NOT EXISTS "EntityType" AS ENUM ('order', 'abandoned_checkout');
CREATE TYPE IF NOT EXISTS "MessageStatus" AS ENUM ('pending', 'processing', 'sent', 'delivered', 'read', 'failed', 'skipped');
CREATE TYPE IF NOT EXISTS "WebhookProvider" AS ENUM ('nuvemshop', 'meta', 'mercado_pago_future');

-- customers
CREATE TABLE IF NOT EXISTS "customers" (
  "id"                       TEXT NOT NULL PRIMARY KEY,
  "name"                     TEXT NOT NULL,
  "email"                    TEXT,
  "phone"                    TEXT,
  "normalizedPhone"          TEXT NOT NULL,
  "normalizedPhoneValidated" TEXT,
  "phoneNote"                TEXT,
  "optOut"                   BOOLEAN NOT NULL DEFAULT false,
  "source"                   TEXT,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "customers_normalizedPhone_idx" ON "customers"("normalizedPhone");
CREATE INDEX IF NOT EXISTS "customers_email_idx" ON "customers"("email");
CREATE INDEX IF NOT EXISTS "customers_optOut_idx" ON "customers"("optOut");

-- orders
CREATE TABLE IF NOT EXISTS "orders" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "nuvemshopOrderId" TEXT NOT NULL UNIQUE,
  "orderNumber"      TEXT NOT NULL,
  "customerId"       TEXT,
  "customerName"     TEXT NOT NULL,
  "customerEmail"    TEXT,
  "customerPhone"    TEXT,
  "normalizedPhone"  TEXT NOT NULL,
  "total"            DECIMAL(12,2) NOT NULL,
  "currency"         TEXT NOT NULL DEFAULT 'BRL',
  "paymentStatus"    TEXT NOT NULL,
  "paymentMethod"    TEXT,
  "status"           TEXT NOT NULL,
  "orderUrl"         TEXT,
  "webhookTopic"     TEXT,
  "rawPayload"       JSONB NOT NULL,
  "source"           TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "orders_nuvemshopOrderId_idx" ON "orders"("nuvemshopOrderId");
CREATE INDEX IF NOT EXISTS "orders_normalizedPhone_idx" ON "orders"("normalizedPhone");
CREATE INDEX IF NOT EXISTS "orders_customerEmail_idx" ON "orders"("customerEmail");
CREATE INDEX IF NOT EXISTS "orders_paymentStatus_idx" ON "orders"("paymentStatus");
CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");
CREATE INDEX IF NOT EXISTS "orders_webhookTopic_idx" ON "orders"("webhookTopic");

-- abandoned_checkouts
CREATE TABLE IF NOT EXISTS "abandoned_checkouts" (
  "id"                   TEXT NOT NULL PRIMARY KEY,
  "nuvemshopCheckoutId"  TEXT NOT NULL UNIQUE,
  "token"                TEXT,
  "customerId"           TEXT,
  "customerName"         TEXT NOT NULL,
  "customerEmail"        TEXT,
  "customerPhone"        TEXT,
  "normalizedPhone"      TEXT NOT NULL,
  "total"                DECIMAL(12,2),
  "currency"             TEXT NOT NULL DEFAULT 'BRL',
  "productsSummary"      TEXT,
  "abandonedCheckoutUrl" TEXT NOT NULL,
  "status"               "AbandonedCheckoutStatus" NOT NULL DEFAULT 'abandoned',
  "rawPayload"           JSONB NOT NULL,
  "firstSeenAt"          TIMESTAMP(3) NOT NULL,
  "lastSeenAt"           TIMESTAMP(3) NOT NULL,
  "convertedAt"          TIMESTAMP(3),
  "source"               TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "abandoned_checkouts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "abandoned_checkouts_nuvemshopCheckoutId_idx" ON "abandoned_checkouts"("nuvemshopCheckoutId");
CREATE INDEX IF NOT EXISTS "abandoned_checkouts_normalizedPhone_idx" ON "abandoned_checkouts"("normalizedPhone");
CREATE INDEX IF NOT EXISTS "abandoned_checkouts_customerEmail_idx" ON "abandoned_checkouts"("customerEmail");
CREATE INDEX IF NOT EXISTS "abandoned_checkouts_status_idx" ON "abandoned_checkouts"("status");
CREATE INDEX IF NOT EXISTS "abandoned_checkouts_convertedAt_idx" ON "abandoned_checkouts"("convertedAt");

-- whatsapp_templates
CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "name"             TEXT NOT NULL,
  "eventType"        TEXT NOT NULL,
  "metaTemplateName" TEXT NOT NULL,
  "languageCode"     TEXT NOT NULL DEFAULT 'pt_BR',
  "category"         "TemplateCategory" NOT NULL,
  "messagePreview"   TEXT NOT NULL,
  "variables"        JSONB NOT NULL,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "whatsapp_templates_eventType_idx" ON "whatsapp_templates"("eventType");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_metaTemplateName_idx" ON "whatsapp_templates"("metaTemplateName");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_active_idx" ON "whatsapp_templates"("active");
CREATE INDEX IF NOT EXISTS "whatsapp_templates_category_idx" ON "whatsapp_templates"("category");

-- automation_rules
CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id"                TEXT NOT NULL PRIMARY KEY,
  "name"              TEXT NOT NULL,
  "eventType"         "EventType" NOT NULL,
  "templateName"      TEXT NOT NULL,
  "delayMinutes"      INTEGER NOT NULL DEFAULT 0,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "maxSendsPerEntity" INTEGER NOT NULL DEFAULT 1,
  "stopIfOrderExists" BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "automation_rules_eventType_idx" ON "automation_rules"("eventType");
CREATE INDEX IF NOT EXISTS "automation_rules_active_idx" ON "automation_rules"("active");
CREATE INDEX IF NOT EXISTS "automation_rules_templateName_idx" ON "automation_rules"("templateName");

-- message_logs
CREATE TABLE IF NOT EXISTS "message_logs" (
  "id"              TEXT NOT NULL PRIMARY KEY,
  "idempotencyKey"  TEXT NOT NULL UNIQUE,
  "entityType"      "EntityType" NOT NULL,
  "entityId"        TEXT NOT NULL,
  "customerId"      TEXT,
  "normalizedPhone" TEXT NOT NULL,
  "templateName"    TEXT NOT NULL,
  "status"          "MessageStatus" NOT NULL DEFAULT 'pending',
  "reason"          TEXT,
  "errorCode"       TEXT,
  "metaMessageId"   TEXT,
  "payload"         JSONB,
  "response"        JSONB,
  "retryCount"      INTEGER NOT NULL DEFAULT 0,
  "lastRetryAt"     TIMESTAMP(3),
  "nextRetryAt"     TIMESTAMP(3),
  "scheduledAt"     TIMESTAMP(3) NOT NULL,
  "sentAt"          TIMESTAMP(3),
  "source"          TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "message_logs_normalizedPhone_idx" ON "message_logs"("normalizedPhone");
CREATE INDEX IF NOT EXISTS "message_logs_status_idx" ON "message_logs"("status");
CREATE INDEX IF NOT EXISTS "message_logs_scheduledAt_idx" ON "message_logs"("scheduledAt");
CREATE INDEX IF NOT EXISTS "message_logs_metaMessageId_idx" ON "message_logs"("metaMessageId");
CREATE INDEX IF NOT EXISTS "message_logs_entityType_entityId_templateName_idx" ON "message_logs"("entityType", "entityId", "templateName");

-- webhook_events
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "provider"    "WebhookProvider" NOT NULL,
  "topic"       TEXT,
  "externalId"  TEXT,
  "hmacValid"   BOOLEAN,
  "rawPayload"  JSONB NOT NULL,
  "headers"     JSONB NOT NULL,
  "processed"   BOOLEAN NOT NULL DEFAULT false,
  "processedAt" TIMESTAMP(3),
  "error"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "webhook_events_provider_idx" ON "webhook_events"("provider");
CREATE INDEX IF NOT EXISTS "webhook_events_topic_idx" ON "webhook_events"("topic");
CREATE INDEX IF NOT EXISTS "webhook_events_externalId_idx" ON "webhook_events"("externalId");
CREATE INDEX IF NOT EXISTS "webhook_events_processed_idx" ON "webhook_events"("processed");
CREATE INDEX IF NOT EXISTS "webhook_events_createdAt_idx" ON "webhook_events"("createdAt");

-- Trigger para atualizar updatedAt automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW."updatedAt" = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['customers','orders','abandoned_checkouts','whatsapp_templates','automation_rules','message_logs','webhook_events'])
LOOP EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON "%s"; CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON "%s" FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t, t, t);
END LOOP; END $$;
