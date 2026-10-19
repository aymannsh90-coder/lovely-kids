-- Allow an order to participate in more than one posted courier settlement.
-- This is required for auditable residual corrections (for example, an old
-- parcel settled at 20 ILS courier cost that is corrected to 19 ILS later).
-- Concurrency remains protected in the API by locking the order row before
-- calculating the remaining receivable.
DROP INDEX IF EXISTS delivery_company_settlement_items_active_order_idx;
