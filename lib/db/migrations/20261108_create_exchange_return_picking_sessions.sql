-- Barcode verification for physically returned ONLINE exchange parcels.
-- Audit only: it never changes stock, financial journals, or exchange state.
-- The existing receive-return transaction will check 100% verification before stock restoration.
CREATE TABLE IF NOT EXISTS public.exchange_return_picking_sessions (
  exchange_id integer PRIMARY KEY REFERENCES public.exchange_documents(id) ON DELETE CASCADE,
  items_signature text NOT NULL,
  scans jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at timestamptz,
  verified_by_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_return_picking_scans_array CHECK (jsonb_typeof(scans) = 'array')
);
ALTER TABLE public.exchange_return_picking_sessions ENABLE ROW LEVEL SECURITY;
-- No client policies: reads/writes require authenticated, authorized API Worker calls.
