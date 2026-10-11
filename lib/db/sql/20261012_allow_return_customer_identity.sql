-- Allow a customer identity to be attached to cash/card sale returns.
-- Financial behavior remains controlled only by refund_method.
-- customer refunds still require customer_id.

ALTER TABLE public.pos_sale_returns
  DROP CONSTRAINT IF EXISTS pos_sale_returns_customer_refund_valid;

ALTER TABLE public.pos_sale_returns
  ADD CONSTRAINT pos_sale_returns_customer_refund_valid
  CHECK (
    refund_method <> 'customer'
    OR customer_id IS NOT NULL
  );
