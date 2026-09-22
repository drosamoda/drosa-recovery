-- Rodado COMO crm_ai_preview_writer (AI_DATABASE_URL). Só introspecção: zero DML.
DO $$
BEGIN
  IF current_user <> 'crm_ai_preview_writer' THEN RAISE EXCEPTION 'conectado como % (esperado crm_ai_preview_writer)', current_user; END IF;
  IF NOT has_type_privilege(current_user, '"CampaignChannel"', 'USAGE') THEN RAISE EXCEPTION 'USAGE em CampaignChannel AUSENTE para a role (precisa de GRANT)'; END IF;
  IF NOT has_table_privilege(current_user, 'campaign_drafts', 'SELECT') THEN RAISE EXCEPTION 'SELECT em campaign_drafts ausente'; END IF;
  IF NOT has_table_privilege(current_user, 'campaign_drafts', 'INSERT') THEN RAISE EXCEPTION 'INSERT em campaign_drafts ausente'; END IF;
  IF NOT has_table_privilege(current_user, 'campaign_drafts', 'UPDATE') THEN RAISE EXCEPTION 'UPDATE em campaign_drafts ausente'; END IF;
  IF has_table_privilege(current_user, 'campaign_drafts', 'DELETE') THEN RAISE EXCEPTION 'DELETE em campaign_drafts NAO deveria existir'; END IF;
  IF has_table_privilege(current_user, 'customers', 'SELECT') THEN RAISE EXCEPTION 'SELECT em customers NAO deveria existir'; END IF;
  IF has_schema_privilege(current_user, 'public', 'CREATE') THEN RAISE EXCEPTION 'CREATE no schema public NAO deveria existir'; END IF;
END $$;
