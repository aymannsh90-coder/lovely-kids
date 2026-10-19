-- READ-ONLY preview for the one-time West Bank courier cost correction.
-- Expected historical actual courier cost: 19 ILS.

WITH target_orders AS (
  SELECT
    o.id,
    o.status,
    o.delivery_company_id,
    o.delivery_company_cost,
    o.total_price,
    o.shipping_cost
  FROM orders o
  WHERE o.shipping_zone = 'الضفة الغربية'
    AND o.fulfillment_method = 'delivery'
    AND o.status IN ('delivering', 'done')
    AND o.delivery_company_cost IS NOT NULL
    AND o.delivery_company_cost <> 19
),
posted_settlements AS (
  SELECT
    i.order_id,
    SUM(i.amount_minor) AS settled_minor
  FROM delivery_company_settlement_items i
  WHERE i.status = 'posted'
  GROUP BY i.order_id
),
done_finance AS (
  SELECT DISTINCT
    t.source_id::integer AS order_id
  FROM finance_transactions t
  WHERE t.source_type = 'web_order'
    AND t.source_event = 'done'
    AND t.status = 'posted'
    AND t.source_id ~ '^[0-9]+$'
)
SELECT
  COUNT(*) AS target_orders,
  COUNT(*) FILTER (WHERE t.status = 'delivering') AS delivering_orders,
  COUNT(*) FILTER (WHERE t.status = 'done') AS done_orders,
  COUNT(*) FILTER (
    WHERE t.status = 'done'
      AND f.order_id IS NULL
  ) AS done_without_finance,
  COUNT(*) FILTER (
    WHERE COALESCE(s.settled_minor, 0) > 0
  ) AS orders_already_settled,
  COALESCE(SUM(
    CASE
      WHEN t.delivery_company_cost > 19
        THEN (t.delivery_company_cost - 19) * 100
      ELSE 0
    END
  ), 0) AS receivable_increase_minor,
  COALESCE(SUM(
    CASE
      WHEN t.delivery_company_cost < 19
        THEN (19 - t.delivery_company_cost) * 100
      ELSE 0
    END
  ), 0) AS receivable_decrease_minor
FROM target_orders t
LEFT JOIN done_finance f
  ON f.order_id = t.id
LEFT JOIN posted_settlements s
  ON s.order_id = t.id;

SELECT
  o.id,
  o.status,
  o.total_price,
  o.shipping_cost,
  o.delivery_company_cost AS old_company_cost,
  19 AS new_company_cost,
  COALESCE(s.settled_minor, 0) / 100.0 AS already_settled_ils
FROM orders o
LEFT JOIN (
  SELECT
    order_id,
    SUM(amount_minor) AS settled_minor
  FROM delivery_company_settlement_items
  WHERE status = 'posted'
  GROUP BY order_id
) s
  ON s.order_id = o.id
WHERE o.shipping_zone = 'الضفة الغربية'
  AND o.fulfillment_method = 'delivery'
  AND o.status IN ('delivering', 'done')
  AND o.delivery_company_cost IS NOT NULL
  AND o.delivery_company_cost <> 19
ORDER BY o.id;
