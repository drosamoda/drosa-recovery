-- @0 role e permissoes
SELECT current_user AS u, has_table_privilege('customers','SELECT') AS customers, has_table_privilege('orders','SELECT') AS orders, has_table_privilege('abandoned_checkouts','SELECT') AS checkouts, has_table_privilege('webhook_events','SELECT') AS webhook_events
-- @1 contagens brutas
SELECT (SELECT count(*) FROM customers)::int AS customers, (SELECT count(*) FROM orders)::int AS orders, (SELECT count(*) FROM abandoned_checkouts)::int AS checkouts, (SELECT count(*) FROM webhook_events)::int AS webhook_events
-- @2 colunas/tabelas do schema public que sugerem consentimento/marketing/supressao
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND (column_name ~* '(consent|marketing|newsletter|subscri|unsub|opt_?in|opt_?out|suppress|lgpd|gdpr)' OR table_name ~* '(consent|marketing|newsletter|subscri|unsub|suppress)') ORDER BY 1,2
-- @3 tipo de orders.rawPayload
SELECT data_type FROM information_schema.columns WHERE table_name='orders' AND column_name='rawPayload'
-- @4 orders.rawPayload formato
SELECT CASE WHEN "rawPayload" ? 'fetchedOrderPayload' THEN 'fetched_wrapper' ELSE 'webhook_flat' END AS shape, count(*)::int AS n FROM orders GROUP BY 1
-- @5 orders.rawPayload chaves de 1o nivel (flat)
SELECT k AS chave, count(*)::int AS n FROM orders o, jsonb_object_keys(o."rawPayload") k WHERE NOT (o."rawPayload" ? 'fetchedOrderPayload') GROUP BY k ORDER BY n DESC, k
-- @6 orders.rawPayload chaves de 1o nivel dentro de fetchedOrderPayload
SELECT k AS chave, count(*)::int AS n FROM orders o, jsonb_object_keys(o."rawPayload"->'fetchedOrderPayload') k WHERE o."rawPayload" ? 'fetchedOrderPayload' GROUP BY k ORDER BY n DESC, k
-- @7 orders: objeto aninhado customer presente?
SELECT (o."rawPayload" ? 'customer') AS flat_has_customer, ((o."rawPayload"->'fetchedOrderPayload') ? 'customer') AS fetched_has_customer, count(*)::int AS n FROM orders o GROUP BY 1,2
-- @8 orders: chaves (qualquer profundidade) de marketing/consentimento
SELECT m[1] AS chave, count(*)::int AS n_ocorrencias, count(DISTINCT o.id)::int AS n_pedidos FROM orders o, LATERAL regexp_matches(o."rawPayload"::text, '"([A-Za-z_]*(marketing|newsletter|consent|subscri|opt_?in|opt_?out|lgpd|gdpr|privacy|accepts)[A-Za-z_]*)"\s*:', 'gi') AS m GROUP BY 1 ORDER BY 3 DESC
-- @9 orders: chaves aninhadas de customer (quando existe)
SELECT k AS chave, count(*)::int AS n FROM orders o, jsonb_object_keys(COALESCE(o."rawPayload"->'customer', o."rawPayload"->'fetchedOrderPayload'->'customer', '{}'::jsonb)) k GROUP BY k ORDER BY n DESC, k
-- @10 abandoned_checkouts.rawPayload chaves de 1o nivel
SELECT k AS chave, count(*)::int AS n FROM abandoned_checkouts a, jsonb_object_keys(a."rawPayload") k GROUP BY k ORDER BY n DESC, k
-- @11 abandoned_checkouts: chaves de marketing/consentimento
SELECT m[1] AS chave, count(*)::int AS n_ocorrencias, count(DISTINCT a.id)::int AS n_checkouts FROM abandoned_checkouts a, LATERAL regexp_matches(a."rawPayload"::text, '"([A-Za-z_]*(marketing|newsletter|consent|subscri|opt_?in|opt_?out|lgpd|gdpr|privacy|accepts)[A-Za-z_]*)"\s*:', 'gi') AS m GROUP BY 1 ORDER BY 3 DESC
-- @12 webhook_events nuvemshop: topicos recebidos
SELECT COALESCE(topic,'(null)') AS topic, count(*)::int AS n FROM webhook_events WHERE provider='nuvemshop' GROUP BY 1 ORDER BY 2 DESC
-- @13 webhook_events: chaves de marketing/consentimento
SELECT m[1] AS chave, count(*)::int AS n_ocorrencias, count(DISTINCT w.id)::int AS n_eventos FROM webhook_events w, LATERAL regexp_matches(w."rawPayload"::text, '"([A-Za-z_]*(marketing|newsletter|consent|subscri|opt_?in|opt_?out|lgpd|gdpr|privacy|accepts)[A-Za-z_]*)"\s*:', 'gi') AS m GROUP BY 1 ORDER BY 3 DESC
-- @14 customers.source (categorias)
SELECT COALESCE(source,'(null)') AS source, count(*)::int AS n FROM customers GROUP BY 1 ORDER BY 2 DESC
-- @15 TOTAL_WITH_EMAIL (mesma definicao do motor de audiencia: customers UNION pedidos pagos)
WITH cust AS (SELECT NULLIF(lower(btrim(c.email)),'') AS em FROM customers c),
ord AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), c.email))),'') AS em FROM orders o LEFT JOIN customers c ON c.id=o."customerId" WHERE o."paymentStatus"='paid' AND lower(o.status) NOT IN ('cancelled','canceled','refunded')),
pool AS (SELECT em FROM cust WHERE em IS NOT NULL UNION SELECT em FROM ord WHERE em IS NOT NULL)
SELECT count(*)::int AS total_with_email, count(*) FILTER (WHERE length(em)<=254 AND em ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$')::int AS valid_format FROM pool
-- @16 CLASSIFICACAO por e-mail (evidencia em orders.rawPayload; accepts_marketing em qualquer profundidade; valor mais recente vence)
WITH cust AS (SELECT NULLIF(lower(btrim(c.email)),'') AS em FROM customers c),
ord_all AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), c.email))),'') AS em,
   COALESCE(o."sourceUpdatedAt", o."sourceCreatedAt", o."createdAt") AS at,
   jsonb_path_query_array(o."rawPayload", 'lax $.**.accepts_marketing') AS am,
   jsonb_path_query_array(o."rawPayload", 'lax $.**.accepts_marketing_updated_at') AS amu
  FROM orders o LEFT JOIN customers c ON c.id=o."customerId"),
pool AS (SELECT em FROM cust WHERE em IS NOT NULL UNION SELECT em FROM ord_all WHERE em IS NOT NULL),
with_key AS (SELECT DISTINCT ON (em) em, at,
   (SELECT e FROM jsonb_array_elements(am) e WHERE e <> 'null'::jsonb LIMIT 1) AS val,
   (SELECT count(*) FROM jsonb_array_elements(amu) e WHERE e <> 'null'::jsonb) > 0 AS has_ts
  FROM ord_all WHERE em IS NOT NULL AND jsonb_array_length(am) > 0 ORDER BY em, at DESC NULLS LAST)
SELECT CASE WHEN w.em IS NULL THEN 'NOT_COLLECTED'
            WHEN w.val = 'true'::jsonb THEN 'CONFIRMED_OPT_IN'
            WHEN w.val = 'false'::jsonb THEN 'CONFIRMED_OPT_OUT'
            ELSE 'UNKNOWN' END AS classe,
       COALESCE(w.has_ts,false) AS tem_accepts_marketing_updated_at,
       count(*)::int AS n
FROM pool p LEFT JOIN with_key w ON w.em = p.em
GROUP BY 1,2 ORDER BY 1,2
-- @17 evidencia so em checkout (abandoned_checkouts.rawPayload), por e-mail do pool que NAO tem evidencia em pedido
WITH ck AS (SELECT DISTINCT NULLIF(lower(btrim(a."customerEmail")),'') AS em FROM abandoned_checkouts a WHERE a."rawPayload"::text ~* '"accepts_marketing"|"contact_accepts_marketing"')
SELECT count(*)::int AS emails_com_chave_em_checkout FROM ck WHERE em IS NOT NULL
