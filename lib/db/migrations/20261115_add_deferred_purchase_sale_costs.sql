-- POS sales of physically received items before supplier draft accounting approval.
-- NEVER auto-run on production. Apply only as part of a reviewed deployment.
BEGIN;
CREATE TABLE IF NOT EXISTS public.deferred_purchase_sale_costs (
  id SERIAL PRIMARY KEY,
  draft_public_id TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  sale_item_id INTEGER NOT NULL REFERENCES public.pos_sale_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_purchase_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deferred_purchase_sale_costs_quantity_valid CHECK (quantity > 0 AND quantity <= 99),
  CONSTRAINT deferred_purchase_sale_costs_status_valid CHECK (status IN ('pending','voided','settled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS deferred_purchase_sale_costs_item_idx ON public.deferred_purchase_sale_costs(sale_item_id);
CREATE INDEX IF NOT EXISTS deferred_purchase_sale_costs_draft_idx ON public.deferred_purchase_sale_costs(draft_public_id,product_id,status);
ALTER TABLE public.deferred_purchase_sale_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deferred_purchase_sale_costs FROM anon, authenticated;
GRANT ALL ON TABLE public.deferred_purchase_sale_costs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.deferred_purchase_sale_costs_id_seq TO service_role;
COMMIT;
