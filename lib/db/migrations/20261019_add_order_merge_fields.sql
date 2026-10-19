ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS merged_into_order_id integer,
  ADD COLUMN IF NOT EXISTS merged_at timestamp,
  ADD COLUMN IF NOT EXISTS merged_by_user_id integer;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_merged_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_merged_by_user_id_users_id_fk
      FOREIGN KEY (merged_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END
$;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_merged_into_order_id_orders_id_fk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_merged_into_order_id_orders_id_fk
      FOREIGN KEY (merged_into_order_id)
      REFERENCES orders(id)
      ON DELETE RESTRICT;
  END IF;
END
$;

CREATE INDEX IF NOT EXISTS orders_merged_into_order_id_idx
  ON orders (merged_into_order_id);

CREATE INDEX IF NOT EXISTS orders_merged_at_idx
  ON orders (merged_at);
