-- Stage 1: persistent open purchase invoices.
-- This migration is intentionally NOT auto-applied by the application.
-- Apply manually after review.

ALTER TABLE pos_purchases
  DROP CONSTRAINT IF EXISTS pos_purchases_status_valid;

ALTER TABLE pos_purchases
  ADD CONSTRAINT pos_purchases_status_valid
  CHECK (status IN ('draft', 'completed', 'voided'));

CREATE UNIQUE INDEX IF NOT EXISTS pos_purchases_one_open_draft_per_user_warehouse_idx
  ON pos_purchases (entered_by_user_id, warehouse_key)
  WHERE status = 'draft';
