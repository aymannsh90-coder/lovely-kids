-- Track automatically reconstructed historical purchase batches.
--
-- historical_source_key identifies the original cost/inventory batch that a
-- historical supplier invoice documents, so the same old batch cannot be
-- invoiced twice.
--
-- historical_documentation_only marks old batches whose inventory/COGS cost
-- is already represented in the cost engine. Those invoices document the
-- supplier purchase without re-applying stock cost or COGS.

BEGIN;

ALTER TABLE public.pos_purchase_items
  ADD COLUMN IF NOT EXISTS historical_source_key text,
  ADD COLUMN IF NOT EXISTS historical_documentation_only boolean
    NOT NULL
    DEFAULT false;

ALTER TABLE public.pos_purchase_items
  DROP CONSTRAINT IF EXISTS pos_purchase_items_historical_source_key_valid;

ALTER TABLE public.pos_purchase_items
  ADD CONSTRAINT pos_purchase_items_historical_source_key_valid
  CHECK (
    historical_source_key IS NULL
    OR length(btrim(historical_source_key)) BETWEEN 8 AND 160
  );

ALTER TABLE public.pos_purchase_items
  DROP CONSTRAINT IF EXISTS pos_purchase_items_historical_documentation_valid;

ALTER TABLE public.pos_purchase_items
  ADD CONSTRAINT pos_purchase_items_historical_documentation_valid
  CHECK (
    historical_documentation_only = false
    OR entry_mode = 'historical'
  );

CREATE INDEX IF NOT EXISTS
  pos_purchase_items_historical_source_key_idx
ON public.pos_purchase_items (historical_source_key);

COMMIT;
