BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_client_request_id_valid;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_client_request_id_valid
  CHECK (
    client_request_id IS NULL
    OR length(btrim(client_request_id)) BETWEEN 16 AND 100
  );

CREATE UNIQUE INDEX IF NOT EXISTS orders_client_request_id_idx
  ON public.orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
