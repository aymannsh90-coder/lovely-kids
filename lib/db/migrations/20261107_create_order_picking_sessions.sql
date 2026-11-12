-- Optional barcode/QR order preparation: a separate, non-financial verification ledger.
-- No triggers or changes to orders.status, stock, sales, or finance tables.
CREATE TABLE IF NOT EXISTS public.order_picking_sessions (
  order_id integer PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  items_signature text NOT NULL,
  scans jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at timestamptz,
  verified_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_picking_scans_is_array CHECK (jsonb_typeof(scans) = 'array')
);
ALTER TABLE public.order_picking_sessions ENABLE ROW LEVEL SECURITY;
-- All reads/writes are authenticated and permission-checked by the API Worker.
-- No public/client-side RLS policies are granted.
