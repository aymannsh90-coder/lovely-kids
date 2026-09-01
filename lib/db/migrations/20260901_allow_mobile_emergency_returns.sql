-- Emergency mobile POS returns are intentionally allowed
-- without an original sale/invoice reference.
-- Existing normal POS returns continue to store these references.

ALTER TABLE pos_sale_return_items
  ALTER COLUMN original_sale_item_id DROP NOT NULL;

ALTER TABLE pos_sale_returns
  ALTER COLUMN original_sale_id DROP NOT NULL;
