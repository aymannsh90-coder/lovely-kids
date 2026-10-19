-- Stage 1: persistent open purchase invoices.
-- This migration is intentionally NOT auto-applied by the application.
-- Apply manually after review.

BEGIN;

ALTER TABLE pos_purchase_items
  ALTER COLUMN unit_cost_minor DROP NOT NULL,
  ALTER COLUMN line_total_minor DROP NOT NULL;

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

CREATE TABLE IF NOT EXISTS public.pos_purchase_item_costs (
  purchase_item_id integer PRIMARY KEY
    REFERENCES public.pos_purchase_items(id)
    ON DELETE CASCADE,

  product_id integer NOT NULL
    REFERENCES public.products(id)
    ON DELETE RESTRICT,

  received_quantity integer NOT NULL,

  unit_cost_minor integer NOT NULL,
  cost_total_minor integer NOT NULL,

  invoice_discount_allocated_minor integer
    NOT NULL
    DEFAULT 0,

  cost_quality text NOT NULL,

  created_at timestamptz
    NOT NULL
    DEFAULT now(),

  CONSTRAINT pos_purchase_item_costs_quantity_valid
    CHECK (received_quantity > 0),

  CONSTRAINT pos_purchase_item_costs_values_valid
    CHECK (
      unit_cost_minor >= 0
      AND cost_total_minor >= 0
      AND invoice_discount_allocated_minor >= 0
    ),

  CONSTRAINT pos_purchase_item_costs_quality_valid
    CHECK (
      cost_quality IN ('confirmed', 'estimated', 'mixed')
    )
);

CREATE INDEX IF NOT EXISTS pos_purchase_item_costs_product_idx
  ON public.pos_purchase_item_costs (product_id);

ALTER TABLE public.pos_purchase_item_costs
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.pos_purchase_item_costs
FROM anon, authenticated;

GRANT ALL ON TABLE
  public.pos_purchase_item_costs
TO service_role;

COMMIT;
