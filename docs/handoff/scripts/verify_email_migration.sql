-- Verificação pós-migration (somente leitura / introspecção). Falha com RAISE EXCEPTION se algo divergir.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampaignChannel') THEN RAISE EXCEPTION 'CampaignChannel ausente'; END IF;
  IF (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'CampaignChannel') <> 2 THEN RAISE EXCEPTION 'CampaignChannel deveria ter 2 valores'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_drafts' AND column_name = 'channel' AND is_nullable = 'NO' AND column_default LIKE '%WHATSAPP%') THEN RAISE EXCEPTION 'campaign_drafts.channel NOT NULL DEFAULT WHATSAPP ausente'; END IF;
  IF (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'OpportunityType' AND e.enumlabel LIKE 'EMAIL\_%') <> 13 THEN RAISE EXCEPTION 'OpportunityType deveria ter 13 valores EMAIL_*'; END IF;
  IF (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'OpportunityType' AND e.enumlabel NOT LIKE 'EMAIL\_%') <> 8 THEN RAISE EXCEPTION 'os 8 valores originais de OpportunityType deveriam estar intactos'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'campaign_drafts_channel_idx') THEN RAISE EXCEPTION 'indice campaign_drafts_channel_idx ausente'; END IF;
  IF EXISTS (SELECT 1 FROM campaign_drafts WHERE channel <> 'WHATSAPP' AND "opportunityType"::text NOT LIKE 'EMAIL\_%') THEN RAISE EXCEPTION 'draft antigo com canal diferente de WHATSAPP'; END IF;
END $$;
