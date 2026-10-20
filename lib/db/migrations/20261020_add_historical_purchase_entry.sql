-- Historical purchase entry support.
--
-- stock_receipt: quantity was physically added before purchase approval.
-- historical: records a previous supplier purchase without changing today's
-- physical stock; approval splits its cost between remaining stock and
-- already-sold historical quantity.
--
-- This migration is intentionally NOT auto-applied by the application.
-- Apply manually only after review and production schema preflight.

BEGIN;

ALTER TABLE public.pos_purchase_items
  ADD COLUMN IF NOT EXISTS entry_mode text
  NOT NULL
  DEFAULT 'stock_receipt';

ALTER TABLE public.pos_purchase_items
  DROP CONSTRAINT IF EXISTS pos_purchase_items_entry_mode_valid;

ALTER TABLE public.pos_purchase_items
  ADD CONSTRAINT pos_purchase_items_entry_mode_valid
  CHECK (entry_mode IN ('stock_receipt', 'historical'));

ALTER TABLE public.pos_purchase_item_costs
  ADD COLUMN IF NOT EXISTS stock_quantity_applied integer
    NOT NULL
    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS historical_sold_quantity integer
    NOT NULL
    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_cost_total_minor integer
    NOT NULL
    DEFAULT 0,
  ADD COLUMN IF NOT EXISTS historical_sold_cost_total_minor integer
    NOT NULL
    DEFAULT 0;

-- Existing approved purchase snapshots predate historical entry mode.
-- They are normal stock receipts, so preserve their full quantity/value
-- as inventory-applied cost.
UPDATE public.pos_purchase_item_costs
SET
  stock_quantity_applied = received_quantity,
  historical_sold_quantity = 0,
  stock_cost_total_minor = cost_total_minor,
  historical_sold_cost_total_minor = 0
WHERE
  stock_quantity_applied = 0
  AND historical_sold_quantity = 0
  AND stock_cost_total_minor = 0
  AND historical_sold_cost_total_minor = 0;

ALTER TABLE public.pos_purchase_item_costs
  DROP CONSTRAINT IF EXISTS pos_purchase_item_costs_split_valid;

ALTER TABLE public.pos_purchase_item_costs
  ADD CONSTRAINT pos_purchase_item_costs_split_valid
  CHECK (
    stock_quantity_applied >= 0
    AND historical_sold_quantity >= 0
    AND stock_cost_total_minor >= 0
    AND historical_sold_cost_total_minor >= 0
    AND stock_quantity_applied + historical_sold_quantity
      = received_quantity
    AND stock_cost_total_minor + historical_sold_cost_total_minor
      = cost_total_minor
  );

COMMIT;
