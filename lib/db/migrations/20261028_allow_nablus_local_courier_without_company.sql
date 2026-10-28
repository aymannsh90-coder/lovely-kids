-- Fix local Nablus courier delivery state updates (e.g. order #286).
-- A local courier is not registered as a delivery company, but must have
-- a confirmed non-negative actual courier cost before dispatch.
-- Preserve the original company requirement for all other delivery orders.
-- Keep pickup restrictions unchanged.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_delivery_details_valid;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_delivery_details_valid
  CHECK (
    fulfillment_method IS NULL
    OR (
      fulfillment_method = 'pickup'
      AND delivery_company_id IS NULL
      AND (delivery_company_cost IS NULL OR delivery_company_cost = 0)
    )
    OR (
      fulfillment_method = 'delivery'
      AND delivery_company_cost IS NOT NULL
      AND delivery_company_cost >= 0
      AND (
        (
          shipping_zone = 'ديلفري داخل مدينة نابلس'
          AND delivery_company_id IS NULL
        )
        OR (
          shipping_zone IS DISTINCT FROM 'ديلفري داخل مدينة نابلس'
          AND delivery_company_id IS NOT NULL
        )
      )
    )
  );
