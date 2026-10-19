-- One-time historical correction approved for 2026-10-19:
-- West Bank courier actual cost = 19 ILS.
--
-- This script is idempotent:
-- - settings are overwritten to the approved actual costs
-- - order snapshots are changed only when they differ from 19 ILS
-- - finance correction transactions are inserted once per completed order
--
-- Important:
-- Run 20261019_allow_residual_delivery_settlements.sql first.

BEGIN;

DO $delivery_cost_preflight$
DECLARE
  missing_done_finance integer;
  missing_company integer;
  missing_ar_account integer;
  missing_expense_account integer;
BEGIN
  SELECT COUNT(*)
  INTO missing_done_finance
  FROM orders o
  WHERE o.shipping_zone = 'الضفة الغربية'
    AND o.fulfillment_method = 'delivery'
    AND o.status = 'done'
    AND o.delivery_company_cost = 20
    AND NOT EXISTS (
      SELECT 1
      FROM finance_transactions t
      WHERE t.source_type = 'web_order'
        AND t.source_id = o.id::text
        AND t.source_event = 'done'
        AND t.status = 'posted'
    );

  IF missing_done_finance > 0 THEN
    RAISE EXCEPTION
      'West Bank delivery-cost correction aborted: % completed order(s) have no posted web_order/done finance transaction',
      missing_done_finance;
  END IF;

  SELECT COUNT(*)
  INTO missing_company
  FROM orders o
  WHERE o.shipping_zone = 'الضفة الغربية'
    AND o.fulfillment_method = 'delivery'
    AND o.status = 'done'
    AND o.delivery_company_cost = 20
    AND o.delivery_company_id IS NULL;

  IF missing_company > 0 THEN
    RAISE EXCEPTION
      'West Bank delivery-cost correction aborted: % completed order(s) have no delivery company',
      missing_company;
  END IF;

  SELECT COUNT(*)
  INTO missing_ar_account
  FROM orders o
  WHERE o.shipping_zone = 'الضفة الغربية'
    AND o.fulfillment_method = 'delivery'
    AND o.status = 'done'
    AND o.delivery_company_cost = 20
    AND NOT EXISTS (
      SELECT 1
      FROM finance_accounts a
      WHERE a.linked_entity_type = 'delivery_company_receivable'
        AND a.linked_entity_id = o.delivery_company_id
        AND a.status = 'active'
    );

  IF missing_ar_account > 0 THEN
    RAISE EXCEPTION
      'West Bank delivery-cost correction aborted: % completed order(s) have no active courier receivable account',
      missing_ar_account;
  END IF;

  SELECT COUNT(*)
  INTO missing_expense_account
  FROM orders o
  WHERE o.shipping_zone = 'الضفة الغربية'
    AND o.fulfillment_method = 'delivery'
    AND o.status = 'done'
    AND o.delivery_company_cost = 20
    AND NOT EXISTS (
      SELECT 1
      FROM finance_accounts a
      WHERE a.code = 'DELIVERY_EXPENSE'
        AND a.status = 'active'
    );

  IF missing_expense_account > 0 THEN
    RAISE EXCEPTION
      'West Bank delivery-cost correction aborted: DELIVERY_EXPENSE account is missing';
  END IF;
END
$delivery_cost_preflight$;

-- Approved actual courier prices from this date forward.
-- Customer-facing cost and promoCost are intentionally untouched.
UPDATE app_settings a
SET
  data = jsonb_set(
    a.data,
    '{shippingZones}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN zone->>'label' = 'الضفة الغربية'
            THEN zone || jsonb_build_object('companyCost', 19)
          WHEN zone->>'label' = 'القدس'
            THEN zone || jsonb_build_object('companyCost', 30)
          WHEN zone->>'label' = 'أراضي الـ48'
            THEN zone || jsonb_build_object('companyCost', 70)
          ELSE
            zone || jsonb_build_object(
              'companyCost',
              COALESCE(
                NULLIF(zone->>'cost', '')::integer,
                0
              )
            )
        END
        ORDER BY ordinality
      )
      FROM jsonb_array_elements(a.data->'shippingZones')
        WITH ORDINALITY AS zones(zone, ordinality)
    ),
    true
  ),
  updated_at = now()
WHERE a.id = 1
  AND jsonb_typeof(a.data->'shippingZones') = 'array';

-- Correct the financial ledger for completed West Bank parcels.
-- If old cost was 20 and actual cost is 19:
--   DR courier receivable 1 ILS
--   CR delivery expense   1 ILS
--
-- The opposite direction is also handled safely if any historical row
-- happens to contain a cost below 19.
WITH targets AS (
  SELECT
    o.id AS order_id,
    o.delivery_company_id,
    (o.delivery_company_cost - 19) * 100 AS delta_minor
  FROM orders o
  WHERE o.shipping_zone = 'الضفة الغربية'
    AND o.fulfillment_method = 'delivery'
    AND o.status = 'done'
    AND o.delivery_company_cost = 20
),
new_transactions AS (
  INSERT INTO finance_transactions (
    public_id,
    idempotency_key,
    business_date,
    transaction_type,
    source_type,
    source_id,
    source_event,
    cash_session_id,
    status,
    notes,
    created_by_user_id
  )
  SELECT
    'FIN-DCOST-20261019-' || t.order_id,
    'order:' || t.order_id || ':delivery-cost-correction-20261019',
    CURRENT_DATE,
    'adjustment',
    'web_order',
    t.order_id::text,
    'delivery_cost_correction_20261019',
    NULL,
    'posted',
    'تصحيح تاريخي لتكلفة توصيل الضفة الغربية إلى 19 شيكل للطلب #' || t.order_id,
    NULL
  FROM targets t
  WHERE NOT EXISTS (
    SELECT 1
    FROM finance_transactions existing
    WHERE existing.source_type = 'web_order'
      AND existing.source_id = t.order_id::text
      AND existing.source_event = 'delivery_cost_correction_20261019'
      AND existing.status = 'posted'
  )
  RETURNING id, source_id
),
transaction_targets AS (
  SELECT
    nt.id AS transaction_id,
    t.order_id,
    t.delivery_company_id,
    t.delta_minor
  FROM new_transactions nt
  JOIN targets t
    ON t.order_id = nt.source_id::integer
),
accounts AS (
  SELECT
    tt.*,
    ar.id AS ar_account_id,
    expense.id AS expense_account_id
  FROM transaction_targets tt
  JOIN finance_accounts ar
    ON ar.linked_entity_type = 'delivery_company_receivable'
   AND ar.linked_entity_id = tt.delivery_company_id
   AND ar.status = 'active'
  CROSS JOIN LATERAL (
    SELECT id
    FROM finance_accounts
    WHERE code = 'DELIVERY_EXPENSE'
      AND status = 'active'
    LIMIT 1
  ) expense
),
insert_ar_lines AS (
  INSERT INTO finance_transaction_lines (
    transaction_id,
    line_number,
    account_id,
    debit_minor,
    credit_minor,
    memo
  )
  SELECT
    a.transaction_id,
    1,
    a.ar_account_id,
    GREATEST(a.delta_minor, 0),
    GREATEST(-a.delta_minor, 0),
    'تصحيح ذمة شركة التوصيل للطلب #' || a.order_id
  FROM accounts a
  RETURNING transaction_id
)
INSERT INTO finance_transaction_lines (
  transaction_id,
  line_number,
  account_id,
  debit_minor,
  credit_minor,
  memo
)
SELECT
  a.transaction_id,
  2,
  a.expense_account_id,
  GREATEST(-a.delta_minor, 0),
  GREATEST(a.delta_minor, 0),
  'تصحيح مصروف التوصيل للطلب #' || a.order_id
FROM accounts a;

-- Update historical parcel snapshots after the finance correction is ready.
UPDATE orders
SET delivery_company_cost = 19
WHERE shipping_zone = 'الضفة الغربية'
  AND fulfillment_method = 'delivery'
  AND status IN ('delivering', 'done')
  AND delivery_company_cost = 20;

INSERT INTO security_audit_logs (
  actor_user_id,
  target_user_id,
  action,
  details
)
SELECT
  NULL,
  NULL,
  'delivery_cost_historical_correction_20261019',
  jsonb_build_object(
    'westBankActualCostIls', 19,
    'jerusalemActualCostIls', 30,
    'inside48ActualCostIls', 70,
    'financeAdjustments',
      (
        SELECT COUNT(*)
        FROM finance_transactions
        WHERE source_type = 'web_order'
          AND source_event = 'delivery_cost_correction_20261019'
          AND status = 'posted'
      ),
    'correctedAt', now()
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM security_audit_logs
  WHERE action = 'delivery_cost_historical_correction_20261019'
);

COMMIT;
