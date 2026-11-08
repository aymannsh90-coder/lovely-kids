-- Refused COD parcels sent back by the delivery company, no return freight.
-- "pending" holds goods IN TRANSIT; stock remains deducted and unsellable.
-- "received" is stamped ONLY inside the same transaction as the existing
-- cancellation + stock/cost restoration; replays are idempotent.
CREATE TABLE IF NOT EXISTS public.order_failed_delivery_returns (
  order_id integer PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  return_delivery_cost_minor integer NOT NULL DEFAULT 0,
  reported_at timestamptz NOT NULL DEFAULT now(),
  reported_by_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  received_at timestamptz,
  received_by_user_id integer REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_failed_delivery_returns_status_valid CHECK (status IN ('pending','received')),
  CONSTRAINT order_failed_delivery_returns_no_return_fee CHECK (return_delivery_cost_minor = 0),
  CONSTRAINT order_failed_delivery_returns_reason_valid CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT order_failed_delivery_returns_receipt_valid CHECK (
    (status = 'pending' AND received_at IS NULL AND received_by_user_id IS NULL)
    OR (status = 'received' AND received_at IS NOT NULL AND received_by_user_id IS NOT NULL)
  )
);
ALTER TABLE public.order_failed_delivery_returns ENABLE ROW LEVEL SECURITY;
-- API worker is the only authorized access path. No anon/authenticated policies.
