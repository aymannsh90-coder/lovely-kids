BEGIN;

ALTER TABLE pos_sale_returns
  ADD COLUMN IF NOT EXISTS customer_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pos_sale_returns_customer_id_fkey'
  ) THEN
    ALTER TABLE pos_sale_returns
      ADD CONSTRAINT pos_sale_returns_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES customers(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE pos_sale_returns
  DROP CONSTRAINT IF EXISTS pos_sale_returns_refund_method_valid;

ALTER TABLE pos_sale_returns
  ADD CONSTRAINT pos_sale_returns_refund_method_valid
  CHECK (refund_method IN ('cash', 'card', 'customer'));

ALTER TABLE pos_sale_returns
  DROP CONSTRAINT IF EXISTS pos_sale_returns_customer_refund_valid;

ALTER TABLE pos_sale_returns
  ADD CONSTRAINT pos_sale_returns_customer_refund_valid
  CHECK (
    (
      refund_method = 'customer'
      AND customer_id IS NOT NULL
    )
    OR
    (
      refund_method IN ('cash', 'card')
      AND customer_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS pos_sale_returns_customer_idx
  ON pos_sale_returns(customer_id);

COMMIT;
