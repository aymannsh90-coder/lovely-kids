-- Stage 1: persistent open purchase invoices.
-- This migration is intentionally NOT auto-applied by the application.
-- Apply manually after review.

BEGIN;

ALTER TABLE pos_purchases
  DROP CONSTRAINT IF EXISTS pos_purchases_status_valid;

ALTER TABLE pos_purchases
  ADD CONSTRAINT pos_purchases_status_valid
  CHECK (status IN ('draft', 'completed', 'voided'));

ALTER TABLE pos_purchases
  DROP CONSTRAINT IF EXISTS pos_purchases_void_state_valid;

ALTER TABLE pos_purchases
  ADD CONSTRAINT pos_purchases_void_state_valid
  CHECK (
    (
      status IN ('draft', 'completed')
      AND voided_at IS NULL
      AND voided_by_user_id IS NULL
      AND void_reason IS NULL
    )
    OR
    (
      status = 'voided'
      AND voided_at IS NOT NULL
      AND voided_by_user_id IS NOT NULL
      AND length(btrim(void_reason)) > 0
    )
  );

DROP INDEX IF EXISTS pos_purchases_one_open_draft_per_user_warehouse_idx;

CREATE UNIQUE INDEX IF NOT EXISTS pos_purchases_one_open_draft_per_supplier_user_warehouse_idx
  ON pos_purchases (supplier_id, entered_by_user_id, warehouse_key)
  WHERE status = 'draft';

DROP INDEX IF EXISTS pos_purchases_supplier_invoice_unique_idx;

CREATE UNIQUE INDEX pos_purchases_supplier_invoice_unique_idx
  ON pos_purchases (supplier_id, supplier_invoice_number)
  WHERE supplier_invoice_number IS NOT NULL
    AND status = 'completed';

COMMIT;
