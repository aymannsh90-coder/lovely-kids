ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "shipping_original_cost" integer;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "shipping_promotion_discount" integer;

COMMENT ON COLUMN "orders"."shipping_original_cost" IS
  'Regular delivery price snapshot at order/edit time in whole ILS.';

COMMENT ON COLUMN "orders"."shipping_promotion_discount" IS
  'Delivery promotion discount snapshot in whole ILS. Null on historical orders created before this feature.';
