-- POS sales of physically received items before supplier draft accounting approval.
-- NEVER auto-run on production. Apply only as part of a reviewed deployment.
BEGIN;
CREATE TABLE IF NOT EXISTS public.deferred_purchase_sale_costs (
  id SERIAL PRIMARY KEY,
  draft_public_id TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  sale_item_id INTEGER NOT NULL,
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
-- A pending sale cannot lose its supplier cost source even if the draft
-- is discarded outside the POS route. Approval settles the rows first.
CREATE OR REPLACE FUNCTION public.guard_discard_deferred_purchase_draft()
RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF OLD.status = 'draft' AND EXISTS (
    SELECT 1 FROM public.deferred_purchase_sale_costs
    WHERE draft_public_id = OLD.public_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Cannot discard supplier draft with unpriced POS sales'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$guard$;
DROP TRIGGER IF EXISTS guard_discard_deferred_purchase_draft ON public.pos_purchases;
CREATE TRIGGER guard_discard_deferred_purchase_draft
  BEFORE DELETE ON public.pos_purchases
  FOR EACH ROW EXECUTE FUNCTION public.guard_discard_deferred_purchase_draft();
REVOKE ALL ON FUNCTION public.guard_discard_deferred_purchase_draft() FROM PUBLIC;
ALTER TABLE public.deferred_purchase_sale_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deferred_purchase_sale_costs FROM anon, authenticated;
GRANT ALL ON TABLE public.deferred_purchase_sale_costs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.deferred_purchase_sale_costs_id_seq TO service_role;
COMMIT;
