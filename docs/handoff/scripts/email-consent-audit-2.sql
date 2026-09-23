-- Refinamento da auditoria de consentimento (SOMENTE LEITURA, agregados). Rodar com email-consent-audit.ts.
-- @18 localizacao exata de accepts_marketing em orders.rawPayload
SELECT (o."rawPayload" ? 'accepts_marketing') AS top_level,
  (CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN (o."rawPayload"->'customer') ? 'accepts_marketing' ELSE false END) AS em_customer,
  (CASE WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN (o."rawPayload"->'fetchedOrderPayload'->'customer') ? 'accepts_marketing' ELSE false END) AS em_fetched_customer,
  (CASE WHEN jsonb_typeof(o."rawPayload"->'originalWebhookPayload'->'customer')='object' THEN (o."rawPayload"->'originalWebhookPayload'->'customer') ? 'accepts_marketing' ELSE false END) AS em_original_customer,
  count(*)::int AS n
FROM orders o GROUP BY 1,2,3,4 ORDER BY n DESC
-- @19 chaves do objeto customer aninhado em orders (corrigido para customer null)
WITH oc AS (SELECT CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN o."rawPayload"->'customer' WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN o."rawPayload"->'fetchedOrderPayload'->'customer' END AS c FROM orders o)
SELECT k AS chave, count(*)::int AS n FROM oc, jsonb_object_keys(oc.c) k WHERE oc.c IS NOT NULL GROUP BY k ORDER BY n DESC, k
-- @20 pedidos: valor de customer.accepts_marketing x tipo do updated_at
WITH oc AS (SELECT CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN o."rawPayload"->'customer' WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN o."rawPayload"->'fetchedOrderPayload'->'customer' END AS c FROM orders o)
SELECT CASE WHEN c IS NULL THEN 'sem_customer' WHEN NOT (c ? 'accepts_marketing') THEN 'chave_ausente'
            WHEN jsonb_typeof(c->'accepts_marketing')='boolean' THEN c->>'accepts_marketing'
            WHEN jsonb_typeof(c->'accepts_marketing')='null' THEN 'null'
            ELSE 'outro_tipo' END AS valor,
       COALESCE(jsonb_typeof(c->'accepts_marketing_updated_at'),'ausente') AS tipo_updated_at,
       count(*)::int AS n
FROM oc GROUP BY 1,2 ORDER BY n DESC
-- @21 checkouts: valor de contact_accepts_marketing x tipo do updated_at
SELECT CASE WHEN NOT (a."rawPayload" ? 'contact_accepts_marketing') THEN 'chave_ausente'
            WHEN jsonb_typeof(a."rawPayload"->'contact_accepts_marketing')='boolean' THEN a."rawPayload"->>'contact_accepts_marketing'
            WHEN jsonb_typeof(a."rawPayload"->'contact_accepts_marketing')='null' THEN 'null'
            ELSE 'outro_tipo' END AS valor,
       COALESCE(jsonb_typeof(a."rawPayload"->'contact_accepts_marketing_updated_at'),'ausente') AS tipo_updated_at,
       count(*)::int AS n
FROM abandoned_checkouts a GROUP BY 1,2 ORDER BY n DESC
-- @22 CLASSIFICACAO COMBINADA (pedidos + checkouts) sobre o pool do motor (customers UNION pedidos pagos); snapshot mais recente com valor booleano vence
WITH cust AS (SELECT NULLIF(lower(btrim(c.email)),'') AS em FROM customers c),
ord_paid AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), c.email))),'') AS em FROM orders o LEFT JOIN customers c ON c.id=o."customerId" WHERE o."paymentStatus"='paid' AND lower(o.status) NOT IN ('cancelled','canceled','refunded')),
pool AS (SELECT em FROM cust WHERE em IS NOT NULL UNION SELECT em FROM ord_paid WHERE em IS NOT NULL),
oc AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), cu.email))),'') AS em,
              COALESCE(o."sourceUpdatedAt", o."sourceCreatedAt", o."createdAt") AS at,
              CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN o."rawPayload"->'customer' WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN o."rawPayload"->'fetchedOrderPayload'->'customer' END AS c
       FROM orders o LEFT JOIN customers cu ON cu.id=o."customerId"),
ev AS (
  SELECT em, at, 'ORDER_PAYLOAD'::text AS src, c->'accepts_marketing' AS val, c->'accepts_marketing_updated_at' AS ts FROM oc WHERE em IS NOT NULL AND c IS NOT NULL AND c ? 'accepts_marketing'
  UNION ALL
  SELECT NULLIF(lower(btrim(a."customerEmail")),''), COALESCE(a."sourceUpdatedAt", a."sourceCreatedAt", a."lastSeenAt"), 'CHECKOUT_PAYLOAD', a."rawPayload"->'contact_accepts_marketing', a."rawPayload"->'contact_accepts_marketing_updated_at'
  FROM abandoned_checkouts a WHERE a."rawPayload" ? 'contact_accepts_marketing' AND NULLIF(lower(btrim(a."customerEmail")),'') IS NOT NULL
),
ev_bool AS (SELECT * FROM ev WHERE jsonb_typeof(val)='boolean'),
latest AS (SELECT DISTINCT ON (em) em, at, src, val, ts FROM ev_bool ORDER BY em, at DESC NULLS LAST),
anykey AS (SELECT DISTINCT em FROM ev),
conflict AS (SELECT em FROM ev_bool GROUP BY em HAVING count(DISTINCT val) > 1)
SELECT CASE WHEN l.em IS NOT NULL AND l.val = 'true'::jsonb THEN 'CONFIRMED_OPT_IN'
            WHEN l.em IS NOT NULL THEN 'CONFIRMED_OPT_OUT'
            WHEN k.em IS NOT NULL THEN 'UNKNOWN'
            ELSE 'NOT_COLLECTED' END AS classe,
       COALESCE(l.src,'-') AS origem_snapshot_mais_recente,
       COALESCE(jsonb_typeof(l.ts) = 'string', false) AS tem_accepts_marketing_updated_at,
       (cf.em IS NOT NULL) AS conflito_entre_snapshots,
       count(*)::int AS n
FROM pool p LEFT JOIN latest l ON l.em = p.em LEFT JOIN anykey k ON k.em = p.em LEFT JOIN conflict cf ON cf.em = p.em
GROUP BY 1,2,3,4 ORDER BY 1,2,3,4
-- @23 TOTAIS da classificacao combinada + cobertura por origem
WITH cust AS (SELECT NULLIF(lower(btrim(c.email)),'') AS em FROM customers c),
ord_paid AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), c.email))),'') AS em FROM orders o LEFT JOIN customers c ON c.id=o."customerId" WHERE o."paymentStatus"='paid' AND lower(o.status) NOT IN ('cancelled','canceled','refunded')),
pool AS (SELECT em FROM cust WHERE em IS NOT NULL UNION SELECT em FROM ord_paid WHERE em IS NOT NULL),
oc AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), cu.email))),'') AS em,
              CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN o."rawPayload"->'customer' WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN o."rawPayload"->'fetchedOrderPayload'->'customer' END AS c
       FROM orders o LEFT JOIN customers cu ON cu.id=o."customerId"),
ev_o AS (SELECT DISTINCT em FROM oc WHERE em IS NOT NULL AND c IS NOT NULL AND c ? 'accepts_marketing' AND jsonb_typeof(c->'accepts_marketing')='boolean'),
ev_c AS (SELECT DISTINCT NULLIF(lower(btrim(a."customerEmail")),'') AS em FROM abandoned_checkouts a WHERE jsonb_typeof(a."rawPayload"->'contact_accepts_marketing')='boolean' AND NULLIF(lower(btrim(a."customerEmail")),'') IS NOT NULL)
SELECT count(*)::int AS pool_total,
       count(*) FILTER (WHERE eo.em IS NOT NULL)::int AS com_valor_em_pedido,
       count(*) FILTER (WHERE ec.em IS NOT NULL)::int AS com_valor_em_checkout,
       count(*) FILTER (WHERE eo.em IS NOT NULL AND ec.em IS NOT NULL)::int AS em_ambos,
       count(*) FILTER (WHERE eo.em IS NULL AND ec.em IS NOT NULL)::int AS so_checkout,
       count(*) FILTER (WHERE eo.em IS NULL AND ec.em IS NULL)::int AS sem_valor_booleano
FROM pool p LEFT JOIN ev_o eo ON eo.em = p.em LEFT JOIN ev_c ec ON ec.em = p.em
-- @24 IDADE do snapshot escolhido e distancia entre accepts_marketing_updated_at e o snapshot (agregado por classe)
WITH cust AS (SELECT NULLIF(lower(btrim(c.email)),'') AS em FROM customers c),
ord_paid AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), c.email))),'') AS em FROM orders o LEFT JOIN customers c ON c.id=o."customerId" WHERE o."paymentStatus"='paid' AND lower(o.status) NOT IN ('cancelled','canceled','refunded')),
pool AS (SELECT em FROM cust WHERE em IS NOT NULL UNION SELECT em FROM ord_paid WHERE em IS NOT NULL),
oc AS (SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(o."customerEmail"),''), cu.email))),'') AS em,
              COALESCE(o."sourceUpdatedAt", o."sourceCreatedAt", o."createdAt") AS at,
              CASE WHEN jsonb_typeof(o."rawPayload"->'customer')='object' THEN o."rawPayload"->'customer' WHEN jsonb_typeof(o."rawPayload"->'fetchedOrderPayload'->'customer')='object' THEN o."rawPayload"->'fetchedOrderPayload'->'customer' END AS c
       FROM orders o LEFT JOIN customers cu ON cu.id=o."customerId"),
ev AS (
  SELECT em, at, c->'accepts_marketing' AS val, c->'accepts_marketing_updated_at' AS ts FROM oc WHERE em IS NOT NULL AND c IS NOT NULL AND c ? 'accepts_marketing'
  UNION ALL
  SELECT NULLIF(lower(btrim(a."customerEmail")),''), COALESCE(a."sourceUpdatedAt", a."sourceCreatedAt", a."lastSeenAt"), a."rawPayload"->'contact_accepts_marketing', a."rawPayload"->'contact_accepts_marketing_updated_at'
  FROM abandoned_checkouts a WHERE a."rawPayload" ? 'contact_accepts_marketing' AND NULLIF(lower(btrim(a."customerEmail")),'') IS NOT NULL
),
latest AS (SELECT DISTINCT ON (em) em, at, val, ts FROM ev WHERE jsonb_typeof(val)='boolean' ORDER BY em, at DESC NULLS LAST)
SELECT CASE WHEN l.val = 'true'::jsonb THEN 'CONFIRMED_OPT_IN' ELSE 'CONFIRMED_OPT_OUT' END AS classe,
       CASE WHEN l.at IS NULL THEN 'sem_data'
            WHEN l.at >= now() - interval '30 days' THEN '0-30d'
            WHEN l.at >= now() - interval '90 days' THEN '31-90d'
            WHEN l.at >= now() - interval '180 days' THEN '91-180d'
            WHEN l.at >= now() - interval '365 days' THEN '181-365d'
            ELSE '>365d' END AS idade_do_snapshot,
       CASE WHEN jsonb_typeof(l.ts) <> 'string' OR (l.ts #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN 'sem_updated_at'
            WHEN l.at IS NULL THEN 'snapshot_sem_data'
            WHEN abs(l.at::date - left(l.ts #>> '{}', 10)::date) <= 1 THEN 'updated_at_igual_ao_snapshot(<=1d)'
            ELSE 'updated_at_diferente_do_snapshot(>1d)' END AS updated_at_vs_snapshot,
       count(*)::int AS n
FROM pool p JOIN latest l ON l.em = p.em
GROUP BY 1,2,3 ORDER BY 1,2,3
