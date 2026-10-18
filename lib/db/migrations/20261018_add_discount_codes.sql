CREATE TABLE IF NOT EXISTS "discount_codes" (
  "id" serial PRIMARY KEY,
  "campaign_name" text NOT NULL,
  "code" text NOT NULL,
  "normalized_code" text NOT NULL,
  "discount_percent" integer NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "stack_with_shipping_promotion" boolean NOT NULL DEFAULT false,
  "start_date" date,
  "end_date" date,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "discount_codes_percent_valid"
    CHECK ("discount_percent" BETWEEN 1 AND 100),
  CONSTRAINT "discount_codes_dates_valid"
    CHECK (
      "start_date" IS NULL
      OR "end_date" IS NULL
      OR "end_date" >= "start_date"
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  "discount_codes_normalized_code_unique"
ON "discount_codes" ("normalized_code");

ALTER TABLE "discount_codes"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "discount_code_id" integer,
  ADD COLUMN IF NOT EXISTS "discount_code" text,
  ADD COLUMN IF NOT EXISTS "discount_code_label" text,
  ADD COLUMN IF NOT EXISTS "discount_code_percent" integer,
  ADD COLUMN IF NOT EXISTS "discount_code_amount" integer,
  ADD COLUMN IF NOT EXISTS "discount_code_stacks_with_shipping_promotion" boolean;

CREATE INDEX IF NOT EXISTS
  "orders_discount_code_id_idx"
ON "orders" ("discount_code_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_discount_code_id_fkey'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_discount_code_id_fkey"
      FOREIGN KEY ("discount_code_id")
      REFERENCES "discount_codes"("id")
      ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE "orders"
  DROP CONSTRAINT IF EXISTS "orders_discount_code_snapshot_valid";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_discount_code_snapshot_valid"
  CHECK (
    (
      "discount_code" IS NULL
      AND "discount_code_label" IS NULL
      AND "discount_code_percent" IS NULL
      AND "discount_code_amount" IS NULL
      AND "discount_code_stacks_with_shipping_promotion" IS NULL
    )
    OR
    (
      "discount_code" IS NOT NULL
      AND "discount_code_label" IS NOT NULL
      AND "discount_code_percent" BETWEEN 1 AND 100
      AND "discount_code_amount" >= 0
      AND "discount_code_stacks_with_shipping_promotion" IS NOT NULL
    )
  );

COMMENT ON COLUMN "orders"."discount_code" IS
  'Discount code text snapshot at order creation time.';

COMMENT ON COLUMN "orders"."discount_code_label" IS
  'Campaign/influencer display name snapshot at order creation time.';

COMMENT ON COLUMN "orders"."discount_code_percent" IS
  'Discount percentage snapshot at order creation time.';

COMMENT ON COLUMN "orders"."discount_code_amount" IS
  'Applied discount amount in whole ILS, always rounded down.';

COMMENT ON COLUMN "orders"."discount_code_stacks_with_shipping_promotion" IS
  'Whether this discount code was allowed to stack with the shipping promotion.';
