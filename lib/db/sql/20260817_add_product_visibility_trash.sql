BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS products_deleted_at_idx
  ON public.products (deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMIT;
